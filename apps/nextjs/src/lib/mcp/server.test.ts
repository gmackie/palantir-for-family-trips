/**
 * `/mcp` end to end in Node: the opium router, the real token verifier over
 * an in-memory `oauth_access_token` table, the operator-core tools, and the
 * app's tRPC router behind the in-process dispatch (only the database is
 * faked). Proves the challenge, the metadata, the scope-filtered tool list,
 * that a tool call reaches the API as the token's user, that a tool outside
 * the grant is refused before the API, that the API re-checks the token,
 * and that the token is no credential for `/api/trpc` called directly.
 */
import { appRouter, createTRPCContext } from "@sortey/api";
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  mcpResource,
  OAUTH_ACCESS_TOKEN_PREFIX,
  sha256Hex,
} from "@sortey/auth/oauth-provider";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpRouter } from "./server";
import { type AccessTokenRow, grantVerifier } from "./verify";

const fakeDb = vi.hoisted(() => {
  const db = {
    query: {
      userPreferences: {
        findFirst: vi.fn(),
      },
    },
    // The API's RLS middleware reads the platform role (a failure is
    // tolerated), then runs the call in a transaction that sets session GUCs.
    select: vi.fn(() => {
      throw new Error("no role lookup in this test");
    }),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db),
    ),
  };
  return db;
});

vi.mock("@sortey/db/client", () => ({ db: fakeDb }));

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const ORIGIN = "https://sortey.test";
const RESOURCE = mcpResource(ORIGIN);

const owner = {
  id: "user-1",
  name: "Field Agent",
  email: "agent@sortey.test",
  emailVerified: true,
  image: null,
  role: "user" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

/** `oauth_access_token` rows by stored hash. */
const tokens = new Map<string, AccessTokenRow>();

const verify = grantVerifier({
  prefix: OAUTH_ACCESS_TOKEN_PREFIX,
  resource: RESOURCE,
  lookup: async (hash) => tokens.get(hash),
});

const noSession = { getSession: async () => null };

const dispatch = vi.fn((req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () =>
      createTRPCContext({
        headers: req.headers,
        authApi: noSession,
        oauth: {
          verify: async (bearer) => {
            const principal = await verify(bearer, RESOURCE);
            return principal === null
              ? null
              : {
                  user: principal.claims.user,
                  clientId: principal.clientId,
                  scopes: principal.scopes,
                };
          },
        },
      }),
  }),
);

const router = createMcpRouter({
  baseUrl: ORIGIN,
  verify,
  dispatch,
  authorizationServer: async () =>
    Response.json({ issuer: `${ORIGIN}/api/auth` }),
});

/** Issues a token the way the provider stores it: sha256 hex of the unprefixed value. */
const seedToken = async (
  scopes: ReadonlyArray<string>,
  overrides: Partial<AccessTokenRow> = {},
) => {
  const raw = crypto.randomUUID().replaceAll("-", "");
  tokens.set(await sha256Hex(raw), {
    userId: owner.id,
    clientId: "client-1",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes,
    referenceId: null,
    sessionId: "session-1",
    clientDisabled: false,
    sessionExpiresAt: new Date(Date.now() + 3_600_000),
    owner,
    ...overrides,
  });
  return `${OAUTH_ACCESS_TOKEN_PREFIX}${raw}`;
};

const rpc = async (
  bearer: string | null,
  method: string,
  params: Readonly<Record<string, Json>> = {},
) => {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  if (bearer !== null) headers.set("authorization", `Bearer ${bearer}`);
  const response = await router(
    new Request(RESOURCE, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  if (response === null) throw new Error("/mcp was not routed");
  return response;
};

interface ToolResult {
  readonly result: {
    readonly content: ReadonlyArray<{ readonly text: string }>;
    readonly isError?: boolean;
  };
}

const listToolNames = async (bearer: string) => {
  const response = await rpc(bearer, "tools/list");
  expect(response.status).toBe(200);
  const body: { result: { tools: Array<{ name: string }> } } =
    await response.json();
  return body.result.tools.map((tool) => tool.name);
};

beforeEach(() => {
  tokens.clear();
  dispatch.mockClear();
  fakeDb.query.userPreferences.findFirst.mockReset();
});

describe("/mcp", () => {
  it("challenges for sortey:read with the resource metadata URL", async () => {
    const response = await rpc(null, "tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="${MCP_READ_SCOPE}"`,
    );
  });

  it("answers invalid_token for unknown, expired and sessionless tokens", async () => {
    const expired = await seedToken([MCP_READ_SCOPE], {
      expiresAt: new Date(Date.now() - 1000),
    });
    const endedSession = await seedToken([MCP_READ_SCOPE], {
      sessionExpiresAt: new Date(Date.now() - 1000),
    });
    const disabledClient = await seedToken([MCP_READ_SCOPE], {
      clientDisabled: true,
    });
    for (const bearer of [
      `${OAUTH_ACCESS_TOKEN_PREFIX}unknown`,
      "gmk_an_api_key",
      expired,
      endedSession,
      disabledClient,
    ]) {
      const response = await rpc(bearer, "tools/list");
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        'error="invalid_token"',
      );
    }
  });

  it("serves the protected-resource and authorization-server metadata", async () => {
    const prm = await router(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
    );
    expect(await prm?.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [`${ORIGIN}/api/auth`],
      scopes_supported: [MCP_READ_SCOPE, MCP_WRITE_SCOPE, "offline_access"],
      bearer_methods_supported: ["header"],
      resource_name: "Sortey",
    });
    const as = await router(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`),
    );
    expect(await as?.json()).toEqual({ issuer: `${ORIGIN}/api/auth` });
    expect(await router(new Request(`${ORIGIN}/api/trpc/post.all`))).toBeNull();
  });

  it("lists only the tools the grant can call, never the API key writers", async () => {
    expect(await listToolNames(await seedToken([MCP_READ_SCOPE]))).toEqual([
      "auth_help",
      "get_workspace_context",
      "get_billing_overview",
      "list_api_keys",
      "list_posts",
      "get_post",
      "get_preferences",
    ]);
    expect(
      await listToolNames(await seedToken([MCP_READ_SCOPE, MCP_WRITE_SCOPE])),
    ).toEqual([
      "auth_help",
      "get_workspace_context",
      "get_billing_overview",
      "list_api_keys",
      "list_posts",
      "get_post",
      "create_post",
      "delete_post",
      "get_preferences",
      "update_preferences",
    ]);
  });

  it("runs a tool through the operator client and the tRPC API as the token's user", async () => {
    fakeDb.query.userPreferences.findFirst.mockResolvedValue({
      userId: owner.id,
      theme: "dark",
      language: "en",
    });
    const response = await rpc(
      await seedToken([MCP_READ_SCOPE]),
      "tools/call",
      {
        name: "get_preferences",
      },
    );
    const body: ToolResult = await response.json();
    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(body.result.content[0]?.text ?? "")).toEqual({
      userId: owner.id,
      theme: "dark",
      language: "en",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(fakeDb.query.userPreferences.findFirst).toHaveBeenCalledTimes(1);
  });

  it("refuses a tool outside the grant without calling the API", async () => {
    const response = await rpc(
      await seedToken([MCP_READ_SCOPE]),
      "tools/call",
      {
        name: "create_post",
        arguments: { title: "t", content: "c" },
      },
    );
    const body: ToolResult = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain(MCP_WRITE_SCOPE);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not offer API key creation to an OAuth connection", async () => {
    const response = await rpc(
      await seedToken([MCP_READ_SCOPE, MCP_WRITE_SCOPE]),
      "tools/call",
      { name: "create_api_key", arguments: { name: "k" } },
    );
    const body: ToolResult = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toBe("Unknown tool: create_api_key");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("re-checks the token in the API: a token revoked mid-call is refused", async () => {
    const bearer = await seedToken([MCP_READ_SCOPE]);
    dispatch.mockImplementationOnce(async (req) => {
      tokens.clear();
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        router: appRouter,
        req,
        createContext: () =>
          createTRPCContext({
            headers: req.headers,
            authApi: noSession,
            oauth: { verify: async () => null },
          }),
      });
    });
    const response = await rpc(bearer, "tools/call", {
      name: "get_preferences",
    });
    const body: ToolResult = await response.json();
    expect(body.result.isError).toBe(true);
    expect(fakeDb.query.userPreferences.findFirst).not.toHaveBeenCalled();
  });

  it("is not a credential for /api/trpc called directly", async () => {
    const bearer = await seedToken([MCP_READ_SCOPE]);
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      router: appRouter,
      req: new Request(`${ORIGIN}/api/trpc/settings.getPreferences`, {
        headers: { authorization: `Bearer ${bearer}` },
      }),
      // The /api/trpc route: no `oauth` dispatch.
      createContext: () =>
        createTRPCContext({
          headers: new Headers({ authorization: `Bearer ${bearer}` }),
          authApi: noSession,
        }),
    });
    expect(response.status).toBe(401);
    expect(fakeDb.query.userPreferences.findFirst).not.toHaveBeenCalled();
  });
});

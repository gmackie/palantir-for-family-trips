/**
 * An OAuth grant (a remote `/mcp` tool call dispatched in-process) reaches
 * only the procedures the MCP tools use, each behind its scope; cookie
 * sessions are unaffected; and `createTRPCContext` refuses a `/mcp`
 * dispatch whose token does not verify.
 */
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@sortey/auth/oauth-provider";
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { appRouter } = await import("../../root");
const { createTRPCContext } = await import("../../trpc");
const { OAUTH_PROCEDURE_SCOPES } = await import("../../oauth-scopes");

const owner = {
  id: "user-1",
  name: "Field Agent",
  email: "agent@sortey.test",
  emailVerified: true,
  image: null,
  role: "admin" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const fakeDb = () => {
  const db = {
    query: {
      userPreferences: {
        findFirst: vi.fn(async () => ({ userId: owner.id, theme: "dark" })),
      },
    },
    // rlsSessionMiddleware reads the platform role (a failure is tolerated),
    // then runs the call in a transaction that sets session GUCs.
    select: vi.fn(() => {
      throw new Error("no role lookup in this test");
    }),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db),
    ),
  };
  return db;
};

const callerFor = (
  scopes: ReadonlyArray<string> | null,
  db: ReturnType<typeof fakeDb> = fakeDb(),
) =>
  appRouter.createCaller({
    db: db as never,
    authApi: { getSession: async () => null },
    session: { user: owner, session: null },
    apiKeyAuth: null,
    realtime: null,
    oauthGrant:
      scopes === null ? null : { user: owner, clientId: "client-1", scopes },
  });

describe("OAuth grants in the tRPC API", () => {
  it("serves a mapped procedure when the grant holds its scope", async () => {
    const db = fakeDb();
    await expect(
      callerFor([MCP_READ_SCOPE], db).settings.getPreferences(),
    ).resolves.toEqual({ userId: owner.id, theme: "dark" });
    expect(db.query.userPreferences.findFirst).toHaveBeenCalledTimes(1);
  });

  it("refuses a mapped procedure outside the grant", async () => {
    await expect(
      callerFor([MCP_READ_SCOPE]).settings.updatePreferences({ theme: "dark" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: `This connection was not granted the ${MCP_WRITE_SCOPE} scope`,
    });
  });

  it("refuses every procedure the MCP tools do not use, whatever the scopes", async () => {
    const all = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];
    await expect(
      callerFor(all).settings.createApiKey({
        name: "k",
        permissions: ["read"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      callerFor(all).settings.revokeApiKey({ id: "k" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerFor(all).settings.deleteAccount()).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });

  it("maps only procedures that exist", () => {
    const procedures = Object.keys(appRouter._def.procedures);
    for (const path of Object.keys(OAUTH_PROCEDURE_SCOPES)) {
      expect(procedures).toContain(path);
    }
  });

  it("leaves cookie sessions alone", async () => {
    await expect(callerFor(null).settings.getPreferences()).resolves.toEqual({
      userId: owner.id,
      theme: "dark",
    });
  });

  it("refuses a /mcp dispatch whose token does not verify", async () => {
    await expect(
      createTRPCContext({
        headers: new Headers({ authorization: "Bearer opa_stale" }),
        authApi: { getSession: async () => null },
        oauth: { verify: async () => null },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("ignores an OAuth bearer on a request that is not a /mcp dispatch", async () => {
    const getSession = vi.fn(async () => null);
    const ctx = await createTRPCContext({
      headers: new Headers({ authorization: "Bearer opa_token" }),
      authApi: { getSession },
    });
    expect(ctx.session).toBeNull();
    expect(ctx.oauthGrant).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});

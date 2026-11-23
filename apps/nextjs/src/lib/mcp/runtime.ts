/**
 * Binds `/mcp` (./server.ts) to the running app: the token lookup in
 * Postgres, the in-process tRPC dispatch, and the authorization server's
 * RFC 8414 metadata. Built once per isolate, at the first request, after the
 * Worker entry has bridged its env into `process.env`.
 */
import "server-only";

import { appRouter, createTRPCContext, type OAuthGrant } from "@sortey/api";
import {
  authorizationServerMetadata,
  mcpResource,
  OAUTH_ACCESS_TOKEN_PREFIX,
} from "@sortey/auth/oauth-provider";
import { eq } from "@sortey/db";
import { db } from "@sortey/db/client";
import {
  oauthAccessToken,
  oauthClient,
  session,
  user,
} from "@sortey/db/schema";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { auth, baseUrl } from "~/auth/server";
import { createMcpRouter } from "./server";
import {
  type AccessTokenRow,
  type GrantPrincipal,
  grantVerifier,
} from "./verify";

const lookup = async (hash: string): Promise<AccessTokenRow | undefined> => {
  const [row] = await db
    .select({
      userId: oauthAccessToken.userId,
      clientId: oauthAccessToken.clientId,
      expiresAt: oauthAccessToken.expiresAt,
      scopes: oauthAccessToken.scopes,
      referenceId: oauthAccessToken.referenceId,
      sessionId: oauthAccessToken.sessionId,
      clientDisabled: oauthClient.disabled,
      sessionExpiresAt: session.expiresAt,
      owner: user,
    })
    .from(oauthAccessToken)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
    .innerJoin(user, eq(user.id, oauthAccessToken.userId))
    .leftJoin(session, eq(session.id, oauthAccessToken.sessionId))
    .where(eq(oauthAccessToken.token, hash))
    .limit(1);
  return row;
};

const build = () => {
  const resource = mcpResource(baseUrl);
  const verify = grantVerifier({
    prefix: OAUTH_ACCESS_TOKEN_PREFIX,
    resource,
    lookup,
  });
  const toGrant = (principal: GrantPrincipal): OAuthGrant => ({
    user: principal.claims.user,
    clientId: principal.clientId,
    scopes: principal.scopes,
  });
  return createMcpRouter({
    baseUrl,
    verify,
    dispatch: (req) =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        router: appRouter,
        req,
        createContext: () =>
          createTRPCContext({
            headers: req.headers,
            authApi: auth.api,
            oauth: {
              verify: async (bearer) => {
                const principal = await verify(bearer, resource);
                return principal === null ? null : toGrant(principal);
              },
            },
          }),
        onError({ error, path }) {
          console.error(`>>> tRPC Error on '${path}' (mcp dispatch)`, error);
        },
      }),
    authorizationServer: authorizationServerMetadata(auth),
  });
};

let router: ReturnType<typeof build> | undefined;

/** `/mcp` and its metadata routes; any other path answers 404. */
export const handleMcpRequest = async (request: Request): Promise<Response> => {
  router ??= build();
  return (
    (await router(request)) ??
    new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    })
  );
};

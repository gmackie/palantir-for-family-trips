import { and, eq, isNull } from "@sortey/db";
import { db } from "@sortey/db/client";
import {
  apiKeys,
  session as sessionTable,
  type TenancyMode,
  user,
} from "@sortey/db/schema";
import {
  applyDatabaseSessionContext,
  withDatabaseSessionContext,
} from "@sortey/db/tenant";
import { initTRPC, TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import superjson from "superjson";
import { ZodError, z } from "zod/v4";

import { oauthProcedureScope } from "./oauth-scopes";
import { getRealtimeRuntime } from "./realtime-runtime";

/** Default until application_settings is read; multi-tenant is the safer RLS mode. */
const DEFAULT_TENANCY_MODE: TenancyMode = "multi-tenant";

export type ApiKeyPermission = "read" | "write" | "delete" | "admin";

export interface ApiKeyAuth {
  userId: string;
  permissions: ApiKeyPermission[];
  keyId: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  image?: string | null;
}

export interface SessionRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  expiresAt: Date;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type AuthSession = {
  user: AuthUser;
  session: SessionRecord | null;
} | null;

export interface AuthApi {
  getSession(input: { headers: Headers }): Promise<AuthSession>;
}

/** What an OAuth access token for `/mcp` grants: its user, client and scopes. */
export interface OAuthGrant {
  user: typeof user.$inferSelect;
  clientId: string;
  scopes: readonly string[];
}

/**
 * Present only when the remote MCP endpoint (`/mcp`) dispatches a tool call
 * to this API in-process (apps/nextjs/src/lib/mcp). A caller cannot set it:
 * the `/api/trpc` route never passes it, so an OAuth bearer sent there
 * directly authenticates nothing.
 */
export interface OAuthDispatch {
  /** The grant behind `bearer`, or null when it is not a valid `/mcp` token. */
  verify(bearer: string): Promise<OAuthGrant | null>;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function validateApiKey(key: string): Promise<ApiKeyAuth | null> {
  const keyHash = hashApiKey(key);

  const [keyRecord] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      permissions: apiKeys.permissions,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!keyRecord) return null;

  if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
    return null;
  }

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyRecord.id));

  return {
    userId: keyRecord.userId,
    permissions: keyRecord.permissions as ApiKeyPermission[],
    keyId: keyRecord.id,
  };
}

function extractAllSessionTokens(cookieHeader: string): string[] {
  const prefixes = [
    "__Secure-better-auth.session_token=",
    "better-auth.session_token=",
  ];
  const tokens: string[] = [];

  for (const p of prefixes) {
    let searchFrom = 0;
    while (true) {
      const idx = cookieHeader.indexOf(p, searchFrom);
      if (idx === -1) break;
      const start = idx + p.length;
      const end = cookieHeader.indexOf(";", start);
      let value = cookieHeader
        .slice(start, end === -1 ? undefined : end)
        .trim();
      try {
        if (value.includes("%")) value = decodeURIComponent(value);
      } catch {}
      const dotPos = value.lastIndexOf(".");
      const token = dotPos > 0 ? value.substring(0, dotPos) : value;
      if (token) tokens.push(token);
      searchFrom = start;
    }
  }

  return tokens;
}

async function expoSessionFallback(cookieHeader: string): Promise<AuthSession> {
  const tokens = extractAllSessionTokens(cookieHeader);
  if (tokens.length === 0) {
    console.log("[expo-fallback] no tokens extracted from cookie");
    return null;
  }

  console.log(`[expo-fallback] found ${tokens.length} token(s), trying each`);

  for (const token of tokens) {
    try {
      const [sessionRow] = await db
        .select()
        .from(sessionTable)
        .where(eq(sessionTable.token, token))
        .limit(1);

      if (!sessionRow) continue;
      if (sessionRow.expiresAt < new Date()) continue;

      const [userRow] = await db
        .select()
        .from(user)
        .where(eq(user.id, sessionRow.userId))
        .limit(1);

      if (!userRow) continue;

      console.log(`[expo-fallback] session valid for ${userRow.email}`);
      return {
        user: {
          id: userRow.id,
          name: userRow.name,
          email: userRow.email,
          emailVerified: userRow.emailVerified,
          createdAt: userRow.createdAt,
          updatedAt: userRow.updatedAt,
          image: userRow.image,
        },
        session: {
          id: sessionRow.id,
          createdAt: sessionRow.createdAt,
          updatedAt: sessionRow.updatedAt,
          userId: sessionRow.userId,
          expiresAt: sessionRow.expiresAt,
          token: sessionRow.token,
          ipAddress: sessionRow.ipAddress,
          userAgent: sessionRow.userAgent,
        },
      };
    } catch (err) {
      console.error(`[expo-fallback] DB error for token: ${err}`);
    }
  }

  console.log("[expo-fallback] no valid session found for any token");
  return null;
}

export const createTRPCContext = async (opts: {
  headers: Headers;
  authApi: AuthApi;
  oauth?: OAuthDispatch;
}) => {
  const authHeader = opts.headers.get("authorization");
  const oauthBearer = /^Bearer\s+(\S+)$/i.exec(authHeader?.trim() ?? "")?.[1];
  if (opts.oauth && oauthBearer && !oauthBearer.startsWith("gmk_")) {
    // A dispatch from `/mcp`: the bearer is checked again here (expiry,
    // revocation, audience, user) and nothing else is consulted; a bearer
    // that fails it is refused, never served as an anonymous or cookie request.
    const oauthGrant = await opts.oauth.verify(oauthBearer);
    if (!oauthGrant) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return {
      authApi: opts.authApi,
      session: { user: oauthGrant.user, session: null },
      apiKeyAuth: null as ApiKeyAuth | null,
      oauthGrant: oauthGrant as OAuthGrant | null,
      db,
      realtime: getRealtimeRuntime(),
    };
  }
  if (authHeader?.startsWith("Bearer gmk_")) {
    const apiKey = authHeader.slice(7);
    const apiKeyAuth = await validateApiKey(apiKey);

    if (apiKeyAuth) {
      const [userRecord] = await db
        .select()
        .from(user)
        .where(eq(user.id, apiKeyAuth.userId))
        .limit(1);

      if (userRecord) {
        return {
          authApi: opts.authApi,
          session: {
            user: userRecord,
            session: null,
          },
          apiKeyAuth,
          oauthGrant: null as OAuthGrant | null,
          db,
          // Realtime fan-out seam. Populated by the worker entry (Workers
          // runtime) via `runWithRealtimeRuntime`; `null` everywhere else
          // (unit tests, non-Workers callers) so the broadcast is skipped.
          realtime: getRealtimeRuntime(),
        };
      }
    }
  }

  const source = opts.headers.get("x-trpc-source");
  const cookieHeader = opts.headers.get("cookie");

  let session = await opts.authApi.getSession({
    headers: opts.headers,
  });

  let fallbackAttempted = false;

  if (!session && source === "expo-react" && cookieHeader) {
    fallbackAttempted = true;
    console.log(
      `[tRPC ctx] expo getSession returned NULL — trying fallback with cookie (${cookieHeader.length} chars)`,
    );
    session = await expoSessionFallback(cookieHeader);
  }

  return {
    authApi: opts.authApi,
    session,
    apiKeyAuth: null as ApiKeyAuth | null,
    oauthGrant: null as OAuthGrant | null,
    db,
    // See note above: the worker populates this; `null` in tests / non-Workers.
    realtime: getRealtimeRuntime(),
    _expoAuthDiag:
      !session && source === "expo-react"
        ? `fallback=${fallbackAttempted}, cookie_len=${cookieHeader?.length ?? 0}, cookie_start=${cookieHeader?.substring(0, 80) ?? "none"}`
        : undefined,
  };
};
/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError
          ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
          : null,
    },
  }),
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an articifial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev 100-500ms
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

/**
 * An OAuth grant (a `/mcp` tool call) reaches only the procedures the MCP
 * tools use, each behind the scope the user consented to
 * (./oauth-scopes.ts). Cookie sessions and API keys are not affected.
 */
const oauthGrantMiddleware = t.middleware(({ ctx, next, path }) => {
  if (ctx.oauthGrant) {
    const scope = oauthProcedureScope(path);
    if (scope === undefined) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Not available to OAuth connections",
      });
    }
    if (!ctx.oauthGrant.scopes.includes(scope)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This connection was not granted the ${scope} scope`,
      });
    }
  }
  return next();
});

const baseProcedure = t.procedure
  .use(timingMiddleware)
  .use(oauthGrantMiddleware);

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = baseProcedure;

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
/**
 * Sets Postgres session GUCs (`app.user_id`, etc.) for FORCE RLS policies.
 * Runs the procedure inside a transaction so `set_config(..., true)` stays
 * local to the request and cannot leak across the connection pool.
 */
const rlsSessionMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    return next();
  }

  // Platform role is stored on `user` (not FORCE RLS). Load it so membership
  // and other policies can grant admin bypass via app.platform_role.
  let platformRole: string | null = null;
  try {
    const [dbUser] = await ctx.db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, ctx.session.user.id))
      .limit(1);
    platformRole = dbUser?.role ?? null;
  } catch {
    platformRole = null;
  }

  const sessionCtx = {
    tenancyMode: DEFAULT_TENANCY_MODE,
    userId: ctx.session.user.id,
    userEmail: ctx.session.user.email,
    workspaceId: null as string | null,
    platformRole: platformRole as "user" | "admin" | null,
  };

  return withDatabaseSessionContext(ctx.db as never, sessionCtx, async (tx) =>
    next({
      ctx: {
        ...ctx,
        db: tx as typeof ctx.db,
      },
    }),
  );
});

export const protectedProcedure = baseProcedure
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      const diag = (ctx as Record<string, unknown>)._expoAuthDiag;
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: diag ? `UNAUTHORIZED [${diag}]` : "UNAUTHORIZED",
      });
    }
    return next({
      ctx: {
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  })
  .use(rlsSessionMiddleware);

const createApiKeyProcedure = (requiredPermission: ApiKeyPermission) =>
  baseProcedure
    .use(({ ctx, next }) => {
      if (!ctx.apiKeyAuth) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "API key required",
        });
      }

      const hasPermission =
        ctx.apiKeyAuth.permissions.includes("admin") ||
        ctx.apiKeyAuth.permissions.includes(requiredPermission);

      if (!hasPermission) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `API key lacks '${requiredPermission}' permission`,
        });
      }

      if (!ctx.session?.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      return next({
        ctx: {
          session: { ...ctx.session, user: ctx.session.user },
          apiKeyAuth: ctx.apiKeyAuth,
        },
      });
    })
    .use(rlsSessionMiddleware);

export const apiKeyReadProcedure = createApiKeyProcedure("read");
export const apiKeyWriteProcedure = createApiKeyProcedure("write");
export const apiKeyDeleteProcedure = createApiKeyProcedure("delete");
export const apiKeyAdminProcedure = createApiKeyProcedure("admin");

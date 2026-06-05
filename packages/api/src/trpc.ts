import { and, eq, isNull } from "@sortey/db";
import { db } from "@sortey/db/client";
import { apiKeys, session as sessionTable, user } from "@sortey/db/schema";
import { initTRPC, TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import superjson from "superjson";
import { ZodError, z } from "zod/v4";

import { getRealtimeRuntime } from "./realtime-runtime";

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
}) => {
  const authHeader = opts.headers.get("authorization");
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
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
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
  });

const createApiKeyProcedure = (requiredPermission: ApiKeyPermission) =>
  t.procedure.use(timingMiddleware).use(({ ctx, next }) => {
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
  });

export const apiKeyReadProcedure = createApiKeyProcedure("read");
export const apiKeyWriteProcedure = createApiKeyProcedure("write");
export const apiKeyDeleteProcedure = createApiKeyProcedure("delete");
export const apiKeyAdminProcedure = createApiKeyProcedure("admin");

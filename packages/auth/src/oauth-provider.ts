/**
 * The app as an OAuth 2.1 authorization server for its remote MCP endpoint
 * (`/mcp`), with `@better-auth/oauth-provider`. An MCP client registers
 * itself (dynamic client registration, no credentials), sends the user
 * through `/api/auth/oauth2/authorize` with PKCE, and gets an opaque access
 * token stored as sha256 hex, so `/mcp` verifies it with one indexed read.
 *
 * This is `opiumProvider()` from `@forgegraph/opium/better-auth`, adapted by
 * hand: that preset needs better-auth >= 1.7.14, and this app is on
 * better-auth 1.6.17, so the plugin is the 1.6.17 release that matches it.
 * Differences from the preset, all forced by the older plugin:
 *
 * - no `resources` / `clientRegistrationDefaultResources`: 1.6 has no
 *   per-client resource table and stores no audience on opaque tokens.
 *   `validAudiences: [resource]` makes `/mcp` the only resource a token can
 *   be requested for, so every token this server issues is for `/mcp`;
 * - no `clientRegistrationDefaultApplicationType: "infer"`: 1.6 leaves
 *   `type` unset for unauthenticated registrations and already accepts
 *   loopback `http://127.0.0.1:<port>` redirects (Claude Code, Cursor).
 */
import {
  oauthProvider,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider";

/** Read-only tools: the default the 401 challenge asks for. */
export const MCP_READ_SCOPE = "sortey:read";
/** Tools that create, change or delete. */
export const MCP_WRITE_SCOPE = "sortey:write";
/** `refresh_token` grants are issued only to a client that asked for this. */
export const OFFLINE_ACCESS = "offline_access";

/** The scopes a user can grant an MCP client, without `offline_access`. */
export const MCP_SCOPES = [MCP_READ_SCOPE, MCP_WRITE_SCOPE] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_SCOPE_DESCRIPTIONS: Readonly<Record<McpScope, string>> = {
  [MCP_READ_SCOPE]:
    "Read your workspace, billing overview, posts, preferences and API key list",
  [MCP_WRITE_SCOPE]: "Create and delete posts, and change your preferences",
};

/** Prefixes on issued tokens (opium's defaults); `gmk_` is an API key. */
export const OAUTH_ACCESS_TOKEN_PREFIX = "opa_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "opr_";

/** The browser pages the plugin redirects to (apps/nextjs/src/app/oauth/*). */
export const OAUTH_PAGES = {
  signIn: "/oauth/sign-in",
  consent: "/oauth/consent",
} as const;

/** The protected resource the provider issues tokens for. */
export const mcpResource = (baseUrl: string): string =>
  new URL("/mcp", baseUrl).toString();

/** sha256 hex, the same digest `opaqueTokenVerifier` computes by default. */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

/**
 * RFC 8414 metadata for the issuer (`<app>/api/auth`), served by `/mcp`'s
 * router at `/.well-known/oauth-authorization-server[/api/auth]`.
 */
export const authorizationServerMetadata = oauthProviderAuthServerMetadata;

export const oauthProviderOptions = (options: {
  readonly resource: string;
}) => {
  const scopes = [...MCP_SCOPES, OFFLINE_ACCESS];
  return {
    loginPage: OAUTH_PAGES.signIn,
    consentPage: OAUTH_PAGES.consent,
    // Not an OIDC provider: no `openid`, so no id tokens or userinfo.
    scopes,
    grantTypes: ["authorization_code", "refresh_token"] as (
      | "authorization_code"
      | "refresh_token"
    )[],
    // MCP clients register themselves and carry no credentials to do it.
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultScopes: scopes,
    clientRegistrationAllowedScopes: scopes,
    // The only audience a token may be requested for.
    validAudiences: [options.resource],
    // Opaque tokens verified in this Worker: nothing to sign, no JWKS, and
    // revoking a grant takes effect on the next request.
    disableJwtPlugin: true,
    prefix: {
      opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
      refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
    },
    // The plugin hashes the token without its prefix, at issuance and at
    // every lookup; `/mcp` hashes the same way.
    storeTokens: { hash: (token: string) => sha256Hex(token) },
    // `/mcp`'s router serves the RFC 8414 document at the root.
    silenceWarnings: { oauthAuthServerConfig: true },
  };
};

export const oauthProviderPlugin = (options: { readonly resource: string }) =>
  oauthProvider(oauthProviderOptions(options));

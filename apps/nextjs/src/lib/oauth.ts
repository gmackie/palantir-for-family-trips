/**
 * Helpers for the pages better-auth's OAuth provider (`/api/auth/oauth2/*`)
 * redirects to: `/oauth/sign-in` and `/oauth/consent`. Each arrives with the
 * client's authorization request in its query string, signed by the
 * provider (`exp`, then `sig` over everything before it). What goes back to
 * the provider as `oauth_query` is the page's own query string, byte for
 * byte (`window.location.search`), never a re-serialised copy.
 */
import {
  MCP_READ_SCOPE,
  MCP_SCOPE_DESCRIPTIONS,
  MCP_SCOPES,
  type McpScope,
} from "@sortey/auth/oauth-provider";

/** The provider's signing parameters; everything else is the client's request. */
const SIGNING_PARAMS = ["sig", "exp"] as const;

const paramsOf = (search: string) =>
  new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

const grantable: ReadonlySet<string> = new Set(MCP_SCOPES);

/** Next's `searchParams` prop as a query string, keeping repeated keys. */
export const toQueryString = (
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) params.append(key, item);
    }
  }
  return params.toString();
};

/**
 * The client's original authorization request, to start it again once the
 * user is signed in. Without the signing parameters it is exactly what the
 * client sent, so restarting it grants nothing the client could not ask for.
 */
export const authorizeUrl = (search: string): string => {
  const params = paramsOf(search);
  for (const name of SIGNING_PARAMS) params.delete(name);
  return `/api/auth/oauth2/authorize?${params.toString()}`;
};

/** The `oauth_query` the provider's `consent` endpoint verifies. */
export const signedOAuthQuery = (search: string): string =>
  search.startsWith("?") ? search.slice(1) : search;

export interface ScopeChoice {
  readonly scope: McpScope;
  readonly description: string;
}

/** The requested scopes, split into what the consent page shows and pre-ticks. */
export const requestedScopes = (search: string) => {
  const requested = (paramsOf(search).get("scope") ?? "")
    .split(" ")
    .filter((scope) => scope.length > 0);
  const offered: ReadonlyArray<ScopeChoice> = MCP_SCOPES.filter((scope) =>
    requested.includes(scope),
  ).map((scope) => ({ scope, description: MCP_SCOPE_DESCRIPTIONS[scope] }));
  return {
    offered,
    /** Reads are pre-ticked; writes are opt-in. */
    preselected: offered
      .map((choice) => choice.scope)
      .filter((scope) => scope === MCP_READ_SCOPE),
    /**
     * Requested values that are not permissions (`offline_access`, for a
     * refresh token): passed through on approval, never shown.
     */
    passthrough: requested.filter((scope) => !grantable.has(scope)),
  };
};

/** The host the client will send the user back to, for the consent screen. */
export const redirectHost = (search: string): string => {
  const uri = paramsOf(search).get("redirect_uri");
  if (uri === null) return "an unknown address";
  try {
    return new URL(uri).host;
  } catch {
    return "an unknown address";
  }
};

export const clientIdOf = (search: string): string | null =>
  paramsOf(search).get("client_id");

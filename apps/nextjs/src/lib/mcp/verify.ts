/**
 * Verifies the `opa_` access tokens the OAuth provider issues, with opium's
 * `opaqueTokenVerifier` (one indexed read by sha256 of the token): expiry,
 * disabled client, the approving session's expiry, and a user that still
 * exists. Revoking a token deletes its row in this plugin version, so a
 * revoked token simply finds nothing.
 *
 * Audience: `@better-auth/oauth-provider` 1.6.17 stores no resource on
 * an opaque token, and `validAudiences: [<app>/mcp]` makes `/mcp` the only
 * resource a token can be requested for, so every token it issues is a
 * `/mcp` token. The row is given that resource here, which keeps opium's
 * audience check meaningful should the provider ever gain a second resource
 * (then this must read the stored audience instead).
 */

import {
  opaqueTokenVerifier,
  type Principal,
  type StoredAccessToken,
} from "@forgegraph/opium";
import type { user } from "@sortey/db/schema";

type UserRow = typeof user.$inferSelect;

export interface GrantPrincipal extends Principal {
  readonly claims: { readonly user: UserRow };
}

/** An `oauth_access_token` row joined to its client, session and user. */
export interface AccessTokenRow {
  readonly userId: string | null;
  readonly clientId: string;
  readonly expiresAt: Date;
  readonly scopes: ReadonlyArray<string>;
  readonly referenceId: string | null;
  readonly sessionId: string | null;
  readonly clientDisabled: boolean | null;
  readonly sessionExpiresAt: Date | null;
  readonly owner: UserRow;
}

export const grantVerifier = (options: {
  readonly prefix: string;
  readonly resource: string;
  readonly lookup: (hash: string) => Promise<AccessTokenRow | undefined>;
}) => {
  // The user each looked-up row belongs to, for `authorize` (which gets the
  // row back as opium's `StoredAccessToken`).
  const owners = new WeakMap<StoredAccessToken, UserRow>();
  return opaqueTokenVerifier<GrantPrincipal>({
    prefix: options.prefix,
    lookup: async (hash) => {
      const row = await options.lookup(hash);
      if (row === undefined || row.userId === null) return null;
      const stored: StoredAccessToken = {
        ...row,
        userId: row.userId,
        revoked: null,
        resources: [options.resource],
      };
      owners.set(stored, row.owner);
      return stored;
    },
    authorize: (principal, row) => {
      const owner = owners.get(row);
      return owner === undefined
        ? null
        : { ...principal, claims: { user: owner } };
    },
  });
};

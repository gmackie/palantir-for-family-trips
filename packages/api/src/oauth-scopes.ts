/**
 * The tRPC procedures an OAuth grant (a remote `/mcp` tool call) may reach,
 * and the scope each one needs: exactly the procedures the operator tools in
 * `@sortey/operator-core` call. Everything else is refused to an OAuth
 * connection, whatever its scopes, including API key creation and
 * revocation (a connected client must not mint credentials that outlive its
 * grant), account deletion, invites and admin procedures.
 */
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  type McpScope,
} from "@sortey/auth/oauth-provider";

export const OAUTH_PROCEDURE_SCOPES: Readonly<Record<string, McpScope>> = {
  "settings.getWorkspaceContext": MCP_READ_SCOPE,
  "settings.getBillingOverview": MCP_READ_SCOPE,
  "settings.listApiKeys": MCP_READ_SCOPE,
  "settings.getPreferences": MCP_READ_SCOPE,
  "post.all": MCP_READ_SCOPE,
  "post.byId": MCP_READ_SCOPE,
  "post.create": MCP_WRITE_SCOPE,
  "post.delete": MCP_WRITE_SCOPE,
  "settings.updatePreferences": MCP_WRITE_SCOPE,
};

export const oauthProcedureScope = (path: string): McpScope | undefined =>
  Object.hasOwn(OAUTH_PROCEDURE_SCOPES, path)
    ? OAUTH_PROCEDURE_SCOPES[path]
    : undefined;

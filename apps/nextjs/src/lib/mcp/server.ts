/**
 * The remote MCP endpoint (`/mcp`) on `@forgegraph/opium`: stateless
 * Streamable HTTP, JSON responses, protected by the app's own OAuth provider
 * (packages/auth/src/oauth-provider.ts).
 *
 * - No bearer, or a bad one: 401 with `WWW-Authenticate: Bearer
 *   resource_metadata=...` (RFC 9728), asking for `sortey:read` only, so a
 *   new connection is read-only unless the user ticks more at consent.
 * - A valid `opa_` token: the stdio server's operator tools
 *   (`@sortey/operator-core`), listed only when the grant holds their scope.
 *   A call runs the operator client against the app's tRPC API in-process
 *   with the bearer forwarded; the API checks the token and the scope again
 *   (packages/api/src/trpc.ts, `oauthGrantMiddleware`).
 *
 * Pure: the token check, the API dispatch and the authorization-server
 * metadata are injected, so the suite runs the real MCP server and tools
 * without a Worker (./runtime.ts binds them).
 */

import {
  defineTool,
  opium,
  type Principal,
  type Tool,
  type Verify,
} from "@forgegraph/opium";
import {
  MCP_READ_SCOPE,
  MCP_SCOPES,
  MCP_WRITE_SCOPE,
  type McpScope,
  mcpResource,
} from "@sortey/auth/oauth-provider";
import {
  createOperatorClient,
  executeOperatorTool,
  listOperatorTools,
} from "@sortey/operator-core";

/**
 * The scope each stdio tool needs over OAuth (`null`: any connection).
 * `"key-only"` tools are not offered to OAuth connections at all: a
 * connected client must not mint or revoke API keys, which would outlive
 * its grant. A tool missing here fails `createMcpRouter`, so a new
 * operator tool is never exposed without a decision.
 */
type ToolScope = McpScope | null | "key-only";

export const MCP_TOOL_SCOPES = {
  auth_help: null,
  get_workspace_context: MCP_READ_SCOPE,
  get_billing_overview: MCP_READ_SCOPE,
  list_api_keys: MCP_READ_SCOPE,
  create_api_key: "key-only",
  revoke_api_key: "key-only",
  list_posts: MCP_READ_SCOPE,
  get_post: MCP_READ_SCOPE,
  create_post: MCP_WRITE_SCOPE,
  delete_post: MCP_WRITE_SCOPE,
  get_preferences: MCP_READ_SCOPE,
  update_preferences: MCP_WRITE_SCOPE,
} as const satisfies Readonly<Record<string, ToolScope>>;

const toolScopes: ReadonlyMap<string, ToolScope> = new Map(
  Object.entries(MCP_TOOL_SCOPES),
);

export interface McpEndpoint {
  /** The app's origin (`APP_URL`): the resource is `<origin>/mcp`. */
  readonly baseUrl: string;
  /** Bearer → principal, or null for any token that is not for `/mcp`. */
  readonly verify: Verify<Principal>;
  /** The app's tRPC handler, dispatching as the `/mcp` endpoint. */
  readonly dispatch: (request: Request) => Promise<Response>;
  /** RFC 8414 metadata for the issuer (`<origin>/api/auth`). */
  readonly authorizationServer: (request: Request) => Promise<Response>;
}

export const mcpTools = (endpoint: McpEndpoint): ReadonlyArray<Tool> =>
  listOperatorTools().flatMap((tool) => {
    const scope = toolScopes.get(tool.name);
    if (scope === undefined) {
      throw new Error(
        `MCP_TOOL_SCOPES has no entry for operator tool ${tool.name}`,
      );
    }
    if (scope === "key-only") return [];
    return [
      defineTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        scope,
        annotations: {
          readOnlyHint: scope !== MCP_WRITE_SCOPE,
          destructiveHint: tool.name === "delete_post",
        },
        run: (args, { bearer }) =>
          executeOperatorTool(
            createOperatorClient({
              baseUrl: endpoint.baseUrl,
              apiKey: bearer,
              batch: false,
              fetch: (input, init) =>
                endpoint.dispatch(new Request(input, init)),
            }),
            tool.name,
            args,
          ),
      }),
    ];
  });

/**
 * Every route a remote MCP server needs (`/mcp` and the RFC 9728/8414
 * metadata); `null` for any other path.
 */
export const createMcpRouter = (endpoint: McpEndpoint) => {
  const origin = new URL(endpoint.baseUrl).origin;
  return opium({
    resource: mcpResource(origin),
    issuer: `${origin}/api/auth`,
    scopes: MCP_SCOPES,
    challengeScopes: [MCP_READ_SCOPE],
    name: "Sortey",
    serverInfo: { name: "sortey", version: "0.1.0" },
    verify: endpoint.verify,
    tools: mcpTools(endpoint),
    authorizationServer: endpoint.authorizationServer,
  });
};

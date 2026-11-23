/**
 * The remote MCP endpoint (src/lib/mcp). POST carries the MCP exchange;
 * GET/DELETE answer 405 once authenticated (stateless server), OPTIONS is
 * the CORS preflight.
 */
import { handleMcpRequest } from "~/lib/mcp/runtime";

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
export const OPTIONS = handleMcpRequest;

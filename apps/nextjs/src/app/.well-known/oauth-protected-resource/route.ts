/** OAuth discovery metadata for `/mcp` (RFC 9728 / RFC 8414), served by src/lib/mcp. */
import { handleMcpRequest } from "~/lib/mcp/runtime";

export const GET = handleMcpRequest;

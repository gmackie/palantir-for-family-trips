/**
 * Type definitions for the tRPC client
 *
 * These types are re-exported from @sortey/api for convenience.
 * If you have @sortey/api installed as a peer dependency, you can
 * import these types directly from there for the full type definitions.
 */

// Import the AppRouter type from @sortey/api
// This is a devDependency, so it will be available during build
// Users who want full type inference should install @sortey/api as a peer dep
import type { AppRouter } from "@sortey/api";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

/**
 * Inference helpers for input types
 * @example
 * type PostByIdInput = RouterInputs['post']['byId']
 *      ^? { id: string }
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type AllPostsOutput = RouterOutputs['post']['all']
 *      ^? Post[]
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type { AppRouter };

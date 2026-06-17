/**
 * Trip status state machine.
 *
 * Allowed transitions (validated in Step 1 against shipped UI call-sites):
 *
 * | From      | Allowed to                          | Source                         |
 * |-----------|-------------------------------------|--------------------------------|
 * | planning  | confirmed, en_route                 | lock-in wizard; road-trip "Start Trip" button |
 * | confirmed | planning, active                    | undo confirm; kick-off active  |
 * | active    | en_route, completed                 | driving mode; wrap-up          |
 * | en_route  | paused, active, completed           | pause; revert to active; end   |
 * | paused    | en_route, active, completed         | resume; revert; end            |
 * | completed | (none — terminal)                   |                                |
 *
 * NOTE: `planning → en_route` was added beyond the original plan proposal
 * because both the Next.js and Expo road-trip dashboards have a shipped
 * "Start Trip" button that fires this transition directly.
 *
 * When new statuses are added to `tripStatusEnum` the exhaustive
 * `Record<TripStatus, ...>` type below will cause a build error until this
 * map is extended — that is intentional.
 */

import type { TripStatus } from "@sortey/db/schema";
import { TRPCError } from "@trpc/server";

export const TRIP_STATUS_TRANSITIONS: Record<
  TripStatus,
  readonly TripStatus[]
> = {
  planning: ["confirmed", "en_route"],
  confirmed: ["planning", "active"],
  active: ["en_route", "completed"],
  en_route: ["paused", "active", "completed"],
  paused: ["en_route", "active", "completed"],
  completed: [],
};

/**
 * Returns true when moving `from` → `to` is a legal transition, OR when
 * `from === to` (same-state writes from idempotent clients are allowed).
 */
export function isValidTripStatusTransition(
  from: TripStatus,
  to: TripStatus,
): boolean {
  if (from === to) return true;
  return (TRIP_STATUS_TRANSITIONS[from] as readonly TripStatus[]).includes(to);
}

/**
 * Throws a BAD_REQUEST TRPCError when the transition is not allowed.
 * Call this before writing the new status to the database.
 */
export function assertValidTripStatusTransition(
  from: TripStatus,
  to: TripStatus,
): void {
  if (!isValidTripStatusTransition(from, to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot move trip from '${from}' to '${to}'.`,
    });
  }
}

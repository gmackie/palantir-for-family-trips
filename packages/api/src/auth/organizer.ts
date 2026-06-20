import { TRPCError } from "@trpc/server";

export type TripRole = "organizer" | "member";

export function requireOrganizer(
  tripRole: TripRole,
  message = "Only organizers can perform this action.",
): void {
  if (tripRole !== "organizer") {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

export function requireOrganizerOrSelf(
  tripRole: TripRole,
  resourceOwnerUserId: string,
  ctxUserId: string,
  message = "Only the payer or a trip organizer can modify this expense.",
): void {
  if (tripRole === "organizer") return;
  if (resourceOwnerUserId === ctxUserId) return;
  throw new TRPCError({ code: "FORBIDDEN", message });
}

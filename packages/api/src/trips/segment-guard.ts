import { and, eq } from "@sortey/db";
import { tripSegments } from "@sortey/db/schema";
import { TRPCError } from "@trpc/server";

export async function validateSegmentBelongsToTrip(
  db: any,
  segmentId: string,
  tripId: string,
) {
  const [segment] = (await db
    .select({ id: tripSegments.id })
    .from(tripSegments)
    .where(and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)))
    .limit(1)) as { id: string }[];

  if (!segment) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Segment does not belong to this trip.",
    });
  }
}

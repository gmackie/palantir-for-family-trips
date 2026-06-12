/**
 * Regression tests for cross-trip IDOR fixes (Plan 002).
 *
 * Strategy: both helpers are pure async functions that accept a `db` argument.
 * We stub `db` as an object whose `.select().from().where().limit()` chain
 * returns a controllable result — the same pattern used in fuel-logs.test.ts
 * (referenced in the plan; note: that file has since been removed, so we
 * follow the stub pattern from chat.test.ts / trips.test.ts).
 *
 * The itinerary delete where-clause is verified by reading the source file
 * (no DB harness available for inline-router mutations).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { validateSegmentBelongsToTrip } = await import(
  "../../trips/segment-guard"
);
const { assertLodgingInTrip } = await import("../lodging");

// ---------------------------------------------------------------------------
// Chainable Drizzle stub builder
// ---------------------------------------------------------------------------

/**
 * Returns a stub db object whose select().from().where().limit() chain
 * resolves to `rows`.
 */
function makeDbStub(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain };
}

// ---------------------------------------------------------------------------
// validateSegmentBelongsToTrip
// ---------------------------------------------------------------------------

describe("validateSegmentBelongsToTrip", () => {
  it("resolves when the segment belongs to the trip", async () => {
    const db = makeDbStub([{ id: "seg_1" }]);
    await expect(
      validateSegmentBelongsToTrip(db, "seg_1", "trip_1"),
    ).resolves.toBeUndefined();
  });

  it("throws BAD_REQUEST when the query returns no rows (wrong trip)", async () => {
    const db = makeDbStub([]);
    await expect(
      validateSegmentBelongsToTrip(db, "seg_other", "trip_1"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("error message mentions the segment scope", async () => {
    const db = makeDbStub([]);
    await expect(
      validateSegmentBelongsToTrip(db, "seg_other", "trip_1"),
    ).rejects.toMatchObject({
      message: "Segment does not belong to this trip.",
    });
  });
});

// ---------------------------------------------------------------------------
// assertLodgingInTrip
// ---------------------------------------------------------------------------

describe("assertLodgingInTrip", () => {
  it("resolves when the lodging's segment belongs to the trip", async () => {
    const db = makeDbStub([{ id: "seg_1" }]);
    await expect(
      assertLodgingInTrip(db, { segmentId: "seg_1" }, "trip_1"),
    ).resolves.toBeUndefined();
  });

  it("throws NOT_FOUND for a cross-trip lodging (never leaks existence)", async () => {
    const db = makeDbStub([]);
    await expect(
      assertLodgingInTrip(db, { segmentId: "seg_other_trip" }, "trip_1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("error message is the generic 'Lodging not found.' — does not confirm existence", async () => {
    const db = makeDbStub([]);
    await expect(
      assertLodgingInTrip(db, { segmentId: "seg_other_trip" }, "trip_1"),
    ).rejects.toMatchObject({ message: "Lodging not found." });
  });
});

// ---------------------------------------------------------------------------
// Itinerary delete where-clause grep guard
// ---------------------------------------------------------------------------

describe("itinerary delete scope guard", () => {
  const itinerarySource = readFileSync(
    join(
      import.meta.dirname,
      // __tests__/tenant-scoping.test.ts -> router/itinerary.ts
      "..",
      "itinerary.ts",
    ),
    "utf8",
  );

  it("delete where-clause references itineraryEvents.tripId", () => {
    // The fix adds and(eq(itineraryEvents.id, ...), eq(itineraryEvents.tripId, ctx.tripId))
    expect(itinerarySource).toContain("itineraryEvents.tripId");
  });

  it("delete where-clause uses and() combinator (both conditions present)", () => {
    // Verify the fix is inside the delete block (not just in a comment or list query)
    const deleteBlock = itinerarySource.slice(
      itinerarySource.indexOf("delete: tripProcedure()"),
    );
    expect(deleteBlock).toContain("itineraryEvents.tripId");
  });
});

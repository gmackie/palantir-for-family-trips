import assert from "node:assert/strict";
import { test } from "node:test";
import { selectedTripSegment, showsSegmentColumns } from "./segment-layout.ts";

const segments = [
  { id: "north", startDate: "2026-11-25", endDate: "2026-11-26" },
  { id: "lake", startDate: "2026-11-27", endDate: "2026-11-29" },
  { id: "home", startDate: "2026-11-30", endDate: null },
];

test("starts at the current leg and retains an explicitly selected stop across refreshes", () => {
  assert.equal(selectedTripSegment(segments, null, "2026-11-27")?.id, "lake");
  assert.equal(selectedTripSegment(segments, "home", "2026-11-27")?.id, "home");
  assert.equal(
    selectedTripSegment(segments.slice(1), "north", "2026-11-27")?.id,
    "lake",
  );
  assert.equal(selectedTripSegment([], "north", "2026-11-27"), undefined);
});

test("fits list and detail to the available width and text size", () => {
  assert.equal(showsSegmentColumns(375, 1), false);
  assert.equal(showsSegmentColumns(637, 1), true);
  assert.equal(showsSegmentColumns(820, 2), false);
});

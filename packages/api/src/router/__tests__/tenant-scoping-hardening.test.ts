/**
 * Regression guards for hardening plan 002 — re-anchor trip-child writes.
 *
 * These three sites act on a bare row id (or row id + caller's own user id)
 * and must be scoped to `ctx.tripId` / the row's trip. They are raw Drizzle
 * calls with no injectable store, so — following the sibling
 * `tenant-scoping.test.ts` convention for inline mutations — we read the
 * source and assert the trip-scoping predicate is present in the relevant
 * function body. If a refactor drops the scope, these fail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

function read(relPath: string): string {
  return readFileSync(join(SRC, relPath), "utf8");
}

/** Slice a source string from an anchor marker to the next top-level boundary. */
function sliceFrom(
  src: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = src.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + startMarker.length);
  const end = rest.indexOf(endMarker);
  return end >= 0 ? rest.slice(0, end) : rest;
}

describe("hardening 002 — anchor writes are trip-scoped", () => {
  const src = read("route-planner/anchor-ops.ts");

  it("updateAnchor's where clause includes tripAnchors.tripId", () => {
    const body = sliceFrom(
      src,
      "export async function updateAnchor",
      "export async function deleteAnchor",
    );
    expect(body).toContain("eq(tripAnchors.tripId");
  });

  it("deleteAnchor accepts tripId and scopes the delete", () => {
    const body = sliceFrom(src, "export async function deleteAnchor", "\n/**");
    expect(body).toContain("tripId: string");
    expect(body).toContain("eq(tripAnchors.tripId");
  });

  it("the anchors router passes ctx.tripId into deleteAnchor", () => {
    expect(read("router/anchors.ts")).toContain(
      "deleteAnchor(ctx.db, ctx.tripId",
    );
  });
});

describe("hardening 002 — line-item unclaim is trip-scoped", () => {
  it("unclaimLineItem verifies the expense belongs to ctx.tripId before deleting", () => {
    const body = sliceFrom(
      read("router/expenses.ts"),
      "unclaimLineItem: tripProcedure()",
      "assignLineItem: tripProcedure()",
    );
    expect(body).toContain("eq(expenses.tripId, ctx.tripId)");
  });
});

describe("hardening 002 — settlement idempotency read-back is trip-scoped", () => {
  it("record re-reads by (idempotencyKey, tripId) and throws CONFLICT on cross-trip collision", () => {
    const body = sliceFrom(
      read("router/settlements.ts"),
      "record: tripProcedure()",
      "undo: tripProcedure()",
    );
    expect(body).toContain("eq(settlements.tripId, ctx.tripId)");
    expect(body).toContain('code: "CONFLICT"');
  });
});

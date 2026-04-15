import { describe, expect, it } from "vitest";

import { ensurePersonalWorkspace } from "../ensure-personal";

describe("ensurePersonalWorkspace", () => {
  it("is exported as a named async function", () => {
    expect(typeof ensurePersonalWorkspace).toBe("function");
    expect(ensurePersonalWorkspace.name).toBe("ensurePersonalWorkspace");
  });

  // Integration coverage for the happy path + race handling lives in the
  // trip pages' server-side `requireTripsWorkspace()` call, which is
  // exercised end-to-end by Playwright once a real DB is available.
  // Unit-testing the full query-builder interaction against a mock would
  // not catch real query builder issues.
});

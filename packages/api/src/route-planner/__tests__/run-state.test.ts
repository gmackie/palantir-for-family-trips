import { describe, expect, it } from "vitest";

import { lifecycleStatusForRunState } from "../today-command-ops";

describe("lifecycleStatusForRunState", () => {
  it("pauses en_route when entering a side trip", () => {
    expect(lifecycleStatusForRunState("en_route", "side_trip")).toBe("paused");
  });

  it("pauses en_route when entering explicit pause", () => {
    expect(lifecycleStatusForRunState("en_route", "paused")).toBe("paused");
  });

  it("resumes paused trips to en_route when back on plan", () => {
    expect(lifecycleStatusForRunState("paused", "on_plan")).toBe("en_route");
  });

  it("leaves non-road statuses alone", () => {
    expect(lifecycleStatusForRunState("active", "side_trip")).toBeNull();
    expect(lifecycleStatusForRunState("planning", "paused")).toBeNull();
    expect(lifecycleStatusForRunState("completed", "on_plan")).toBeNull();
  });

  it("does not double-flip already paused while still off plan", () => {
    expect(lifecycleStatusForRunState("paused", "side_trip")).toBeNull();
  });
});

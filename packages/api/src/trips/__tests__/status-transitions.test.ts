import { describe, expect, it } from "vitest";
import {
  assertValidTripStatusTransition,
  isValidTripStatusTransition,
  TRIP_STATUS_TRANSITIONS,
} from "../status-transitions";

describe("TRIP_STATUS_TRANSITIONS map", () => {
  it("covers every TripStatus key", () => {
    const keys = Object.keys(TRIP_STATUS_TRANSITIONS);
    expect(keys.sort()).toEqual([
      "active",
      "completed",
      "confirmed",
      "en_route",
      "paused",
      "planning",
    ]);
  });
});

describe("isValidTripStatusTransition", () => {
  // ── same-state (idempotent) ────────────────────────────────────────────────
  it("allows same-state transition (planning → planning)", () => {
    expect(isValidTripStatusTransition("planning", "planning")).toBe(true);
  });

  it("allows same-state transition (completed → completed)", () => {
    expect(isValidTripStatusTransition("completed", "completed")).toBe(true);
  });

  // ── allowed edges ──────────────────────────────────────────────────────────
  it("allows planning → confirmed (lock-in wizard)", () => {
    expect(isValidTripStatusTransition("planning", "confirmed")).toBe(true);
  });

  it("allows planning → en_route (road-trip Start Trip)", () => {
    expect(isValidTripStatusTransition("planning", "en_route")).toBe(true);
  });

  it("allows confirmed → planning (undo confirm)", () => {
    expect(isValidTripStatusTransition("confirmed", "planning")).toBe(true);
  });

  it("allows confirmed → active", () => {
    expect(isValidTripStatusTransition("confirmed", "active")).toBe(true);
  });

  it("allows active → en_route (start driving)", () => {
    expect(isValidTripStatusTransition("active", "en_route")).toBe(true);
  });

  it("allows active → completed", () => {
    expect(isValidTripStatusTransition("active", "completed")).toBe(true);
  });

  it("allows en_route → paused", () => {
    expect(isValidTripStatusTransition("en_route", "paused")).toBe(true);
  });

  it("allows en_route → active", () => {
    expect(isValidTripStatusTransition("en_route", "active")).toBe(true);
  });

  it("allows en_route → completed (End Trip while driving)", () => {
    expect(isValidTripStatusTransition("en_route", "completed")).toBe(true);
  });

  it("allows paused → en_route (Resume)", () => {
    expect(isValidTripStatusTransition("paused", "en_route")).toBe(true);
  });

  it("allows paused → active", () => {
    expect(isValidTripStatusTransition("paused", "active")).toBe(true);
  });

  it("allows paused → completed (End Trip while paused)", () => {
    expect(isValidTripStatusTransition("paused", "completed")).toBe(true);
  });

  // ── disallowed edges ───────────────────────────────────────────────────────
  it("forbids completed → planning", () => {
    expect(isValidTripStatusTransition("completed", "planning")).toBe(false);
  });

  it("forbids completed → active", () => {
    expect(isValidTripStatusTransition("completed", "active")).toBe(false);
  });

  it("forbids completed → en_route", () => {
    expect(isValidTripStatusTransition("completed", "en_route")).toBe(false);
  });

  it("forbids completed → confirmed", () => {
    expect(isValidTripStatusTransition("completed", "confirmed")).toBe(false);
  });

  it("forbids planning → active (skips confirm)", () => {
    expect(isValidTripStatusTransition("planning", "active")).toBe(false);
  });

  it("forbids planning → paused", () => {
    expect(isValidTripStatusTransition("planning", "paused")).toBe(false);
  });

  it("forbids planning → completed", () => {
    expect(isValidTripStatusTransition("planning", "completed")).toBe(false);
  });

  it("forbids active → planning", () => {
    expect(isValidTripStatusTransition("active", "planning")).toBe(false);
  });

  it("forbids active → confirmed", () => {
    expect(isValidTripStatusTransition("active", "confirmed")).toBe(false);
  });

  it("forbids active → paused (must go en_route first)", () => {
    expect(isValidTripStatusTransition("active", "paused")).toBe(false);
  });
});

describe("assertValidTripStatusTransition", () => {
  it("does not throw for a valid transition", () => {
    expect(() =>
      assertValidTripStatusTransition("planning", "confirmed"),
    ).not.toThrow();
  });

  it("does not throw for a same-state transition", () => {
    expect(() =>
      assertValidTripStatusTransition("en_route", "en_route"),
    ).not.toThrow();
  });

  it("throws BAD_REQUEST for completed → planning", () => {
    expect(() =>
      assertValidTripStatusTransition("completed", "planning"),
    ).toThrow(
      expect.objectContaining({
        code: "BAD_REQUEST",
        message: "Cannot move trip from 'completed' to 'planning'.",
      }),
    );
  });

  it("throws BAD_REQUEST for planning → active", () => {
    expect(() => assertValidTripStatusTransition("planning", "active")).toThrow(
      expect.objectContaining({
        code: "BAD_REQUEST",
      }),
    );
  });

  it("throws BAD_REQUEST for planning → en_route — wait, this IS allowed", () => {
    // planning → en_route is an allowed edge (road-trip Start Trip)
    expect(() =>
      assertValidTripStatusTransition("planning", "en_route"),
    ).not.toThrow();
  });

  it("throws BAD_REQUEST for active → planning (backwards jump)", () => {
    expect(() => assertValidTripStatusTransition("active", "planning")).toThrow(
      expect.objectContaining({
        code: "BAD_REQUEST",
      }),
    );
  });
});

import { describe, expect, it } from "vitest";

import { requireOrganizer, requireOrganizerOrSelf } from "../organizer";

describe("requireOrganizer", () => {
  it("does not throw when tripRole is organizer", () => {
    expect(() => requireOrganizer("organizer")).not.toThrow();
  });

  it("throws FORBIDDEN with default message when tripRole is member", () => {
    expect(() => requireOrganizer("member")).toThrowError(
      "Only organizers can perform this action.",
    );
  });

  it("throws FORBIDDEN with custom message when provided", () => {
    expect(() => requireOrganizer("member", "custom")).toThrowError("custom");
  });
});

describe("requireOrganizerOrSelf", () => {
  it("does not throw when user is the resource owner (self)", () => {
    expect(() => requireOrganizerOrSelf("member", "u1", "u1")).not.toThrow();
  });

  it("throws FORBIDDEN when member tries to modify another user's resource", () => {
    expect(() => requireOrganizerOrSelf("member", "u1", "u2")).toThrowError(
      "Only the payer or a trip organizer can modify this expense.",
    );
  });

  it("does not throw when tripRole is organizer regardless of owner", () => {
    expect(() => requireOrganizerOrSelf("organizer", "u1", "u2")).not.toThrow();
  });
});

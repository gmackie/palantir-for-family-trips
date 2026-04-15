import { describe, expect, it } from "vitest";

import { parseTripSettingsFormData } from "./trip-settings-form";

describe("parseTripSettingsFormData", () => {
  it("parses trimmed settings values and toggles", () => {
    const formData = new FormData();
    formData.set("name", "  Italy Summer Reset  ");
    formData.set("destinationName", "  Florence, Italy  ");
    formData.set("startDate", "2026-06-02");
    formData.set("endDate", "2026-06-09");
    formData.set("tz", "Europe/Rome");
    formData.set("groupMode", "on");
    formData.set("claimMode", "tap");

    expect(parseTripSettingsFormData(formData)).toEqual({
      claimMode: "tap",
      destinationName: "Florence, Italy",
      endDate: "2026-06-09",
      groupMode: true,
      name: "Italy Summer Reset",
      startDate: "2026-06-02",
      tz: "Europe/Rome",
    });
  });

  it("defaults unchecked group mode and organizer claim mode", () => {
    const formData = new FormData();
    formData.set("name", "Weekend Reset");
    formData.set("destinationName", "Groveland, CA");
    formData.set("claimMode", "organizer");

    expect(parseTripSettingsFormData(formData)).toEqual({
      claimMode: "organizer",
      destinationName: "Groveland, CA",
      groupMode: false,
      name: "Weekend Reset",
      tz: "UTC",
    });
  });

  it("rejects invalid claim modes", () => {
    const formData = new FormData();
    formData.set("name", "Weekend Reset");
    formData.set("destinationName", "Groveland, CA");
    formData.set("claimMode", "sideways");

    expect(() => parseTripSettingsFormData(formData)).toThrow(
      'Invalid option: expected one of "organizer"|"tap"',
    );
  });
});

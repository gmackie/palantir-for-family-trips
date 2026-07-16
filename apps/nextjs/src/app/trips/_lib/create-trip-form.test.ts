import { describe, expect, it } from "vitest";

import { parseCreateTripFormData } from "./create-trip-form";

describe("parseCreateTripFormData", () => {
  it("builds a trip creation payload from trimmed form values", () => {
    const formData = new FormData();
    formData.set("name", "  Italy Summer  ");
    formData.set("destinationName", "  Milan, Italy  ");
    formData.set("startDate", "2026-06-01");
    formData.set("endDate", "2026-06-08");
    formData.set("tz", "Europe/Rome");
    formData.set("groupMode", "true");
    formData.set("tripMode", "destination");

    expect(parseCreateTripFormData(formData)).toEqual({
      destinationName: "Milan, Italy",
      endDate: "2026-06-08",
      groupMode: true,
      name: "Italy Summer",
      startDate: "2026-06-01",
      tripMode: "destination",
      tz: "Europe/Rome",
    });
  });

  it("defaults group mode to family (false) and trip mode to destination", () => {
    const formData = new FormData();
    formData.set("name", "Weekend Reset");
    formData.set("destinationName", "Groveland, CA");
    formData.set("startDate", "");
    formData.set("endDate", "");

    expect(parseCreateTripFormData(formData)).toEqual({
      destinationName: "Groveland, CA",
      groupMode: false,
      name: "Weekend Reset",
      tripMode: "destination",
      tz: "UTC",
    });
  });

  it("parses family mode radio value", () => {
    const formData = new FormData();
    formData.set("name", "Solo Escape");
    formData.set("destinationName", "Yosemite");
    formData.set("groupMode", "false");

    expect(parseCreateTripFormData(formData).groupMode).toBe(false);
  });

  it("parses checkbox-style group mode on", () => {
    const formData = new FormData();
    formData.set("name", "Friends Weekend");
    formData.set("destinationName", "Austin");
    formData.set("groupMode", "on");

    expect(parseCreateTripFormData(formData).groupMode).toBe(true);
  });

  it("parses roadtrip mode", () => {
    const formData = new FormData();
    formData.set("name", "Pacific Coast");
    formData.set("destinationName", "San Diego");
    formData.set("tripMode", "roadtrip");
    formData.set("groupMode", "false");

    expect(parseCreateTripFormData(formData)).toMatchObject({
      tripMode: "roadtrip",
      groupMode: false,
    });
  });

  it("rejects missing trip names", () => {
    const formData = new FormData();
    formData.set("name", "   ");
    formData.set("destinationName", "Milan, Italy");

    expect(() => parseCreateTripFormData(formData)).toThrow(
      "Trip name is required",
    );
  });

  it("rejects missing destinations", () => {
    const formData = new FormData();
    formData.set("name", "Italy Summer");
    formData.set("destinationName", "   ");

    expect(() => parseCreateTripFormData(formData)).toThrow(
      "Destination is required",
    );
  });
});

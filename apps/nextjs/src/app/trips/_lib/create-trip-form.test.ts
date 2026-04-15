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

    expect(parseCreateTripFormData(formData)).toEqual({
      destinationName: "Milan, Italy",
      endDate: "2026-06-08",
      name: "Italy Summer",
      startDate: "2026-06-01",
      tz: "Europe/Rome",
    });
  });

  it("omits empty optional dates while still requiring a destination", () => {
    const formData = new FormData();
    formData.set("name", "Weekend Reset");
    formData.set("destinationName", "Groveland, CA");
    formData.set("startDate", "");
    formData.set("endDate", "");

    expect(parseCreateTripFormData(formData)).toEqual({
      destinationName: "Groveland, CA",
      name: "Weekend Reset",
      tz: "UTC",
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

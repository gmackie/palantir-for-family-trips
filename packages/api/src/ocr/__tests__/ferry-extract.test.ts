import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractFerryBooking } from "../index";

describe("extractFerryBooking", () => {
  const prevProvider = process.env.OCR_PROVIDER;

  beforeEach(() => {
    process.env.OCR_PROVIDER = "fixture";
  });

  afterEach(() => {
    if (prevProvider === undefined) {
      delete process.env.OCR_PROVIDER;
    } else {
      process.env.OCR_PROVIDER = prevProvider;
    }
  });

  it("mock provider extracts ferry booking from fixture", async () => {
    const result = await extractFerryBooking({
      imageBytes: Buffer.from("wsf"),
      mimeType: "image/png",
    });
    expect(result.arrivalTerminal).toBe("Kingston");
    expect(result.operator).toBe("Washington State Ferries");
    expect(result.fareCents).toBe(1675);
    expect(result.vehicleReservation).toBe(true);
  });
});

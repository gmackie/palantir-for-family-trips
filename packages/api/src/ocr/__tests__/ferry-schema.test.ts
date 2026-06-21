import { describe, expect, it } from "vitest";

import { ferryBookingSchema } from "../schema";

describe("ferryBookingSchema", () => {
  it("parses a WSF-style booking", () => {
    const parsed = ferryBookingSchema.parse({
      operator: "Washington State Ferries",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      departureAt: "2026-07-09T14:05:00",
      confirmationNumber: "WSF-12345",
      fareCents: 1675,
      currency: "USD",
      vehicleReservation: true,
      passengerNote: "Car + 2 passengers",
    });
    expect(parsed.arrivalTerminal).toBe("Kingston");
    expect(parsed.fareCents).toBe(1675);
  });

  it("defaults optional fields", () => {
    const parsed = ferryBookingSchema.parse({
      operator: "WSF",
      departureTerminal: "Edmonds",
      arrivalTerminal: "Kingston",
      departureAt: "2026-07-09T14:05:00",
      currency: "USD",
    });
    expect(parsed.vehicleReservation).toBe(false);
    expect(parsed.fareCents).toBeNull();
  });
});

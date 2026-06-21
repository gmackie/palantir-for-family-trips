import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockTelemetryProvider } from "../mock";
import { resolveTelemetryProvider } from "../resolve";

describe("MockTelemetryProvider", () => {
  it("returns a realistic multi-system snapshot", async () => {
    const provider = new MockTelemetryProvider();
    const readings = await provider.getSnapshot("any-rig");

    // One reading per system/metric across all four subsystems.
    const systems = new Set(readings.map((r) => r.system));
    expect(systems).toEqual(new Set(["power", "solar", "climate", "water"]));

    const soc = readings.find((r) => r.metric === "battery_soc");
    expect(soc).toMatchObject({ value: 87, unit: "%" });

    const voltage = readings.find((r) => r.metric === "voltage");
    expect(voltage).toMatchObject({ value: 12.4, unit: "V" });

    // Every reading is well-formed.
    for (const r of readings) {
      expect(typeof r.value).toBe("number");
      expect(r.unit.length).toBeGreaterThan(0);
      expect(() => new Date(r.readAt).toISOString()).not.toThrow();
    }
  });
});

describe("resolveTelemetryProvider", () => {
  const originalKey = process.env.DRIFTPORT_API_KEY;

  beforeEach(() => {
    delete process.env.DRIFTPORT_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.DRIFTPORT_API_KEY;
    } else {
      process.env.DRIFTPORT_API_KEY = originalKey;
    }
  });

  it("falls back to the mock provider when no API key is set", () => {
    delete process.env.DRIFTPORT_API_KEY;
    const provider = resolveTelemetryProvider();
    expect(provider).toBeInstanceOf(MockTelemetryProvider);
  });
});

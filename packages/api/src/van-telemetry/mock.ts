import type { VanTelemetryProvider } from "./provider";
import type { VanSystemReading } from "./types";

/**
 * Deterministic mock telemetry provider. Returns a realistic single snapshot
 * across the four van subsystems so the Driving Mode card can be built and
 * demoed before a driftport service-account key exists. `readAt` is fixed for
 * reproducible tests.
 */
export class MockTelemetryProvider implements VanTelemetryProvider {
  async getSnapshot(_rigId: string): Promise<VanSystemReading[]> {
    const readAt = "2026-06-21T12:00:00.000Z";
    return [
      { system: "power", metric: "battery_soc", value: 87, unit: "%", readAt },
      { system: "power", metric: "voltage", value: 12.4, unit: "V", readAt },
      { system: "solar", metric: "input", value: 240, unit: "W", readAt },
      {
        system: "climate",
        metric: "inside_temp",
        value: 72,
        unit: "°F",
        readAt,
      },
      { system: "water", metric: "fresh_level", value: 64, unit: "%", readAt },
    ];
  }
}

import type { VanSystemReading } from "./types";

/**
 * Abstraction over a source of live van-system telemetry. Implementations:
 *   - `MockTelemetryProvider`     — deterministic sample data (default).
 *   - `DriftportTelemetryProvider` — real HTTP call to driftport's tRPC API.
 *
 * `getSnapshot` returns the latest reading per system/metric for one rig. It may
 * reject (network/parse failure for the real provider); the router catches and
 * returns `null` so Driving Mode never crashes.
 */
export interface VanTelemetryProvider {
  getSnapshot(rigId: string): Promise<VanSystemReading[]>;
}

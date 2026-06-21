import { DriftportTelemetryProvider } from "./driftport";
import { MockTelemetryProvider } from "./mock";
import type { VanTelemetryProvider } from "./provider";

/**
 * Pick the telemetry provider at runtime. Returns the real driftport provider
 * only when `DRIFTPORT_API_KEY` is configured; otherwise falls back to the mock.
 *
 * NOTE: this only checks for the presence of credentials. The feature flag gate
 * (`driftportTelemetryPreview`) lives in the router — provider selection is
 * purely about whether a real backend is reachable.
 */
export function resolveTelemetryProvider(): VanTelemetryProvider {
  if (process.env.DRIFTPORT_API_KEY) {
    return new DriftportTelemetryProvider();
  }
  return new MockTelemetryProvider();
}

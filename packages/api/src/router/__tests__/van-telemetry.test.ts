import { afterEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

import { clearAllOverrides, setOverride } from "@sortey/flags";
import type { VanTelemetryProvider } from "../../van-telemetry/provider";
import type { VanSystemReading } from "../../van-telemetry/types";
import {
  getVanTelemetrySnapshot,
  type VanTelemetryStore,
} from "../van-telemetry";

// ── Store fake: trip → vanProfile.driftportRigId via the latest fuel log ─────

function createTelemetryStore(rigId: string | null): VanTelemetryStore {
  return {
    findDriftportRigId: async () => rigId,
  };
}

const SAMPLE: VanSystemReading[] = [
  {
    system: "power",
    metric: "battery_soc",
    value: 87,
    unit: "%",
    readAt: "2026-06-21T12:00:00.000Z",
  },
];

function provider(readings: VanSystemReading[]): VanTelemetryProvider {
  return { getSnapshot: async () => readings };
}

function throwingProvider(): VanTelemetryProvider {
  return {
    getSnapshot: async () => {
      throw new Error("driftport unreachable");
    },
  };
}

const RIG_ID = "11111111-1111-1111-1111-111111111111";

afterEach(() => {
  clearAllOverrides();
});

describe("getVanTelemetrySnapshot", () => {
  it("returns null when the flag is off", async () => {
    setOverride("driftportTelemetryPreview", false);

    const result = await getVanTelemetrySnapshot({
      store: createTelemetryStore(RIG_ID),
      provider: provider(SAMPLE),
      userId: "user_1",
      tripId: "trip_1",
    });

    expect(result).toBeNull();
  });

  it("returns null when the trip's van has no linked rig", async () => {
    setOverride("driftportTelemetryPreview", true);

    const result = await getVanTelemetrySnapshot({
      store: createTelemetryStore(null),
      provider: provider(SAMPLE),
      userId: "user_1",
      tripId: "trip_1",
    });

    expect(result).toBeNull();
  });

  it("returns provider readings when the flag is on and a rig is linked", async () => {
    setOverride("driftportTelemetryPreview", true);

    const result = await getVanTelemetrySnapshot({
      store: createTelemetryStore(RIG_ID),
      provider: provider(SAMPLE),
      userId: "user_1",
      tripId: "trip_1",
    });

    expect(result).toEqual(SAMPLE);
  });

  it("returns null (never throws) when the provider fails", async () => {
    setOverride("driftportTelemetryPreview", true);

    const result = await getVanTelemetrySnapshot({
      store: createTelemetryStore(RIG_ID),
      provider: throwingProvider(),
      userId: "user_1",
      tripId: "trip_1",
    });

    expect(result).toBeNull();
  });
});

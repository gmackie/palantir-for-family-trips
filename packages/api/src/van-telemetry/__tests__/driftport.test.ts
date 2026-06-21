import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriftportTelemetryProvider } from "../driftport";

const RIG_ID = "11111111-1111-1111-1111-111111111111";

describe("DriftportTelemetryProvider", () => {
  const original = {
    url: process.env.DRIFTPORT_API_URL,
    key: process.env.DRIFTPORT_API_KEY,
  };

  beforeEach(() => {
    process.env.DRIFTPORT_API_URL = "https://driftport.example.com";
    process.env.DRIFTPORT_API_KEY = "gmk_test_key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restore("DRIFTPORT_API_URL", original.url);
    restore("DRIFTPORT_API_KEY", original.key);
  });

  it("maps a superjson-wrapped dashboard response into VanSystemReading[]", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // Calls driftport's tRPC system.dashboard query endpoint with the bearer
      // service token and a superjson-wrapped rigId input.
      expect(url).toContain("/api/trpc/system.dashboard?input=");
      expect(url).toContain(encodeURIComponent('{"json":{"rigId":'));
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe("Bearer gmk_test_key");

      return new Response(
        JSON.stringify({
          result: {
            data: {
              json: [
                {
                  rigId: RIG_ID,
                  deviceId: "dev_1",
                  system: "power",
                  metric: "battery_soc",
                  value: 91,
                  unit: "%",
                  readAt: "2026-06-21T10:00:00.000Z",
                },
                {
                  rigId: RIG_ID,
                  deviceId: "dev_1",
                  system: "water",
                  metric: "fresh_level",
                  value: 50,
                  unit: "%",
                  readAt: "2026-06-21T10:00:00.000Z",
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DriftportTelemetryProvider();
    const readings = await provider.getSnapshot(RIG_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readings).toEqual([
      {
        system: "power",
        metric: "battery_soc",
        value: 91,
        unit: "%",
        readAt: "2026-06-21T10:00:00.000Z",
      },
      {
        system: "water",
        metric: "fresh_level",
        value: 50,
        unit: "%",
        readAt: "2026-06-21T10:00:00.000Z",
      },
    ]);
  });

  it("throws on a non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );

    const provider = new DriftportTelemetryProvider();
    await expect(provider.getSnapshot(RIG_ID)).rejects.toThrow(/403/);
  });

  it("throws when the API URL is missing", async () => {
    delete process.env.DRIFTPORT_API_URL;
    const provider = new DriftportTelemetryProvider();
    await expect(provider.getSnapshot(RIG_ID)).rejects.toThrow(
      /DRIFTPORT_API_URL/,
    );
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

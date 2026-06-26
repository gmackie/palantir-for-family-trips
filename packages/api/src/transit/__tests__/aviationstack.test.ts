import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFlightStatus, mapFlightStatus } from "../aviationstack";

const sched = new Date("2026-07-09T18:00:00Z");
const onTime = new Date("2026-07-09T18:10:00Z"); // +10 min
const late = new Date("2026-07-09T18:45:00Z"); // +45 min

describe("mapFlightStatus", () => {
  it("maps the basic statuses", () => {
    expect(mapFlightStatus("scheduled", sched, onTime)).toBe("scheduled");
    expect(mapFlightStatus("active", sched, onTime)).toBe("en_route");
    expect(mapFlightStatus("landed", sched, onTime)).toBe("arrived");
    expect(mapFlightStatus("cancelled", sched, onTime)).toBe("cancelled");
    expect(mapFlightStatus("incident", sched, onTime)).toBe("delayed");
    expect(mapFlightStatus("diverted", sched, onTime)).toBe("delayed");
  });

  it("flags >30 min divergence as delayed for scheduled/active", () => {
    expect(mapFlightStatus("scheduled", sched, late)).toBe("delayed");
    expect(mapFlightStatus("active", sched, late)).toBe("delayed");
  });

  it("does not over-flag when on time or times unknown", () => {
    expect(mapFlightStatus("scheduled", sched, onTime)).toBe("scheduled");
    expect(mapFlightStatus("scheduled", null, late)).toBe("scheduled");
    expect(mapFlightStatus(undefined, sched, onTime)).toBe("scheduled");
  });
});

describe("fetchFlightStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status: number, json: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
      })),
    );
  }

  it("returns null without an API key", async () => {
    stubFetch(200, { data: [] });
    expect(await fetchFlightStatus({ flightIata: "UA123" })).toBeNull();
  });

  it("maps arrival times + status on success", async () => {
    stubFetch(200, {
      data: [
        {
          flight_date: "2026-07-09",
          flight_status: "landed",
          arrival: {
            scheduled: "2026-07-09T18:00:00+00:00",
            estimated: "2026-07-09T18:05:00+00:00",
            actual: "2026-07-09T18:07:00+00:00",
          },
        },
      ],
    });
    const r = await fetchFlightStatus({ flightIata: "UA 123", apiKey: "k" });
    expect(r?.trackingStatus).toBe("arrived");
    expect(r?.actualAt?.toISOString()).toBe("2026-07-09T18:07:00.000Z");
  });

  it("picks the flight matching scheduledDate", async () => {
    stubFetch(200, {
      data: [
        { flight_date: "2026-07-08", flight_status: "landed", arrival: {} },
        {
          flight_date: "2026-07-09",
          flight_status: "active",
          arrival: { scheduled: "2026-07-09T18:00:00Z" },
        },
      ],
    });
    const r = await fetchFlightStatus({
      flightIata: "UA123",
      scheduledDate: "2026-07-09",
      apiKey: "k",
    });
    expect(r?.trackingStatus).toBe("en_route");
  });

  it("returns null on non-200 and on empty data", async () => {
    stubFetch(500, {});
    expect(
      await fetchFlightStatus({ flightIata: "UA123", apiKey: "k" }),
    ).toBeNull();
    stubFetch(200, { data: [] });
    expect(
      await fetchFlightStatus({ flightIata: "UA123", apiKey: "k" }),
    ).toBeNull();
  });
});

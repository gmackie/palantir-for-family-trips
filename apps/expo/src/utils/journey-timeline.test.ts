import { describe, expect, it } from "vitest";

import { mergeJourneyTimeline } from "./journey-timeline";

describe("mergeJourneyTimeline", () => {
  it("adds queued stops without duplicating server-confirmed stops", () => {
    const server = [{ id: "confirmed", arrivedAt: "2026-07-12T12:00:00Z" }];
    const queued = [
      { stopId: "confirmed", arrivedAt: "2026-07-12T12:00:00Z" },
      { stopId: "offline", arrivedAt: "2026-07-12T13:00:00Z" },
    ];

    expect(mergeJourneyTimeline(server, queued)).toEqual([
      { id: "confirmed", arrivedAt: "2026-07-12T12:00:00Z" },
      {
        id: "offline",
        arrivedAt: "2026-07-12T13:00:00Z",
        syncState: "queued",
      },
    ]);
  });
});

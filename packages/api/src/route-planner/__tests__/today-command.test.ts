import { tripAnchors, tripDays, trips } from "@sortey/db/schema";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { getTodayCommand } from "../today-command-ops";

// Actual reserved LA trip/day rows captured read-only at 2026-10-07T04:31Z.
const fixture = {
  trip: {
    id: "26800ff8-8e68-4919-aba9-66235f65a2dd",
    workspaceId: "16eb2b42-3e32-4d60-8da9-454c480238b3",
    name: "Simulator Review Road Trip 2026-10-06",
    createdByUserId: "9s12LMV8Ju40QElXgapWuX73hKoBtaoY",
    status: "planning",
    tripMode: "roadtrip",
    groupMode: false,
    claimMode: "organizer",
    destinationName: null,
    destinationLat: null,
    destinationLng: null,
    defaultZoom: 13,
    startDate: "2026-10-06",
    endDate: "2026-10-08",
    tz: "America/Los_Angeles",
    createdAt: "2026-10-06T17:51:01.189Z",
    updatedAt: "2026-10-06T17:51:01.189Z",
  },
  days: [
    {
      id: "f34e8ea7-eba4-4059-9d5c-254decf15fe7",
      tripId: "26800ff8-8e68-4919-aba9-66235f65a2dd",
      date: "2026-10-06",
      intent: "play",
      title: "Review day: prepare and explore",
      overnightName: "Reviewer planned overnight",
      overnightKind: "hotel",
      overnightLat: null,
      overnightLng: null,
      heroTitle: "Review trail walk",
      heroDetail:
        "Controlled simulator reviewer plan; no invented mileage or live reservations",
      cutIfBehind: null,
      blocksJson: [
        {
          part: "morning",
          title: "Review departure checklist",
          detail: "Check the recorded trip day plan before departure",
        },
        {
          part: "evening",
          title: "Review overnight check-in",
          detail: "Controlled reviewer planning activity",
        },
      ],
      segmentId: null,
      sortOrder: 0,
      note: "Reserved simulator fixture created through supported planner API",
      status: "planned",
      completedAt: null,
      actualNote: null,
    },
    {
      id: "01bba8f1-1903-4d70-8d27-47a2c59f2b5c",
      tripId: "26800ff8-8e68-4919-aba9-66235f65a2dd",
      date: "2026-10-07",
      intent: "drive",
      title: "Review day: travel and settle",
      overnightName: "Reviewer planned overnight",
      overnightKind: "hotel",
      overnightLat: null,
      overnightLng: null,
      heroTitle: "Review scenic stop",
      heroDetail:
        "Controlled simulator reviewer plan; no invented mileage or live reservations",
      cutIfBehind: null,
      blocksJson: [
        {
          part: "morning",
          title: "Review departure checklist",
          detail: "Check the recorded trip day plan before departure",
        },
        {
          part: "evening",
          title: "Review overnight check-in",
          detail: "Controlled reviewer planning activity",
        },
      ],
      segmentId: null,
      sortOrder: 0,
      note: "Reserved simulator fixture created through supported planner API",
      status: "planned",
      completedAt: null,
      actualNote: null,
    },
  ],
};

function capturedStore(tz: string) {
  return {
    select() {
      let rows: object[] = [];
      const query = {
        from(table: PgTable) {
          if (table === trips)
            rows = [{ tz, runState: "on_plan", runStateNote: null }];
          else if (table === tripDays) rows = fixture.days;
          else if (table === tripAnchors)
            rows = [
              {
                title: "Review commitment",
                startDate: "2026-10-08",
                endDate: null,
                kind: "event",
                lat: null,
                lng: null,
              },
            ];
          else rows = [];
          return query;
        },
        where() {
          return query;
        },
        orderBy() {
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows),
          });
        },
        limit() {
          return Promise.resolve(rows);
        },
      };
      return query;
    },
  };
}

const input = {
  workspaceId: fixture.trip.workspaceId,
  tripId: fixture.trip.id,
  now: new Date("2026-10-07T04:32:50.027Z"),
};
describe("Today Command trip-local day", () => {
  it("selects actual LA day, tomorrow and anchor pacing after UTC midnight", async () => {
    const result = await getTodayCommand(capturedStore(fixture.trip.tz), input);
    expect(result.date).toBe("2026-10-06");
    expect(result.day?.title).toBe("Review day: prepare and explore");
    expect(result.tomorrow?.date).toBe("2026-10-07");
    expect(result.nextAnchor?.daysAway).toBe(2);
    expect(result.recentDays.map((d) => [d.date, d.isToday])).toEqual([
      ["2026-10-06", true],
      ["2026-10-07", false],
    ]);
  });
  it("retains an explicit date override", async () => {
    const result = await getTodayCommand(capturedStore(fixture.trip.tz), {
      ...input,
      date: "2026-10-07",
    });
    expect(result.date).toBe("2026-10-07");
    expect(result.day?.title).toBe("Review day: travel and settle");
  });
  it("selects tomorrow after the trip's own midnight", async () => {
    const result = await getTodayCommand(capturedStore(fixture.trip.tz), {
      ...input,
      now: new Date("2026-10-07T07:00:00Z"),
    });
    expect(result.date).toBe("2026-10-07");
    expect(result.nextAnchor?.daysAway).toBe(1);
  });
  it("returns a UTC day and effective UTC timezone for invalid stored timezone", async () => {
    const result = await getTodayCommand(
      capturedStore("Review/Invalid"),
      input,
    );
    expect(result.date).toBe("2026-10-07");
    expect(result.tz).toBe("UTC");
  });
});

import { describe, expect, it } from "vitest";
import {
  encodeTodayCacheTimezone,
  readTodayCache,
  resolveTodayCacheDay,
  type TodayCacheStorage,
  todayCacheIdentityMatches,
  writeTodayCache,
} from "./today-cache-day";

const laIndex = encodeTodayCacheTimezone("America/Los_Angeles");
describe("Today cache trip-local lookup", () => {
  it("reads the same Oct6 key that the captured LA Today payload writes", () => {
    const key = resolveTodayCacheDay(laIndex, new Date("2026-10-07T04:32:50Z"));
    expect(key).toEqual({ date: "2026-10-06", tz: "America/Los_Angeles" });
    expect(
      todayCacheIdentityMatches(
        JSON.stringify({ payload: key }),
        key.date,
        key.tz,
      ),
    ).toBe(true);
  });
  it("changes key at trip midnight, avoiding the prior day's snapshot", () => {
    const key = resolveTodayCacheDay(laIndex, new Date("2026-10-07T07:00:00Z"));
    expect(key.date).toBe("2026-10-07");
    expect(
      todayCacheIdentityMatches(
        JSON.stringify({ payload: { date: "2026-10-06", tz: key.tz } }),
        key.date,
        key.tz,
      ),
    ).toBe(false);
  });
  it("keeps the same trip day through spring DST jump", () => {
    expect(
      resolveTodayCacheDay(laIndex, new Date("2026-03-08T09:59:59Z")),
    ).toEqual(resolveTodayCacheDay(laIndex, new Date("2026-03-08T10:00:00Z")));
  });
  it("rejects another timezone's same-date snapshot", () => {
    expect(
      todayCacheIdentityMatches(
        JSON.stringify({ payload: { date: "2026-10-06", tz: "UTC" } }),
        "2026-10-06",
        "America/Los_Angeles",
      ),
    ).toBe(false);
  });
  it.each([
    "{}",
    "invalid",
    '{"schemaVersion":2,"tz":"UTC"}',
  ])("rejects missing or malformed metadata %s", (raw) => {
    expect(() => resolveTodayCacheDay(raw, new Date())).toThrow();
  });
  it("normalizes invalid stored timezone to effective UTC", () => {
    expect(
      resolveTodayCacheDay(
        encodeTodayCacheTimezone("Review/Invalid"),
        new Date("2026-10-07T04:32:50Z"),
      ),
    ).toEqual({ date: "2026-10-07", tz: "UTC" });
  });
});

function memoryStorage() {
  const files = new Map<string, string>();
  const storage = {
    async getInfoAsync(path: string) {
      return { exists: files.has(path) };
    },
    async makeDirectoryAsync() {},
    async writeAsStringAsync(path: string, content: string) {
      files.set(path, content);
    },
    async readAsStringAsync(path: string) {
      const raw = files.get(path);
      if (raw === undefined) throw new Error("missing cache");
      return raw;
    },
  } satisfies TodayCacheStorage;
  return { files, storage };
}

describe("Today snapshot storage contract", () => {
  const now = new Date("2026-10-07T04:32:50Z");
  const raw = JSON.stringify({
    savedAt: now.toISOString(),
    payload: {
      date: "2026-10-06",
      tz: "America/Los_Angeles",
      day: { title: "Review day: prepare and explore" },
    },
  });
  it("round-trips captured local day through actual write/read paths", async () => {
    const { files, storage } = memoryStorage();
    await writeTodayCache(
      storage,
      "cache/",
      "trip",
      "2026-10-06",
      "America/Los_Angeles",
      raw,
    );
    expect(files.has("cache/today_trip_2026-10-06.json")).toBe(true);
    expect(await readTodayCache(storage, "cache/", "trip", now)).toBe(raw);
    expect(
      await readTodayCache(
        storage,
        "cache/",
        "trip",
        new Date("2026-10-07T07:00:00Z"),
      ),
    ).toBeNull();
  });
  it("withholds a legacy UTC-keyed cache without timezone index", async () => {
    const { files, storage } = memoryStorage();
    files.set("cache/today_trip_2026-10-07.json", raw);
    expect(await readTodayCache(storage, "cache/", "trip", now)).toBeNull();
  });
  it("rejects wrong-day data even if placed under the expected filename", async () => {
    const { files, storage } = memoryStorage();
    await writeTodayCache(
      storage,
      "cache/",
      "trip",
      "2026-10-06",
      "America/Los_Angeles",
      raw,
    );
    files.set(
      "cache/today_trip_2026-10-06.json",
      raw.replaceAll("2026-10-06", "2026-10-07"),
    );
    expect(await readTodayCache(storage, "cache/", "trip", now)).toBeNull();
  });
  it("does not write a payload whose identity differs from the key", async () => {
    const { files, storage } = memoryStorage();
    await expect(
      writeTodayCache(
        storage,
        "cache/",
        "trip",
        "2026-10-07",
        "America/Los_Angeles",
        raw,
      ),
    ).rejects.toThrow();
    expect(files.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import { parseIoverlanderCsv } from "../ioverlander";

const HEADER = "ID,Name,Category,Latitude,Longitude";

describe("parseIoverlanderCsv", () => {
  it("maps categories and stamps the workspace + prefixed externalId", () => {
    const csv = [
      HEADER,
      "42,Nice Pullout,Wild Camping,45.5,-121.5",
      "43,City Dump,Sanitation Dump Station,45.6,-121.6",
    ].join("\n");

    const { rows, catCounts, total, skipped } = parseIoverlanderCsv(
      csv,
      "ws-1",
    );

    expect(total).toBe(2);
    expect(skipped).toBe(0);
    expect(catCounts).toEqual({ wild_camping: 1, dump_station: 1 });

    const wild = rows[0]!;
    expect(wild.category).toBe("wild_camping");
    expect(wild.workspaceId).toBe("ws-1");
    expect(wild.externalId).toBe("iov/ws-1/42"); // scoped prefix, licensing-safe
    expect(wild.source).toBe("ioverlander");
    expect(wild.lat).toBe("45.5");
  });

  it("keeps rows shared (no prefix) when no workspace is given", () => {
    const csv = [HEADER, "7,Shared Spot,Water,40,-100"].join("\n");
    const { rows } = parseIoverlanderCsv(csv, null);
    expect(rows[0]!.workspaceId).toBeNull();
    expect(rows[0]!.externalId).toBe("iov/7");
  });

  it("skips rows with invalid coordinates", () => {
    const csv = [
      HEADER,
      "1,Good,Water,10,20",
      "2,NoCoords,Water,,",
      "3,BadLat,Water,notanumber,20",
    ].join("\n");
    const { total, skipped } = parseIoverlanderCsv(csv, "ws-1");
    expect(total).toBe(1);
    expect(skipped).toBe(2);
  });

  it("falls back to a coord-based externalId when the CSV has no id column", () => {
    const csv = [
      "Name,Category,Latitude,Longitude",
      "Camp,Wild Camping,1.25,2.5",
    ].join("\n");
    const { rows } = parseIoverlanderCsv(csv, "ws-9");
    expect(rows[0]!.externalId).toBe("iov/ws-9/1.25,2.5/camp");
  });

  it("throws on a file missing required columns", () => {
    expect(() => parseIoverlanderCsv("Foo,Bar\n1,2", null)).toThrow(
      /missing required columns/i,
    );
  });

  it("handles quoted fields with embedded commas", () => {
    const csv = [HEADER, '99,"Smith, John Pullout",Wild Camping,3,4'].join(
      "\n",
    );
    const { rows } = parseIoverlanderCsv(csv, "ws-1");
    expect(rows[0]!.name).toBe("Smith, John Pullout");
  });
});

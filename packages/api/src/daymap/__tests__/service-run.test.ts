import { describe, expect, it } from "vitest";

import type { ServiceNeed, ServicePoi } from "../service";
import {
  DEFAULT_MAX_OFF_ROUTE_MILES,
  placePoisOnRoute,
  planServiceRun,
  type RouteMatchedPoi,
} from "../service-run";

/** A due-north route from (39,-105); ~69 miles per degree of latitude. */
const ROUTE = Array.from({ length: 11 }, (_, i) => ({
  lat: 39 + i * 0.1,
  lng: -105,
}));

function poi(
  id: string,
  lat: number,
  lng: number,
  category: string,
): ServicePoi {
  return { id, name: `${category} ${id}`, category, lat, lng };
}

function need(
  resource: string,
  serviceCategory: string,
  daysUntil: number,
): ServiceNeed {
  return {
    resource,
    label: resource,
    levelPct: 50,
    daysUntil,
    serviceCategory,
    urgency: daysUntil <= 0.5 ? "now" : daysUntil <= 2 ? "soon" : "ok",
  };
}

function matched(
  id: string,
  category: string,
  routeMile: number,
): RouteMatchedPoi {
  return {
    id,
    name: `${category} ${id}`,
    category,
    lat: 0,
    lng: 0,
    routeMile,
    milesOffRoute: 1,
  };
}

describe("placePoisOnRoute", () => {
  it("places a POI at its nearest route mile with the detour distance", () => {
    const placed = placePoisOnRoute({
      pois: [poi("p1", 39.5, -105.02, "dump")],
      route: ROUTE,
    });
    expect(placed).toHaveLength(1);
    // Halfway up a ~69-mile route.
    expect(placed[0]!.routeMile).toBeCloseTo(34.5, 0);
    expect(placed[0]!.milesOffRoute).toBeLessThan(2);
  });

  it("drops POIs already behind the traveller", () => {
    // The failure mode of nearest-by-straight-line: recommending a stop you
    // drove past twenty miles ago.
    const placed = placePoisOnRoute({
      pois: [
        poi("behind", 39.1, -105, "dump"),
        poi("ahead", 39.8, -105, "dump"),
      ],
      route: ROUTE,
      fromRouteMile: 40,
    });
    expect(placed.map((p) => p.id)).toEqual(["ahead"]);
  });

  it("drops POIs that are really a side trip", () => {
    const placed = placePoisOnRoute({
      pois: [poi("far", 39.5, -100, "dump")], // hundreds of miles east
      route: ROUTE,
    });
    expect(placed).toEqual([]);
    expect(DEFAULT_MAX_OFF_ROUTE_MILES).toBe(15);
  });

  it("returns nothing without a usable route", () => {
    expect(
      placePoisOnRoute({ pois: [poi("p", 39, -105, "dump")], route: [] }),
    ).toEqual([]);
  });

  it("orders by route position, not by proximity", () => {
    const placed = placePoisOnRoute({
      pois: [
        poi("late", 39.9, -105, "water"),
        poi("early", 39.1, -105, "dump"),
      ],
      route: ROUTE,
    });
    expect(placed.map((p) => p.id)).toEqual(["early", "late"]);
  });
});

describe("planServiceRun", () => {
  it("bundles converging needs into one pull-off", () => {
    // Dump, water, and propane all within a couple of miles: one stop, not
    // three — the detour cost is per stop, not per need.
    const { stops, unserved } = planServiceRun({
      needs: [
        need("grey", "dump", 1.5),
        need("fresh", "water", 2),
        need("propane", "propane", 3),
      ],
      pois: [
        matched("dump1", "dump", 100),
        matched("water1", "water", 101),
        matched("lpg1", "propane", 103),
      ],
    });

    expect(stops).toHaveLength(1);
    expect(stops[0]!.poi.id).toBe("dump1");
    expect(stops[0]!.needs.map((n) => n.resource)).toEqual([
      "grey",
      "fresh",
      "propane",
    ]);
    expect(stops[0]!.alsoAt.map((p) => p.id)).toEqual(["water1", "lpg1"]);
    expect(stops[0]!.daysUntilFirstNeed).toBe(1.5);
    expect(unserved).toEqual([]);
  });

  it("splits into separate stops when needs do not converge", () => {
    const { stops } = planServiceRun({
      needs: [need("grey", "dump", 1), need("fresh", "water", 2)],
      pois: [matched("dump1", "dump", 20), matched("water1", "water", 200)],
    });
    expect(stops.map((s) => s.poi.id)).toEqual(["dump1", "water1"]);
  });

  it("takes the earliest servable cluster, not the most urgent need", () => {
    // Water is less urgent but comes first on the road; you pass it either way.
    const { stops } = planServiceRun({
      needs: [need("grey", "dump", 0.5), need("fresh", "water", 4)],
      pois: [matched("water1", "water", 10), matched("dump1", "dump", 300)],
    });
    expect(stops.map((s) => s.poi.id)).toEqual(["water1", "dump1"]);
  });

  it("reports needs with nowhere to service them", () => {
    // "There is nowhere to dump on this leg" is information. Hiding it is how
    // someone ends up with a full tank and no options.
    const { stops, unserved } = planServiceRun({
      needs: [need("grey", "dump", 1), need("trash", "waste", 1)],
      pois: [matched("dump1", "dump", 50)],
    });
    expect(stops).toHaveLength(1);
    expect(unserved.map((n) => n.resource)).toEqual(["trash"]);
  });

  it("never anchors a stop on a POI that services nothing", () => {
    const { stops } = planServiceRun({
      needs: [need("fresh", "water", 2)],
      pois: [
        matched("grocery1", "grocery", 10),
        matched("water1", "water", 11),
      ],
    });
    // The grocery is within the radius, but stopping is justified by the water.
    expect(stops).toHaveLength(1);
    expect(stops[0]!.poi.id).toBe("water1");
    expect(stops[0]!.alsoAt.map((p) => p.id)).toEqual(["grocery1"]);
  });

  it("serves each need once", () => {
    const { stops } = planServiceRun({
      needs: [need("grey", "dump", 1)],
      pois: [matched("dump1", "dump", 10), matched("dump2", "dump", 200)],
    });
    expect(stops).toHaveLength(1);
    expect(stops[0]!.poi.id).toBe("dump1");
  });
});

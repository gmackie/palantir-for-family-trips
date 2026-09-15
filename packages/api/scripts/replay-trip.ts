/**
 * Replay a real trip through the day-map logic.
 *
 * Everything built for the travel day — fuel bands, service runs, cut-if-behind
 * — is verified by unit tests and by nothing else. Tests prove the code does
 * what I said; they cannot tell me whether what I said is sane on a real
 * 5,000-mile journey with 19 segments and somebody's actual "skip the
 * viewpoint" notes.
 *
 * This replays a completed trip through those pure functions and prints what
 * the app would have told the traveller. It is not a substitute for driving.
 * It is the strongest check available without a van, and it reads real rows —
 * no fixtures, no synthetic routes.
 *
 *   DATABASE_URL=… pnpm -F @sortey/api exec tsx scripts/replay-trip.ts --trip <id>
 */

import { asc, eq, inArray } from "@sortey/db";
import { db } from "@sortey/db/client";
import {
  importedPois,
  tripAnchors,
  tripDays,
  tripSegments,
  trips,
  vanProfiles,
} from "@sortey/db/schema";
import {
  DEFAULT_RESOURCE_MODELS,
  matchServiceStops,
  predictServiceNeeds,
  type ServicePoi,
} from "../src/daymap/service";
import { placePoisOnRoute, planServiceRun } from "../src/daymap/service-run";
import {
  applyCutIfBehind,
  describeCuts,
} from "../src/route-planner/cut-if-behind";
import {
  colorPolylineByFuelRange,
  fuelRangeMiles,
} from "../src/route-planner/zones";

type RouteRun = {
  points: Array<{ lat: number; lng: number }>;
  gapMilesBefore: number;
};

/** The categories the resource models actually service. */
const SERVICE_CATEGORIES = ["dump_station", "water", "propane"];

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function heading(text: string) {
  console.log(`\n${"─".repeat(72)}\n${text}\n${"─".repeat(72)}`);
}

// The codec ships CJS; under tsx a named ESM import does not resolve, so
// interop by hand rather than fighting the loader.
const polylineModule = (await import(
  "@googlemaps/polyline-codec"
)) as unknown as {
  decode?: (v: string, p: number) => Array<[number, number]>;
  default?: { decode: (v: string, p: number) => Array<[number, number]> };
};
const decode = polylineModule.decode ?? polylineModule.default?.decode;
if (!decode) throw new Error("polyline decode unavailable");

async function main() {
  const tripId = flag("trip");
  if (!tripId) {
    console.error("Usage: replay-trip.ts --trip <tripId> [--behind <days>]");
    process.exit(1);
  }
  const daysBehind = Number(flag("behind") ?? 2);

  const [trip] = (await db
    .select({ name: trips.name, tz: trips.tz, workspaceId: trips.workspaceId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1)) as Array<{ name: string; tz: string; workspaceId: string }>;
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const segments = (await db
    .select({
      name: tripSegments.name,
      routePolyline: tripSegments.routePolyline,
      distanceMiles: tripSegments.distanceMiles,
      sortOrder: tripSegments.sortOrder,
    })
    .from(tripSegments)
    .where(eq(tripSegments.tripId, tripId))
    .orderBy(asc(tripSegments.sortOrder))) as Array<{
    name: string;
    routePolyline: string | null;
    distanceMiles: string | null;
    sortOrder: number;
  }>;

  const days = (await db
    .select({
      date: tripDays.date,
      intent: tripDays.intent,
      title: tripDays.title,
      cutIfBehind: tripDays.cutIfBehind,
    })
    .from(tripDays)
    .where(eq(tripDays.tripId, tripId))
    .orderBy(asc(tripDays.date))) as Array<{
    date: string;
    intent: string;
    title: string | null;
    cutIfBehind: string | null;
  }>;

  const anchors = (await db
    .select({ startDate: tripAnchors.startDate, title: tripAnchors.title })
    .from(tripAnchors)
    .where(eq(tripAnchors.tripId, tripId))) as Array<{
    startDate: string;
    title: string;
  }>;

  const [van] = (await db
    .select({
      name: vanProfiles.name,
      mpgEstimate: vanProfiles.mpgEstimate,
      tankGallons: vanProfiles.tankGallons,
    })
    .from(vanProfiles)
    .where(eq(vanProfiles.workspaceId, trip.workspaceId))
    .limit(1)) as Array<{
    name: string;
    mpgEstimate: string | null;
    tankGallons: string | null;
  }>;

  console.log(`\nReplaying "${trip.name}" (${trip.tz})`);
  console.log(
    `${segments.length} segments · ${days.length} days · ${anchors.length} anchors · van: ${van?.name ?? "none"}`,
  );

  // ── Route ────────────────────────────────────────────────────────────────
  const runs: RouteRun[] = [];
  let current: Array<{ lat: number; lng: number }> = [];
  let gapMiles = 0;
  for (const segment of segments) {
    if (!segment.routePolyline) {
      if (current.length >= 2) {
        runs.push({ points: current, gapMilesBefore: gapMiles });
        gapMiles = 0;
      }
      current = [];
      gapMiles += Number(segment.distanceMiles ?? 0) || 0;
      continue;
    }
    for (const [lat, lng] of decode(segment.routePolyline, 5)) {
      const last = current.at(-1);
      if (last && last.lat === lat && last.lng === lng) continue;
      current.push({ lat, lng });
    }
  }
  if (current.length >= 2)
    runs.push({ points: current, gapMilesBefore: gapMiles });

  const route = runs.flatMap((run) => run.points);
  console.log(
    `route: ${route.length} points across ${runs.length} continuous run(s)`,
  );

  // ── Fuel bands ───────────────────────────────────────────────────────────
  heading("FUEL BANDS (no refuelling assumed — where does the tank run dry?)");
  const rangeMiles = fuelRangeMiles(
    van?.mpgEstimate != null ? Number(van.mpgEstimate) : null,
    van?.tankGallons != null ? Number(van.tankGallons) : null,
  );
  if (rangeMiles > 0) {
    console.log(`usable range: ${Math.round(rangeMiles)} mi per tank`);
    // The server twin colours one polyline; replay each run separately, which
    // is what the client's colorRouteRunsByFuelRange does.
    const bands = runs.flatMap((run) =>
      colorPolylineByFuelRange(run.points, rangeMiles),
    );
    const counts = bands.reduce<Record<string, number>>((acc, band) => {
      acc[band.band] = (acc[band.band] ?? 0) + 1;
      return acc;
    }, {});
    console.log("band segments:", counts);
    console.log(
      bands.at(-1)?.band === "empty"
        ? "✓ route ends RED — the tank runs dry with no fuel stops, as it must"
        : `✗ route ends ${bands.at(-1)?.band} — suspicious for a multi-tank trip`,
    );
  } else {
    console.log("no usable van model — skipping");
  }

  // ── Service run ──────────────────────────────────────────────────────────
  heading("SERVICE RUN (grey 80%, fresh 25% — where would it send you?)");
  const needs = predictServiceNeeds(
    [
      { resource: "grey", levelPct: 80 },
      { resource: "fresh", levelPct: 25 },
    ],
    DEFAULT_RESOURCE_MODELS,
  );
  console.log(
    "needs:",
    needs.map((n) => `${n.resource} in ${n.daysUntil}d (${n.urgency})`),
  );

  const start = route[0];
  if (start && needs.length > 0) {
    const poiRows = (await db
      .select({
        id: importedPois.id,
        name: importedPois.name,
        category: importedPois.category,
        lat: importedPois.lat,
        lng: importedPois.lng,
      })
      .from(importedPois)
      .where(inArray(importedPois.category, SERVICE_CATEGORIES))
      .limit(4000)) as Array<{
      id: string;
      name: string;
      category: string;
      lat: string;
      lng: string;
    }>;
    const pois: ServicePoi[] = poiRows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      lat: Number(row.lat),
      lng: Number(row.lng),
    }));
    const byCategory = pois.reduce<Record<string, number>>((acc, poi) => {
      acc[poi.category] = (acc[poi.category] ?? 0) + 1;
      return acc;
    }, {});
    console.log("service POIs in the corpus:", byCategory);

    const onRoute = placePoisOnRoute({ pois, route });
    console.log(`${onRoute.length} of them within 15 mi of this route`);

    const nearest = matchServiceStops(needs, pois, start);
    for (const alert of nearest) {
      console.log(
        `  nearest-${alert.resource}: ${alert.stop ? `${alert.stop.name} (${alert.stop.milesAway} mi)` : "none"}`,
      );
    }

    const run = planServiceRun({ needs, pois: onRoute });
    for (const stop of run.stops.slice(0, 3)) {
      console.log(
        `  run: ${stop.poi.name} at mile ${Math.round(stop.poi.routeMile)} (${stop.poi.milesOffRoute} mi off) → ${stop.needs.map((n) => n.resource).join(", ")}`,
      );
    }
    if (run.unserved.length > 0) {
      console.log(
        `  unserved: ${run.unserved.map((n) => n.resource).join(", ")}`,
      );
    }
  }

  // ── Cut if behind ────────────────────────────────────────────────────────
  heading(`CUT IF BEHIND (${daysBehind} days behind — what gets dropped?)`);
  const anchorDates = new Set(anchors.map((a) => String(a.startDate)));
  const decision = applyCutIfBehind(
    days.map((day) => ({
      date: day.date,
      intent: day.intent,
      cutIfBehind: day.cutIfBehind,
      hasAnchor: anchorDates.has(day.date),
    })),
    daysBehind,
  );
  console.log(
    `${days.filter((d) => d.cutIfBehind).length} days carry a cut line; ${decision.recoveredDays} recovered, ${decision.shortfallDays} short`,
  );
  for (const line of describeCuts(decision)) console.log(`  ${line}`);

  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

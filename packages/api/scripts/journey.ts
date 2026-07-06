/**
 * Journey CLI — log and edit a trip's journey from the command line, using the
 * exact same operations as the `journey` tRPC router (so an agent's edits match
 * what the app would do). Connects directly to the DB; assumes you're allowed
 * to touch the trip (no auth check — operator tool).
 *
 * Requires: DATABASE_URL, GOOGLE_ROUTES_API_KEY (for routing + geocoding).
 *
 *   pnpm -F @sortey/api exec tsx scripts/journey.ts <command> [flags]
 *
 * Commands:
 *   list    --trip <id>
 *   log     --trip <id> (--place "Name" | --lat <n> --lng <n>) [--name "X"]
 *                       [--kind camp|overnight|rest|scenic|fuel|water|dump|town|custom]
 *                       [--date YYYY-MM-DD] [--note "..."] [--tz <zone>]
 *   update  --trip <id> --segment <segId> [--name] [--date] [--place|--lat/--lng]
 *                       [--kind] [--note]
 *   delete  --trip <id> --segment <segId>
 *   geocode "<query>"
 *   reverse --lat <n> --lng <n>
 */

import { writeFileSync } from "node:fs";
import { asc, eq } from "@sortey/db";
import { db } from "@sortey/db/client";
import { pins, tripSegments, trips } from "@sortey/db/schema";

import type { DayBriefing } from "../src/daymap/briefing";
import { computeBriefing } from "../src/daymap/briefing-ops";
import { computeServiceAlerts } from "../src/daymap/service-ops";
import type { StopKind } from "../src/route-planner/journey-logic";
import {
  deleteStopOp,
  logStopOp,
  updateStopOp,
} from "../src/route-planner/journey-ops";
import { buildRecap, type TripRecap } from "../src/route-planner/recap";
import { geocode, reverseGeocode } from "../src/route-planner/routing";

function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string>;
} {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (!v) throw new Error(`--${name} is required`);
  return v;
}

async function tripOwner(tripId: string): Promise<string> {
  const [t] = await db
    .select({ u: trips.createdByUserId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  if (!t) throw new Error(`Trip ${tripId} not found`);
  return t.u;
}

async function tripWorkspace(tripId: string): Promise<string> {
  const [t] = await db
    .select({ w: trips.workspaceId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  if (!t) throw new Error(`Trip ${tripId} not found`);
  return t.w;
}

/** Resolve a --place (geocode) or --lat/--lng into coords + a name. */
async function resolvePoint(flags: Record<string, string>): Promise<{
  lat: number;
  lng: number;
  name?: string;
} | null> {
  if (flags.lat && flags.lng) {
    return { lat: Number(flags.lat), lng: Number(flags.lng), name: flags.name };
  }
  if (flags.place) {
    const g = await geocode(flags.place);
    if (!g) throw new Error(`Could not geocode "${flags.place}"`);
    return { lat: g.lat, lng: g.lng, name: flags.name ?? flags.place };
  }
  return null;
}

function renderBriefing(b: DayBriefing): string {
  const L: string[] = [];
  L.push(`# Sortey Day-Map — ${b.date}`, "");
  L.push(`**Position:** ${b.positionName}`);
  if (b.drive)
    L.push(
      `**Drive:** ${b.drive.fromName} → ${b.drive.toName} · ${b.drive.miles}mi ~${b.drive.hours}h`,
    );
  else L.push("**Drive:** parked day");
  if (b.weather)
    L.push(
      `**Weather:** ${b.weather.label}, ${b.weather.highF}°/${b.weather.lowF}° · ${b.weather.precipProbability}% rain`,
    );
  if (b.airQuality)
    L.push(
      `**Air:** ${b.airQuality.category} (AQI ${b.airQuality.usAqi}, PM2.5 ${b.airQuality.pm25})`,
    );
  L.push("", "## Schedule");
  for (const s of b.schedule)
    L.push(
      `- **${s.part[0]!.toUpperCase()}${s.part.slice(1)}** — ${s.title}: ${s.detail}`,
    );
  L.push("", "## Pulled for today");
  const p = b.pois;
  if (p.work)
    L.push(
      `- 💼 Work: ${p.work.name} (${p.work.category}, ${p.work.milesAway}mi)`,
    );
  if (p.food) L.push(`- 🍽 Food: ${p.food.name} (${p.food.milesAway}mi)`);
  if (p.experience)
    L.push(
      `- 🥾 Experience: ${p.experience.name} (${p.experience.milesAway}mi)`,
    );
  if (p.camp) L.push(`- 🏕 Camp: ${p.camp.name} (${p.camp.milesAway}mi)`);
  if (p.fuel) L.push(`- ⛽ Fuel: ${p.fuel.name} (${p.fuel.milesAway}mi)`);
  if (b.serviceAlerts.length > 0) {
    L.push("", "## Service");
    for (const a of b.serviceAlerts) {
      const when = a.daysUntil <= 0 ? "DUE NOW" : `~${a.daysUntil}d`;
      const where = a.stop
        ? `→ ${a.stop.name} (${a.stop.milesAway}mi)`
        : "→ no POI nearby";
      L.push(
        `- [${a.urgency.toUpperCase()}] ${a.label} ${a.levelPct}% · ${when} ${where}`,
      );
    }
  }
  if (b.notes.length > 0) {
    L.push("", "## Notes");
    for (const n of b.notes) L.push(`- ${n}`);
  }
  return L.join("\n");
}

function renderRecap(r: TripRecap): string {
  const L: string[] = [];
  L.push(`# Trip Recap — ${r.from ?? "?"} → ${r.to ?? "?"}`, "");
  L.push(
    `**${r.dateStart} → ${r.dateEnd}** · ${r.days} days · ${r.totalMiles} mi · ${r.stopCount} stops`,
  );
  if (r.states.length > 0) L.push(`**States:** ${r.states.join(" → ")}`);
  if (r.longestLeg)
    L.push(`**Longest leg:** ${r.longestLeg.miles} mi → ${r.longestLeg.name}`);
  if (r.camps.length > 0) {
    L.push("", `## Camps (${r.campCount})`);
    for (const c of r.camps) L.push(`- 🏕 ${c}`);
  }
  return L.join("\n");
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "list": {
      const tripId = requireFlag(flags, "trip");
      const rows = await db
        .select({
          id: tripSegments.id,
          sort: tripSegments.sortOrder,
          date: tripSegments.startDate,
          mi: tripSegments.distanceMiles,
          name: tripSegments.name,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, tripId))
        .orderBy(asc(tripSegments.sortOrder));
      for (const r of rows) {
        console.log(
          `[${r.sort}] ${r.date ?? "----------"} · ${String(r.mi ?? "0").padStart(6)}mi · ${r.name}  (${r.id})`,
        );
      }
      console.log(`\n${rows.length} stops.`);
      break;
    }

    case "log": {
      const tripId = requireFlag(flags, "trip");
      const point = await resolvePoint(flags);
      if (!point) throw new Error("Provide --place or --lat/--lng");
      const userId = await tripOwner(tripId);
      const res = await logStopOp(db, {
        tripId,
        userId,
        name: point.name ?? "Stop",
        lat: point.lat,
        lng: point.lng,
        date: flags.date,
        kind: (flags.kind as StopKind) ?? "custom",
        note: flags.note,
        tz: flags.tz,
      });
      console.log(
        `Logged ${point.name} (${res.miles}mi${res.routed ? "" : ", straight-line"}) → segment ${res.segmentId}`,
      );
      break;
    }

    case "update": {
      const tripId = requireFlag(flags, "trip");
      const segmentId = requireFlag(flags, "segment");
      const point = await resolvePoint(flags);
      const res = await updateStopOp(db, {
        tripId,
        segmentId,
        name: flags.name,
        date: flags.date,
        lat: point?.lat,
        lng: point?.lng,
        kind: flags.kind as StopKind | undefined,
        note: flags.note,
      });
      if (!res) throw new Error("Stop not found");
      console.log(`Updated segment ${segmentId}`);
      break;
    }

    case "delete": {
      const tripId = requireFlag(flags, "trip");
      const segmentId = requireFlag(flags, "segment");
      const res = await deleteStopOp(db, { tripId, segmentId });
      if (!res) throw new Error("Stop not found");
      console.log(
        `Deleted segment ${segmentId}; ${res.remaining} stops remain`,
      );
      break;
    }

    case "geocode": {
      const q = positional.join(" ") || flags.place;
      if (!q) throw new Error('Usage: geocode "<query>"');
      const g = await geocode(q);
      console.log(g ? JSON.stringify(g) : "No result");
      break;
    }

    case "reverse": {
      const g = await reverseGeocode({
        lat: Number(requireFlag(flags, "lat")),
        lng: Number(requireFlag(flags, "lng")),
      });
      console.log(g ? JSON.stringify(g) : "No result");
      break;
    }

    case "service-alerts": {
      const tripId = requireFlag(flags, "trip");
      const num = (k: string) =>
        typeof flags[k] === "string" ? Number(flags[k]) : undefined;
      const { position, alerts } = await computeServiceAlerts(db, {
        tripId,
        workspaceId: await tripWorkspace(tripId),
        levels: {
          grey: num("grey"),
          black: num("black"),
          fresh: num("fresh"),
          propane: num("propane"),
        },
      });
      console.log(
        `Position: ${position?.name ?? "unknown"}${position ? ` (${position.lat.toFixed(3)}, ${position.lng.toFixed(3)})` : ""}`,
      );
      if (alerts.length === 0) {
        console.log("No alerts (provide --grey/--black/--fresh/--propane %).");
      }
      for (const a of alerts) {
        const when = a.daysUntil <= 0 ? "DUE NOW" : `in ~${a.daysUntil}d`;
        const where = a.stop
          ? `→ ${a.stop.name} (${a.stop.milesAway}mi)`
          : "→ no service POI nearby";
        console.log(
          `  [${a.urgency.toUpperCase()}] ${a.label} ${a.levelPct}% · ${when}  ${where}`,
        );
      }
      break;
    }

    case "briefing": {
      const tripId = requireFlag(flags, "trip");
      const num = (k: string) =>
        typeof flags[k] === "string" ? Number(flags[k]) : undefined;
      const b = await computeBriefing(db, {
        tripId,
        workspaceId: await tripWorkspace(tripId),
        date: flags.date,
        levels: {
          grey: num("grey"),
          black: num("black"),
          fresh: num("fresh"),
          propane: num("propane"),
        },
      });
      if (!b) {
        console.log("No briefing (no current position).");
        break;
      }
      const md = renderBriefing(b);
      console.log(md);
      if (flags.obsidian) {
        const path = `${process.env.HOME}/obsidian/Captures/${b.date} - Sortey Day-Map.md`;
        writeFileSync(path, md);
        console.log(`\n(written to ${path})`);
      }
      break;
    }

    case "recap": {
      const tripId = requireFlag(flags, "trip");
      const segRows = await db
        .select({
          name: tripSegments.name,
          destinationName: tripSegments.destinationName,
          distanceMiles: tripSegments.distanceMiles,
          startDate: tripSegments.startDate,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, tripId));
      const pinRows = await db
        .select({
          title: pins.title,
          type: pins.type,
          segmentDate: tripSegments.startDate,
        })
        .from(pins)
        .innerJoin(tripSegments, eq(pins.segmentId, tripSegments.id))
        .where(eq(pins.tripId, tripId));
      const today = flags.date ?? new Date().toISOString().slice(0, 10);
      const md = renderRecap(buildRecap(segRows, pinRows, today));
      console.log(md);
      if (flags.obsidian) {
        const path = `${process.env.HOME}/obsidian/Captures/${today} - Trip Recap.md`;
        writeFileSync(path, md);
        console.log(`\n(written to ${path})`);
      }
      break;
    }

    default:
      console.log(
        "Commands: list | log | update | delete | geocode | reverse | service-alerts | briefing | recap\n" +
          "See the header of scripts/journey.ts for flags.",
      );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("journey:", err instanceof Error ? err.message : err);
  process.exit(1);
});

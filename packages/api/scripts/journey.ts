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
import { computeServiceAlerts, type ServiceLevels } from "../src/daymap/service-ops";
import {
  recordReading,
  resolveVanState,
  TRACKED_RESOURCES,
} from "../src/daymap/vanstate-ops";
import type { StopKind } from "../src/route-planner/journey-logic";
import {
  deleteStopOp,
  logStopOp,
  updateStopOp,
} from "../src/route-planner/journey-ops";
import { buildRecap, type TripRecap } from "../src/route-planner/recap";
import { geocode, reverseGeocode } from "../src/route-planner/routing";
import { getTrackStats } from "../src/route-planner/track-ops";
import {
  createAnchor,
  deleteAnchor,
  listAnchors,
} from "../src/route-planner/anchor-ops";

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

/**
 * Build a levels object from --grey/--black/--fresh/--propane flags, or
 * `undefined` when none are set — so service-alerts/briefing fall back to the
 * trip's persisted VanState instead of an all-undefined override.
 */
function levelsFromFlags(
  flags: Record<string, string>,
): ServiceLevels | undefined {
  const num = (k: string) =>
    typeof flags[k] === "string" ? Number(flags[k]) : undefined;
  const levels: ServiceLevels = {
    grey: num("grey"),
    black: num("black"),
    fresh: num("fresh"),
    propane: num("propane"),
  };
  return Object.values(levels).some((v) => v != null) ? levels : undefined;
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
  if (b.anchor) {
    const a = b.anchor;
    const when = a.daysUntil <= 0 ? "today" : `in ${a.daysUntil}d`;
    const dist = a.milesAway != null ? ` · ${a.milesAway}mi` : "";
    const pace = a.behind ? ` ⚠️ need ~${a.milesPerDay}mi/day` : "";
    L.push(`**Next anchor:** ${a.anchor.title} ${when}${dist}${pace}`);
  }
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
  if (r.actualMiles != null)
    L.push(`**Driven (GPS):** ${r.actualMiles} mi`);
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
      const { position, alerts } = await computeServiceAlerts(db, {
        tripId,
        workspaceId: await tripWorkspace(tripId),
        levels: levelsFromFlags(flags),
      });
      console.log(
        `Position: ${position?.name ?? "unknown"}${position ? ` (${position.lat.toFixed(3)}, ${position.lng.toFixed(3)})` : ""}`,
      );
      if (alerts.length === 0) {
        console.log(
          "No alerts (log readings with `reading`, or pass --grey/--black/--fresh/--propane %).",
        );
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
      const b = await computeBriefing(db, {
        tripId,
        workspaceId: await tripWorkspace(tripId),
        date: flags.date,
        levels: levelsFromFlags(flags),
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
      const track = await getTrackStats(db, tripId);
      const md = renderRecap(buildRecap(segRows, pinRows, today, track));
      console.log(md);
      if (flags.obsidian) {
        const path = `${process.env.HOME}/obsidian/Captures/${today} - Trip Recap.md`;
        writeFileSync(path, md);
        console.log(`\n(written to ${path})`);
      }
      break;
    }

    case "track": {
      const tripId = requireFlag(flags, "trip");
      const stats = await getTrackStats(db, tripId, { since: flags.since });
      if (stats.points === 0) {
        console.log("No breadcrumbs logged yet.");
        break;
      }
      console.log(
        `Track: ${stats.points} points · ${stats.actualMiles} mi driven\n` +
          `  ${stats.firstAt?.slice(0, 16)} → ${stats.lastAt?.slice(0, 16)}`,
      );
      break;
    }

    case "anchor": {
      const tripId = requireFlag(flags, "trip");
      const sub = positional[0] ?? "list";
      if (sub === "add") {
        const point = await resolvePoint(flags); // optional --place / --lat/--lng
        const { id } = await createAnchor(db, {
          tripId,
          title: requireFlag(flags, "title"),
          kind: flags.kind,
          placeName: point?.name ?? flags.place ?? null,
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          startDate: requireFlag(flags, "date"),
          endDate: flags.end ?? null,
          confirmationCode: flags.code ?? null,
          url: flags.url ?? null,
          note: flags.note ?? null,
        });
        console.log(`Added anchor ${id}: ${flags.title} on ${flags.date}.`);
      } else if (sub === "delete") {
        await deleteAnchor(db, requireFlag(flags, "anchor"));
        console.log("Deleted anchor.");
      } else {
        const rows = await listAnchors(db, tripId);
        if (rows.length === 0) {
          console.log("No anchors (use `anchor add --title ... --date ...`).");
          break;
        }
        for (const a of rows) {
          const range = a.endDate ? `${a.startDate}–${a.endDate}` : a.startDate;
          const where = a.placeName ? ` @ ${a.placeName}` : "";
          console.log(`  ${range}  ${a.title}${where}  [${a.kind}]  ${a.id}`);
        }
      }
      break;
    }

    case "reading": {
      const tripId = requireFlag(flags, "trip");
      const resource = requireFlag(flags, "resource");
      if (!TRACKED_RESOURCES.includes(resource)) {
        throw new Error(
          `--resource must be one of: ${TRACKED_RESOURCES.join(", ")}`,
        );
      }
      const level = Number(requireFlag(flags, "level"));
      if (!Number.isFinite(level) || level < 0 || level > 100) {
        throw new Error("--level must be 0–100");
      }
      await recordReading(db, {
        tripId,
        resource,
        levelPct: level,
        note: flags.note,
      });
      console.log(`Logged ${resource} at ${level}%.`);
      const state = await resolveVanState(db, tripId);
      if (state) {
        console.log(
          `Learned rate ${resource}: ~${state.rates[resource]}%/day.`,
        );
      }
      break;
    }

    case "vanstate": {
      const tripId = requireFlag(flags, "trip");
      const state = await resolveVanState(db, tripId);
      if (!state) {
        console.log("No readings logged yet (use `reading`).");
        break;
      }
      console.log("VanState (latest level · learned rate):");
      for (const [resource, level] of Object.entries(state.levels)) {
        const updated = state.updatedAt[resource]?.slice(0, 10) ?? "";
        console.log(
          `  ${resource}: ${level}% · ~${state.rates[resource]}%/day  (as of ${updated})`,
        );
      }
      break;
    }

    default:
      console.log(
        "Commands: list | log | update | delete | geocode | reverse | " +
          "service-alerts | briefing | recap | reading | vanstate | track | anchor\n" +
          "  anchor add --trip <id> --title \"Open Sauce\" --date YYYY-MM-DD [--place \"...\"] [--end YYYY-MM-DD] [--kind event]\n" +
          "  anchor list --trip <id>\n" +
          "  reading  --trip <id> --resource grey|black|fresh|propane|fuel --level <0-100> [--note ...]\n" +
          "  vanstate --trip <id>\n" +
          "See the header of scripts/journey.ts for other flags.",
      );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("journey:", err instanceof Error ? err.message : err);
  process.exit(1);
});

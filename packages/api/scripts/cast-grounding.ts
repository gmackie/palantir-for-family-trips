/**
 * Cast-grounding bridge — push an OODA research-brief export into a trip's
 * Corridor Cast grounding table, using the same shape as the
 * `cast.uploadGroundingBrief` tRPC procedure (so an operator push matches what
 * the app would do). Connects directly to the DB; assumes you're allowed to
 * touch the trip (no auth check — operator tool, same contract as journey.ts).
 *
 * Requires: DATABASE_URL.
 *
 *   pnpm -F @sortey/api exec tsx scripts/cast-grounding.ts <command> [flags]
 *
 * Commands:
 *   push     --trip <id> --segment <segId> --file <ooda-export.md>
 *            [--thread <oodaThreadId>] [--title "override"]
 *   preview  --file <ooda-export.md>          Parse and print, no DB write
 *   list     --trip <id>                      Show pushed briefs
 *
 * OODA side (docs: /Volumes/dev/bob/ooda): run a research thread on the
 * corridor, promote notes (provenance-backed notes get [N] source markers,
 * others export as [UNVERIFIED]), then `ooda export` the brief markdown and
 * feed it here. Verified facts are narrated with attribution by the script
 * generator; unverified ones stay hedged.
 */

import { readFileSync } from "node:fs";

import { and, desc, eq } from "@sortey/db";
import { db } from "@sortey/db/client";
import { castGroundingBriefs, tripSegments } from "@sortey/db/schema";

import { parseOodaBriefMarkdown } from "../src/cast/grounding";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const command = process.argv[2];

  if (command === "preview") {
    const file = flag("file") ?? fail("--file required");
    const parsed = parseOodaBriefMarkdown(readFileSync(file, "utf-8"));
    console.log(JSON.stringify(parsed, null, 2));
    console.log(
      `\n${parsed.facts.length} facts (${parsed.facts.filter((f) => f.verified).length} verified), ${parsed.sources.length} sources`,
    );
    return;
  }

  if (command === "list") {
    const tripId = flag("trip") ?? fail("--trip required");
    const rows = (await db
      .select({
        id: castGroundingBriefs.id,
        segmentId: castGroundingBriefs.segmentId,
        title: castGroundingBriefs.title,
        createdAt: castGroundingBriefs.createdAt,
      })
      .from(castGroundingBriefs)
      .where(eq(castGroundingBriefs.tripId, tripId))
      .orderBy(desc(castGroundingBriefs.createdAt))) as Array<{
      id: string;
      segmentId: string;
      title: string;
      createdAt: Date;
    }>;
    for (const row of rows) {
      console.log(
        `${row.createdAt.toISOString()}  segment=${row.segmentId}  ${row.title}  (${row.id})`,
      );
    }
    if (rows.length === 0) console.log("No grounding briefs pushed.");
    return;
  }

  if (command === "push") {
    const tripId = flag("trip") ?? fail("--trip required");
    const segmentId = flag("segment") ?? fail("--segment required");
    const file = flag("file") ?? fail("--file required");

    const [segment] = (await db
      .select({ id: tripSegments.id, name: tripSegments.name })
      .from(tripSegments)
      .where(
        and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)),
      )
      .limit(1)) as Array<{ id: string; name: string }>;
    if (!segment)
      fail(`Segment ${segmentId} does not belong to trip ${tripId}`);

    const parsed = parseOodaBriefMarkdown(readFileSync(file, "utf-8"));
    if (parsed.facts.length === 0) {
      fail("Parsed zero facts — is this an OODA brief export?");
    }

    const [inserted] = (await db
      .insert(castGroundingBriefs)
      .values({
        tripId,
        segmentId,
        title: flag("title") ?? parsed.title,
        facts: parsed.facts,
        sources: parsed.sources,
        provenance: {
          oodaThreadId: flag("thread"),
          exportedAt: new Date().toISOString(),
        },
      })
      .returning({ id: castGroundingBriefs.id })) as Array<{ id: string }>;

    console.log(
      `Pushed brief ${inserted?.id} for segment "${segment.name}": ${parsed.facts.length} facts (${parsed.facts.filter((f) => f.verified).length} verified), ${parsed.sources.length} sources.`,
    );
    return;
  }

  fail(
    "Usage: cast-grounding.ts <push|preview|list> [flags] (see file header)",
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);

/**
 * Real iOverlander importer — loads an iOverlander CSV export into `imported_poi`
 * (source = "ioverlander"), the gold-standard van-life dataset for legal
 * overnight camping (wild/informal/established), water, dump, propane, etc.
 *
 * iOverlander's API is Cloudflare-gated and the full-US export needs an
 * Unlimited subscription, so export the CSV from your account
 * (app.ioverlander.com/countries/places_by_country → CSV) and point this at it:
 *
 *   DATABASE_URL="..." pnpm -F @sortey/db exec tsx \
 *     scripts/import-ioverlander-csv.ts --file ~/Downloads/iOverlander.csv \
 *     --workspace <workspaceId> [--dry-run]
 *
 * LICENSING: iOverlander data can't be redistributed across users. Pass
 * `--workspace <id>` so the rows are scoped to that user's workspace (the app's
 * in-app upload does the same). Parsing/scoping/insert all live in
 * `@sortey/db/ioverlander`, shared with the tRPC upload path so behaviour is
 * identical.
 */

import { readFileSync } from "node:fs";

import { db } from "../src/client";
import { importIoverlanderCsv, parseIoverlanderCsv } from "../src/ioverlander";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = typeof args.file === "string" ? args.file : null;
  if (!file) throw new Error("--file <iOverlander.csv> is required");
  const dryRun = args["dry-run"] === true;
  // Scope this upload to a workspace (iOverlander can't be redistributed, so a
  // user's POIs stay private). Omit only for shared/seed datasets.
  const workspaceId =
    typeof args.workspace === "string" ? args.workspace : null;
  if (!workspaceId) {
    console.warn(
      "⚠️  No --workspace given: importing as SHARED (workspaceId=NULL). " +
        "iOverlander data is per-user — pass --workspace <id> for a real upload.",
    );
  }

  const text = readFileSync(file, "utf8");

  if (dryRun) {
    const parsed = parseIoverlanderCsv(text, workspaceId);
    console.log(
      `Parsed ${parsed.total} iOverlander POIs (${parsed.skipped} skipped).`,
    );
    console.log(
      Object.entries(parsed.catCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `  ${c}: ${n}`)
        .join("\n"),
    );
    console.log("\n(dry run — nothing written)");
    process.exit(0);
  }

  const result = await importIoverlanderCsv(db, { text, workspaceId });
  console.log(
    Object.entries(result.catCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `  ${c}: ${n}`)
      .join("\n"),
  );
  console.log(
    `\n✅ Imported ${result.imported} iOverlander POIs (${result.skipped} skipped, dupes ignored).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("iOverlander import failed:", err);
  process.exit(1);
});

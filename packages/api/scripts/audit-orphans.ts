/**
 * Find tRPC procedures no surface calls.
 *
 * Three bugs in one night came from this shape: `serviceAlerts` computing
 * predictions nothing rendered, the cast eval floor called by nothing, and a
 * co-pilot fallback reachable only from a path the grep missed. Tests pass on
 * all of them — a procedure with no caller still has unit coverage, and
 * coverage of dead code reads exactly like coverage of live code.
 *
 * So this asks the one question tests cannot: does anything actually call it?
 *
 * Deliberately noisy in one direction. Call styles vary (`trpc.x.y`,
 * `trpcClient.x.y`, `caller.x.y`, `api.x.y`), so a procedure is only reported
 * when its name appears nowhere in any consuming package. Better to under-
 * report than to cry wolf — an audit nobody trusts gets ignored, which is how
 * the orphans accumulated in the first place.
 *
 *   pnpm -F @sortey/api exec tsx scripts/audit-orphans.ts
 */

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTER_DIR = "src/router";
const CONSUMERS = [
  "../../apps/nextjs/src",
  "../../apps/expo/src",
  "../../packages/mcp-server/src",
  "../../packages/trpc-cli/src",
];

/** `  name: tripProcedure()` and friends, at router top level. */
const PROCEDURE =
  /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*(?:trip|workspace|protected|public|admin)Procedure/gm;

function consumerText(): string {
  const parts: string[] = [];
  for (const dir of CONSUMERS) {
    try {
      parts.push(
        execSync(
          `grep -rho --include=*.ts --include=*.tsx "\\.[a-zA-Z][a-zA-Z0-9]*" ${dir} 2>/dev/null || true`,
          { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        ),
      );
    } catch {
      // A missing consumer package is not an error; it just contributes nothing.
    }
  }
  return parts.join("\n");
}

function main() {
  const referenced = new Set(
    consumerText()
      .split("\n")
      .map((line) => line.trim().replace(/^\./, ""))
      .filter(Boolean),
  );

  const orphans: Array<{ router: string; procedure: string }> = [];
  let total = 0;

  for (const file of readdirSync(ROUTER_DIR)) {
    if (!file.endsWith(".ts") || file.startsWith("__")) continue;
    const source = readFileSync(join(ROUTER_DIR, file), "utf8");
    for (const match of source.matchAll(PROCEDURE)) {
      const procedure = match[1]!;
      total++;
      if (!referenced.has(procedure)) {
        orphans.push({ router: file.replace(/\.ts$/, ""), procedure });
      }
    }
  }

  console.log(`${total} procedures · ${orphans.length} with no caller found\n`);
  const byRouter = new Map<string, string[]>();
  for (const { router, procedure } of orphans) {
    byRouter.set(router, [...(byRouter.get(router) ?? []), procedure]);
  }
  for (const [router, procedures] of [...byRouter].sort()) {
    console.log(`  ${router}: ${procedures.sort().join(", ")}`);
  }
  if (orphans.length === 0) console.log("  (none)");
  console.log(
    "\nEach is either dead code, an agent-only surface (MCP/CLI), or something\nbuilt and never wired. The third is the one that bites.",
  );
}

main();

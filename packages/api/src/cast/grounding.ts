import type { CastGroundingFact, CastGroundingSource } from "@sortey/db/schema";

/**
 * Parser for OODA research-brief exports (thread-workspace `exportBrief`):
 *
 *   # <title>
 *   *Research brief generated YYYY-MM-DD*
 *   ### <note title> [1]          ← provenance-backed, [N] indexes a source
 *   <content…>
 *   ### <note title> [UNVERIFIED] ← promoted without provenance — a lead
 *   <content…>
 *   ## Sources
 *   [1] <capabilityId>: <url> (retrieved <iso>)
 *
 * The bridge turns this into a CastGroundingBrief the script prompt can trust:
 * verified facts may be narrated with soft attribution; [UNVERIFIED] notes
 * stay hedged like any other model knowledge.
 */

export type ParsedGroundingBrief = {
  title: string;
  facts: CastGroundingFact[];
  sources: CastGroundingSource[];
};

const NOTE_HEADING = /^###\s+(.+?)\s+\[(\d+|UNVERIFIED)\]\s*$/;
const SOURCE_LINE =
  /^\[(\d+)\]\s+([^:]+):\s+(.+?)(?:\s+\(retrieved\s+([^)]+)\))?\s*$/;

export function parseOodaBriefMarkdown(markdown: string): ParsedGroundingBrief {
  const lines = markdown.split("\n");

  let title = "Research brief";
  const facts: CastGroundingFact[] = [];
  const sources: CastGroundingSource[] = [];

  let current: CastGroundingFact | null = null;
  let currentBody: string[] = [];
  let inSources = false;

  const flush = () => {
    if (!current) return;
    const text = currentBody.join("\n").trim();
    if (text.length > 0) {
      facts.push({ ...current, text });
    }
    current = null;
    currentBody = [];
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1 && title === "Research brief" && !current && !inSources) {
      title = h1[1]!.trim();
      continue;
    }

    if (/^##\s+Sources\s*$/.test(line)) {
      flush();
      inSources = true;
      continue;
    }

    if (inSources) {
      const source = line.match(SOURCE_LINE);
      if (source) {
        sources.push({
          index: Number(source[1]),
          capabilityId: source[2]!.trim(),
          url:
            source[3]!.trim() === "no URL available" ? null : source[3]!.trim(),
          retrievedAt: source[4]?.trim() ?? null,
        });
      }
      continue;
    }

    const heading = line.match(NOTE_HEADING);
    if (heading) {
      flush();
      const marker = heading[2]!;
      current = {
        title: heading[1]!.trim(),
        text: "",
        verified: marker !== "UNVERIFIED",
        sourceIndexes: marker === "UNVERIFIED" ? [] : [Number(marker)],
      };
      continue;
    }

    // Skip the generated-date byline; keep everything else as note body.
    if (current && !/^\*Research brief generated /.test(line)) {
      currentBody.push(line);
    }
  }
  flush();

  return { title, facts, sources };
}

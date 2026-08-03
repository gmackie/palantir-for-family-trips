import type { CastScript } from "@sortey/db/schema";

import type { CastDayContext } from "../context";
import { CAST_WORDS_PER_MINUTE } from "../prompt";

/**
 * Structural quality checks for a generated Corridor Cast script.
 *
 * Prompts cannot be regression-tested by reading them. Once the wording moves,
 * the only way to know whether the episode still honours its contract — length
 * budget, sourcing disclaimer, the anchors the travellers actually care about,
 * prose that survives text-to-speech — is to assert it. This module is that
 * floor: pure functions over (context, script), no model calls, so it runs in
 * the normal test suite and can also be pointed at real output.
 *
 * These are structural checks, not taste. They catch a script that broke its
 * contract, not one that is merely dull.
 */

export type EvalSeverity = "error" | "warning";

export interface EvalCheck {
  id: string;
  severity: EvalSeverity;
  passed: boolean;
  detail: string;
}

export interface EvalReport {
  checks: EvalCheck[];
  /** No failing `error` check. Warnings do not fail an episode. */
  passed: boolean;
}

/** Words as TTS will read them, not as a tokenizer sees them. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const WORD_BUDGET_TOLERANCE = 0.2;
/** Below this a chapter is a stub regardless of its declared target. */
const MIN_CHAPTER_WORDS = 40;

/** Markup that reads aloud as garbage: headings, bullets, emphasis, cues. */
const TTS_HOSTILE = [
  { id: "heading", re: /^\s{0,3}#{1,6}\s/m, label: "markdown heading" },
  { id: "bullet", re: /^\s{0,3}[-*+]\s+\S/m, label: "list bullet" },
  { id: "numbered", re: /^\s{0,3}\d+[.)]\s+\S/m, label: "numbered list" },
  { id: "emphasis", re: /\*\*|__|\*\S|\S\*/, label: "markdown emphasis" },
  { id: "cue", re: /\[[^\]]{2,40}\]/, label: "bracketed stage direction" },
] as const;

function check(
  id: string,
  severity: EvalSeverity,
  passed: boolean,
  detail: string,
): EvalCheck {
  return { id, severity, passed, detail };
}

/** Loose containment: case- and punctuation-insensitive substring match. */
function mentions(haystack: string, needle: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const n = normalize(needle);
  return n.length > 0 && normalize(haystack).includes(n);
}

/** Words too common to identify a fact when they appear in a script. */
const ENTITY_STOPWORDS = new Set([
  "the",
  "and",
  "why",
  "how",
  "what",
  "when",
  "lead",
  "a",
  "an",
  "is",
  "it",
  "of",
  "in",
  "on",
  "to",
  "for",
  "from",
]);

/**
 * Distinctive proper-noun phrases in a research fact — "Waterpocket Fold",
 * "Charlie Steen", "Robbers Roost".
 *
 * Matching the whole fact TITLE was the obvious approach and it was wrong:
 * a title like "The Waterpocket Fold is the spine of the drive" never appears
 * verbatim in narration, so a script that discusses the fold at length scored
 * as ignoring it. Running the eval against a real stored script reported 1 of
 * 7 facts used where at least 4 plainly were — an eval that cries wolf gets
 * switched off, which is worse than not having one.
 */
export function factEntities(fact: { title: string; text: string }): string[] {
  const source = `${fact.title}. ${fact.text}`;
  const phrases = source.match(/\b[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*/g) ?? [];
  return phrases
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length >= 4)
    .filter((phrase) => {
      const words = phrase.toLowerCase().split(/\s+/);
      // A single common word is not an entity; a multi-word phrase is.
      return words.length > 1 || !ENTITY_STOPWORDS.has(words[0] ?? "");
    });
}

/**
 * True when the narration names something that identifies THIS fact.
 *
 * Entities shared across several facts cannot attribute usage to any one of
 * them. Auditing a real script against a real brief showed exactly that: the
 * Hole-in-the-Rock fact scored as "used" because the script said "Escalante",
 * which it said while describing Highway 12. Counting shared ground as
 * evidence turns the check into a rubber stamp — the opposite failure from
 * crying wolf, and the more dangerous one, because nobody notices.
 */
export function factReferenced(
  text: string,
  fact: { title: string; text: string },
  siblings: Array<{ title: string; text: string }> = [],
): boolean {
  const shared = new Set(
    siblings
      .filter((other) => other.title !== fact.title)
      .flatMap((other) => factEntities(other).map((e) => e.toLowerCase())),
  );
  const distinctive = factEntities(fact).filter(
    (entity) => !shared.has(entity.toLowerCase()),
  );
  return distinctive.some((entity) => mentions(text, entity));
}

export function evaluateCastScript(params: {
  context: CastDayContext;
  script: CastScript;
  durationMinutes: number;
}): EvalReport {
  const { context, script, durationMinutes } = params;
  const checks: EvalCheck[] = [];
  const fullText = script.segments.map((s) => s.text).join("\n\n");
  const totalWords = countWords(fullText);

  checks.push(
    check(
      "title",
      "error",
      script.episodeTitle.trim().length > 0,
      `episodeTitle: ${JSON.stringify(script.episodeTitle)}`,
    ),
  );

  // Every outlined chapter must be written, in order, with no extras.
  const outlineKeys = script.outline.map((s) => s.key);
  const segmentKeys = script.segments.map((s) => s.key);
  checks.push(
    check(
      "outline-coverage",
      "error",
      outlineKeys.length === segmentKeys.length &&
        outlineKeys.every((k, i) => segmentKeys[i] === k),
      `outline [${outlineKeys.join(", ")}] vs segments [${segmentKeys.join(", ")}]`,
    ),
  );
  checks.push(
    check(
      "unique-keys",
      "error",
      new Set(segmentKeys).size === segmentKeys.length,
      `keys: ${segmentKeys.join(", ")}`,
    ),
  );

  // Episode length: the listener asked for 15 or 30 minutes of company.
  const targetWords = durationMinutes * CAST_WORDS_PER_MINUTE;
  const lowerBound = targetWords * (1 - WORD_BUDGET_TOLERANCE);
  const upperBound = targetWords * (1 + WORD_BUDGET_TOLERANCE);
  checks.push(
    check(
      "episode-length",
      "error",
      totalWords >= lowerBound && totalWords <= upperBound,
      `${totalWords} words vs ${Math.round(lowerBound)}–${Math.round(upperBound)} for ${durationMinutes} min`,
    ),
  );

  for (const segment of script.segments) {
    const words = countWords(segment.text);
    const low = Math.max(
      segment.wordTarget * (1 - WORD_BUDGET_TOLERANCE),
      MIN_CHAPTER_WORDS,
    );
    const high = segment.wordTarget * (1 + WORD_BUDGET_TOLERANCE);
    checks.push(
      check(
        `chapter-length:${segment.key}`,
        "error",
        words >= low && words <= high,
        `${words} words vs ${Math.round(low)}–${Math.round(high)}`,
      ),
    );
  }

  // Spoken prose only — the text goes straight to text-to-speech.
  for (const pattern of TTS_HOSTILE) {
    const offender = script.segments.find((s) => pattern.re.test(s.text));
    checks.push(
      check(
        `tts-clean:${pattern.id}`,
        "error",
        offender == null,
        offender ? `${pattern.label} in "${offender.key}"` : "none",
      ),
    );
  }

  // The sourcing disclaimer: the listener must be told where stories come from.
  const intro = script.segments[0]?.text ?? "";
  const hasDisclaimer = context.grounding
    ? /research file|research|the record|histories/i.test(intro)
    : /campfire truth/i.test(intro);
  checks.push(
    check(
      "sourcing-disclaimer",
      "error",
      hasDisclaimer,
      context.grounding
        ? "intro must reference the trip's research"
        : "intro must say the color is campfire truth",
    ),
  );

  // Operational ground truth the travellers are relying on.
  if (context.segment?.destinationName) {
    checks.push(
      check(
        "mentions-destination",
        "error",
        mentions(fullText, context.segment.destinationName),
        context.segment.destinationName,
      ),
    );
  }

  const missingAnchors = context.anchors
    .map((a) => a.placeName ?? a.title)
    .filter((label): label is string => Boolean(label))
    .filter((label) => !mentions(fullText, label));
  checks.push(
    check(
      "mentions-anchors",
      "error",
      missingAnchors.length === 0,
      missingAnchors.length
        ? `unmentioned: ${missingAnchors.join(", ")}`
        : "ok",
    ),
  );

  if (context.pois.length > 0) {
    const grounded = context.pois.filter((p) => mentions(fullText, p.name));
    checks.push(
      check(
        "grounded-poi",
        "warning",
        grounded.length > 0,
        `${grounded.length}/${context.pois.length} corridor POIs referenced`,
      ),
    );
  }

  // Sourced research is the best color available — it should get used.
  if (context.grounding) {
    const verified = context.grounding.facts.filter((f) => f.verified);
    const used = verified.filter((f) =>
      factReferenced(fullText, f, context.grounding?.facts ?? []),
    );
    checks.push(
      check(
        "uses-research",
        "warning",
        verified.length === 0 || used.length > 0,
        `${used.length}/${verified.length} verified facts referenced`,
      ),
    );
  }

  return {
    checks,
    passed: checks.every((c) => c.severity !== "error" || c.passed),
  };
}

/** One-line-per-check summary, for a failing test or an operator run. */
export function formatEvalReport(report: EvalReport): string {
  return report.checks
    .map(
      (c) =>
        `${c.passed ? "PASS" : c.severity === "error" ? "FAIL" : "WARN"}  ${c.id}  ${c.detail}`,
    )
    .join("\n");
}

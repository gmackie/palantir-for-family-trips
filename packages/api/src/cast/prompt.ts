import { z } from "zod/v4";

import type { CastDayContext } from "./context";

/**
 * Corridor Cast prompts — two-tier grounding honesty (eng-review Issue 7).
 *
 * Tier 1 — OPERATIONAL FACTS: roads, towns, distances, drive times, stops,
 * anchors, reservations, POIs. These may ONLY come from the context pack and
 * must be stated exactly as given. The context pack is the entire operational
 * ground truth; nothing operational may be invented.
 *
 * Tier 2 — DOCUMENTARY COLOR: history, geology, culture from the model's
 * general knowledge. Allowed, but must be hedged ("the story goes…", "this
 * stretch is known for…"), must avoid unanchorable specifics (exact dates,
 * population figures, names of living people, business hours, prices), and
 * the episode intro carries a one-line disclaimer that color commentary is
 * from general knowledge, not verified trip data.
 */

export const CAST_WORDS_PER_MINUTE = 145;

export const castOutlineSchema = z.object({
  episodeTitle: z.string().min(1).max(200),
  segments: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .max(40)
          .describe("stable slug for the chapter, e.g. 'intro', 'chapter-2'"),
        title: z.string().min(1).max(200),
        beats: z.array(z.string().max(300)).min(1).max(8),
        wordTarget: z.number().int().min(50).max(1500),
      }),
    )
    .min(3)
    .max(10),
});

export type CastOutline = z.infer<typeof castOutlineSchema>;

export const castSegmentTextSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe("the spoken narration for this chapter, plain prose"),
});

export const CAST_SYSTEM_PROMPT = `You are the writer-narrator of "Corridor Cast", a private podcast generated the night before a family van-trip drive day. One episode covers exactly one day's drive. The listeners are the travelers themselves, driving this exact route tomorrow.

GROUNDING RULES — these are absolute:

TIER 1 — OPERATIONAL FACTS. Roads, towns, distances, drive durations, stops, campgrounds, reservations, anchors (fixed commitments), and points of interest may ONLY come from the CONTEXT JSON provided by the user. State them exactly as given. If the context does not contain an operational detail, do not invent it — speak in general terms instead. Never invent mileages, place names, opening hours, prices, or availability.

TIER 2 — DOCUMENTARY COLOR. You may add history, geology, ecology, and culture of the region from your general knowledge — that is what makes the episode worth listening to. But color must be:
- hedged in phrasing ("the story goes…", "this country is known for…", "long before the highway…"),
- free of unanchorable specifics: no precise dates or statistics, no population figures, no names of living private individuals, no claims about current businesses,
- clearly color, never disguised as trip logistics.

STYLE:
- Spoken audio: flowing prose only. No headings, no lists, no markdown, no stage directions, no sound-effect cues. The text is fed directly to text-to-speech.
- Warm, curious, a little wry — a well-read friend riding shotgun, not a tour-bus announcer.
- Numbers as words where natural ("about two hundred miles"), never as bare digits with units that read poorly aloud.
- Address the travelers as "you". Reference tomorrow's plan naturally.
- Each chapter should flow from the previous one; open and close chapters with soft transitions, not announcements.

The episode intro must include one natural sentence acknowledging that the color commentary comes from general knowledge rather than verified trip data — keep it light, e.g. "the road facts tonight come straight from your plan; the stories along the way are mine, so take them as campfire truth."`;

export function buildOutlineUserPrompt(
  context: CastDayContext,
  durationMinutes: number,
): string {
  const totalWords = durationMinutes * CAST_WORDS_PER_MINUTE;
  const chapterRange = durationMinutes <= 15 ? "4 to 6" : "6 to 9";
  return `Plan tomorrow's episode as a chapter outline.

EPISODE LENGTH: ${durationMinutes} minutes ≈ ${totalWords} words total. The wordTarget values across all chapters must sum to within 10% of ${totalWords}.

CHAPTERS: ${chapterRange} chapters including a short "intro" first chapter and a short "outro" last chapter. Middle chapters follow the drive in order — corridor stretches, the day's plan, anchors coming up, and worthwhile color for the country you'll pass through.
${
  context.degraded
    ? "\nNOTE: this drive leg has no route geometry in the plan, so there are no corridor points of interest. Build the episode from the origin, destination, distance, the day's plan, and regional color only.\n"
    : ""
}
CONTEXT JSON (tier-1 operational ground truth):
${JSON.stringify(context, null, 2)}

Return the outline.`;
}

export function buildSegmentUserPrompt(params: {
  context: CastDayContext;
  outline: CastOutline;
  segmentKey: string;
  previousText: string | null;
}): string {
  const segment = params.outline.segments.find(
    (s) => s.key === params.segmentKey,
  );
  if (!segment) {
    throw new Error(`Outline has no segment with key ${params.segmentKey}`);
  }
  const outlineSummary = params.outline.segments
    .map((s) => `- [${s.key}] ${s.title} (~${s.wordTarget} words)`)
    .join("\n");

  return `Write the narration for ONE chapter of tomorrow's episode: "${params.outline.episodeTitle}".

FULL OUTLINE (for continuity — write only the chapter marked NOW):
${outlineSummary}

CHAPTER TO WRITE NOW: [${segment.key}] ${segment.title}
Beats to cover:
${segment.beats.map((b) => `- ${b}`).join("\n")}
Target length: ${segment.wordTarget} words (stay within 20% of this).
${
  params.previousText
    ? `\nThe previous chapter ended with:\n"…${params.previousText.slice(-300)}"\nOpen with a soft transition from that.`
    : "\nThis is the first chapter — open the episode."
}

CONTEXT JSON (tier-1 operational ground truth):
${JSON.stringify(params.context, null, 2)}

Return only the narration text for this chapter.`;
}

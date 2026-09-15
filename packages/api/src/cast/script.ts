import type { CastScript } from "@sortey/db/schema";

import { createScriptGenerator } from "../llm/create-generator";
import {
  DEFAULT_SCRIPT_MODELS,
  type LlmUsage,
  resolveLlmProviderOrDefault,
  type StructuredGenerator,
  scriptModelFor,
} from "../llm/structured";
import type { CastDayContext } from "./context";
import {
  buildOutlineUserPrompt,
  buildSegmentUserPrompt,
  CAST_SYSTEM_PROMPT,
  castOutlineSchema,
  castSegmentTextSchema,
} from "./prompt";

/**
 * Outline-then-per-segment script generation. A 30-minute script (~4,500
 * words) exceeds what one structured call produces reliably, so the outline
 * fixes the chapter plan and each chapter is generated in its own call with
 * the tail of the previous chapter for continuity.
 */

export const DEFAULT_CAST_SCRIPT_MODEL = DEFAULT_SCRIPT_MODELS.anthropic;
/** Per-LLM-call cap so one slow request can't eat the whole cron budget. */
const SCRIPT_CALL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * The model this deployment will actually use — provider-aware, so a
 * Gemini-keyed worker records `gemini-…` on the episode rather than the Claude
 * default it never called.
 */
export function castScriptModel(): string {
  return scriptModelFor(resolveLlmProviderOrDefault());
}

export class CastDeadlineError extends Error {}

export async function generateCastScript(params: {
  context: CastDayContext;
  durationMinutes: number;
  /** Test seam / explicit provider override; resolved from env by default. */
  generate?: StructuredGenerator;
  model?: string;
  /** Epoch ms — abort between chapters before the cron wall clock kills us. */
  deadline?: number;
  now?: () => number;
  onUsage?: (usage: LlmUsage) => void;
}): Promise<CastScript> {
  const generate =
    params.generate ?? createScriptGenerator({ model: params.model }).generate;
  const now = params.now ?? Date.now;

  const outline = await generate({
    systemPrompt: CAST_SYSTEM_PROMPT,
    userText: buildOutlineUserPrompt(params.context, params.durationMinutes),
    schema: castOutlineSchema,
    timeoutMs: SCRIPT_CALL_TIMEOUT_MS,
    onUsage: params.onUsage,
  });

  const segments: CastScript["segments"] = [];
  let previousText: string | null = null;

  for (const outlineSegment of outline.segments) {
    if (params.deadline != null && now() >= params.deadline) {
      // A controlled failure the pump retries beats being killed by the cron
      // wall clock mid-request (which burns a stale-lease reclaim attempt AND
      // loses the token accounting).
      throw new CastDeadlineError(
        `Script generation ran out of pump budget after ${segments.length}/${outline.segments.length} chapters.`,
      );
    }
    const chapter: { text: string } = await generate({
      systemPrompt: CAST_SYSTEM_PROMPT,
      userText: buildSegmentUserPrompt({
        context: params.context,
        outline,
        segmentKey: outlineSegment.key,
        previousText,
      }),
      schema: castSegmentTextSchema,
      // A 1,500-word chapter needs headroom beyond the 4096 OCR default.
      maxTokens: 8192,
      timeoutMs: SCRIPT_CALL_TIMEOUT_MS,
      onUsage: params.onUsage,
    });
    segments.push({
      key: outlineSegment.key,
      title: outlineSegment.title,
      text: chapter.text,
      wordTarget: outlineSegment.wordTarget,
    });
    previousText = chapter.text;
  }

  return {
    episodeTitle: outline.episodeTitle,
    outline: outline.segments.map((s) => ({
      key: s.key,
      title: s.title,
      beats: s.beats,
      wordTarget: s.wordTarget,
    })),
    segments,
  };
}

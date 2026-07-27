import Anthropic from "@anthropic-ai/sdk";
import type { CastScript } from "@sortey/db/schema";

import { generateStructured, type LlmUsage } from "../llm/extract-structured";
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

export const DEFAULT_CAST_SCRIPT_MODEL = "claude-sonnet-4-6";

export function castScriptModel(): string {
  return process.env.CAST_SCRIPT_MODEL ?? DEFAULT_CAST_SCRIPT_MODEL;
}

export async function generateCastScript(params: {
  context: CastDayContext;
  durationMinutes: number;
  client?: Anthropic;
  model?: string;
  onUsage?: (usage: LlmUsage) => void;
}): Promise<CastScript> {
  const client = params.client ?? new Anthropic();
  const model = params.model ?? castScriptModel();

  const outline = await generateStructured({
    client,
    model,
    systemPrompt: CAST_SYSTEM_PROMPT,
    userText: buildOutlineUserPrompt(params.context, params.durationMinutes),
    schema: castOutlineSchema,
    onUsage: params.onUsage,
  });

  const segments: CastScript["segments"] = [];
  let previousText: string | null = null;

  for (const outlineSegment of outline.segments) {
    const chapter: { text: string } = await generateStructured({
      client,
      model,
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

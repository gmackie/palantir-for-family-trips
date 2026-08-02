/**
 * Per-trip spend ceiling for Corridor Cast.
 *
 * Every episode costs real money twice — model tokens to write it, voice
 * characters to speak it. The read gate stops an unwanted script reaching TTS,
 * but nothing stopped a trip generating episodes until someone noticed the
 * bill. This is the ceiling, and it is checked at ENQUEUE, before either spend
 * begins: refusing after the fact is just an expensive error message.
 *
 * The budget is denominated in the units we actually meter — output tokens and
 * TTS characters — rather than dollars. Model prices move and differ per
 * provider; inventing a dollar figure here would be a number that looks
 * authoritative and is wrong. Operators who want dollars can multiply.
 */

export interface CastUsage {
  llmOutputTokens: number;
  ttsCharacters: number;
  episodes: number;
}

export interface CastBudgetLimits {
  llmOutputTokens: number;
  ttsCharacters: number;
}

/**
 * Defaults sized for roughly a month of nightly 30-minute episodes with room
 * for retries: a 30-minute script is ~4,350 words (~25k TTS characters and
 * ~6k output tokens), so ~31 episodes lands near 800k characters.
 */
export const DEFAULT_CAST_BUDGET: CastBudgetLimits = {
  llmOutputTokens: 400_000,
  ttsCharacters: 900_000,
};

export class CastBudgetExceededError extends Error {
  constructor(
    readonly kind: "tokens" | "characters",
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      kind === "characters"
        ? `This trip has used ${used.toLocaleString()} of ${limit.toLocaleString()} voice characters this month. Raise CAST_MONTHLY_TTS_CHARACTERS or wait for the month to roll over.`
        : `This trip has used ${used.toLocaleString()} of ${limit.toLocaleString()} script tokens this month. Raise CAST_MONTHLY_LLM_OUTPUT_TOKENS or wait for the month to roll over.`,
    );
    this.name = "CastBudgetExceededError";
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function castBudgetLimits(
  env: Record<string, string | undefined> = process.env,
): CastBudgetLimits {
  return {
    llmOutputTokens: positiveInt(
      env.CAST_MONTHLY_LLM_OUTPUT_TOKENS,
      DEFAULT_CAST_BUDGET.llmOutputTokens,
    ),
    ttsCharacters: positiveInt(
      env.CAST_MONTHLY_TTS_CHARACTERS,
      DEFAULT_CAST_BUDGET.ttsCharacters,
    ),
  };
}

/**
 * Throws when this month's usage has already reached a ceiling. Usage AT the
 * limit blocks: the next episode would cross it, and the whole point is to
 * stop before the spend rather than after.
 */
export function assertWithinCastBudget(
  usage: CastUsage,
  limits: CastBudgetLimits = castBudgetLimits(),
): void {
  if (usage.ttsCharacters >= limits.ttsCharacters) {
    throw new CastBudgetExceededError(
      "characters",
      usage.ttsCharacters,
      limits.ttsCharacters,
    );
  }
  if (usage.llmOutputTokens >= limits.llmOutputTokens) {
    throw new CastBudgetExceededError(
      "tokens",
      usage.llmOutputTokens,
      limits.llmOutputTokens,
    );
  }
}

/** First instant of `now`'s UTC month — the window usage is summed over. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function remainingCastBudget(
  usage: CastUsage,
  limits: CastBudgetLimits = castBudgetLimits(),
): { llmOutputTokens: number; ttsCharacters: number } {
  return {
    llmOutputTokens: Math.max(
      limits.llmOutputTokens - usage.llmOutputTokens,
      0,
    ),
    ttsCharacters: Math.max(limits.ttsCharacters - usage.ttsCharacters, 0),
  };
}

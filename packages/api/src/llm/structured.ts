import type { z } from "zod/v4";

/**
 * Provider-agnostic structured generation.
 *
 * Corridor Cast originally spoke only to Claude. The worker, though, is
 * deployed with whichever model keys happen to be set, so script generation
 * resolves a provider at call time instead of hard-wiring one: Claude when
 * `ANTHROPIC_API_KEY` is present (its prose is what the tier-1.5 attribution
 * rules were tuned against), Gemini when only `GEMINI_API_KEY` is.
 *
 * Callers depend on `StructuredGenerator`, never on a vendor SDK.
 */

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type StructuredRequest<T> = {
  systemPrompt: string;
  userText: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Per-request cap — an SDK default can outlive a cron budget. */
  timeoutMs?: number;
  onUsage?: (usage: LlmUsage) => void;
};

export type StructuredGenerator = <T>(
  request: StructuredRequest<T>,
) => Promise<T>;

export const LLM_PROVIDERS = ["anthropic", "gemini"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const DEFAULT_SCRIPT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-pro",
};

export class NoLlmProviderError extends Error {
  constructor() {
    super(
      "No LLM provider configured — set ANTHROPIC_API_KEY (preferred) or GEMINI_API_KEY.",
    );
  }
}

type Env = Record<string, string | undefined>;

function isProvider(value: string | undefined): value is LlmProvider {
  return LLM_PROVIDERS.includes(value as LlmProvider);
}

/**
 * Explicit `CAST_LLM_PROVIDER` wins; otherwise Claude is preferred and Gemini
 * is the fallback. Throws rather than guessing when neither key is present, so
 * a misconfigured worker fails loudly on the first job instead of burning
 * every retry on an auth error.
 */
export function resolveLlmProvider(env: Env = process.env): LlmProvider {
  if (isProvider(env.CAST_LLM_PROVIDER)) return env.CAST_LLM_PROVIDER;
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.GEMINI_API_KEY ?? env.GOOGLE_AI_API_KEY) return "gemini";
  throw new NoLlmProviderError();
}

/**
 * The provider that would be used, or the safe default when nothing is
 * configured. For labelling and cost accounting only — never for dispatch.
 */
export function resolveLlmProviderOrDefault(
  env: Env = process.env,
): LlmProvider {
  try {
    return resolveLlmProvider(env);
  } catch {
    return "anthropic";
  }
}

export function scriptModelFor(
  provider: LlmProvider,
  env: Env = process.env,
): string {
  const override =
    provider === "gemini"
      ? env.CAST_SCRIPT_MODEL_GEMINI
      : env.CAST_SCRIPT_MODEL;
  return override ?? DEFAULT_SCRIPT_MODELS[provider];
}

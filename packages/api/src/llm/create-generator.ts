import { createAnthropicGenerator } from "./extract-structured";
import { createGeminiGenerator } from "./gemini-structured";
import {
  type LlmProvider,
  resolveLlmProvider,
  type StructuredGenerator,
  scriptModelFor,
} from "./structured";

/**
 * Resolve the structured generator for whichever provider this deployment is
 * keyed for. Kept apart from `structured.ts` so type-only importers don't pull
 * both vendor SDKs into their bundle.
 */
export function createScriptGenerator(params?: {
  provider?: LlmProvider;
  model?: string;
}): { provider: LlmProvider; model: string; generate: StructuredGenerator } {
  const provider = params?.provider ?? resolveLlmProvider();
  const model = params?.model ?? scriptModelFor(provider);
  const generate =
    provider === "gemini"
      ? createGeminiGenerator({ model })
      : createAnthropicGenerator({ model });
  return { provider, model, generate };
}

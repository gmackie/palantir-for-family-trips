import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCRIPT_MODELS,
  NoLlmProviderError,
  resolveLlmProvider,
  resolveLlmProviderOrDefault,
  scriptModelFor,
} from "../structured";

describe("resolveLlmProvider", () => {
  it("prefers Claude when both keys are present", () => {
    expect(
      resolveLlmProvider({ ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" }),
    ).toBe("anthropic");
  });

  it("falls back to Gemini when only its key is set", () => {
    expect(resolveLlmProvider({ GEMINI_API_KEY: "g" })).toBe("gemini");
    expect(resolveLlmProvider({ GOOGLE_AI_API_KEY: "g" })).toBe("gemini");
  });

  it("honours an explicit override", () => {
    expect(
      resolveLlmProvider({
        CAST_LLM_PROVIDER: "gemini",
        ANTHROPIC_API_KEY: "a",
        GEMINI_API_KEY: "g",
      }),
    ).toBe("gemini");
    // A bogus override is ignored rather than crashing the pump.
    expect(
      resolveLlmProvider({ CAST_LLM_PROVIDER: "llama", GEMINI_API_KEY: "g" }),
    ).toBe("gemini");
  });

  it("throws when nothing is configured, instead of guessing", () => {
    expect(() => resolveLlmProvider({})).toThrow(NoLlmProviderError);
    // The labelling helper must stay total — it runs on the success path.
    expect(resolveLlmProviderOrDefault({})).toBe("anthropic");
  });
});

describe("scriptModelFor", () => {
  it("uses per-provider defaults and per-provider overrides", () => {
    expect(scriptModelFor("anthropic", {})).toBe(
      DEFAULT_SCRIPT_MODELS.anthropic,
    );
    expect(scriptModelFor("gemini", {})).toBe(DEFAULT_SCRIPT_MODELS.gemini);

    const env = {
      CAST_SCRIPT_MODEL: "claude-custom",
      CAST_SCRIPT_MODEL_GEMINI: "gemini-custom",
    };
    expect(scriptModelFor("anthropic", env)).toBe("claude-custom");
    // A Claude model id must never leak into a Gemini call.
    expect(scriptModelFor("gemini", env)).toBe("gemini-custom");
    expect(
      scriptModelFor("gemini", { CAST_SCRIPT_MODEL: "claude-custom" }),
    ).toBe(DEFAULT_SCRIPT_MODELS.gemini);
  });
});

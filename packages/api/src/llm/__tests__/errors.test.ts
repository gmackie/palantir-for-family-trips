import { describe, expect, it } from "vitest";

import { classifyLlmError } from "../errors";
import { NoLlmProviderError } from "../structured";

/** The SDKs surface upstream status either as a field or inside the message. */
function sdkError(message: string, status?: number) {
  const error = new Error(message) as Error & { status?: number };
  if (status != null) error.status = status;
  return error;
}

describe("classifyLlmError", () => {
  it("treats a missing provider as terminal with a fix-it message", () => {
    const failure = classifyLlmError(new NoLlmProviderError());
    expect(failure?.terminal).toBe(true);
    expect(failure?.message).toMatch(/ANTHROPIC_API_KEY or GEMINI_API_KEY/);
  });

  it("treats a rejected or restricted key as terminal", () => {
    expect(classifyLlmError(sdkError("invalid x-api-key", 401))?.terminal).toBe(
      true,
    );
    // The real shape from a Maps-restricted Google key.
    const blocked = sdkError(
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent: [403 Forbidden] Requests to this API are blocked. API_KEY_SERVICE_BLOCKED",
    );
    const failure = classifyLlmError(blocked);
    expect(failure?.terminal).toBe(true);
    expect(failure?.message).toMatch(/rejected this deployment's API key/);
    // The vendor blob must not leak into the console copy.
    expect(failure?.message).not.toMatch(/generativelanguage/);
  });

  it("treats a depleted balance as terminal, not as a rate limit", () => {
    const depleted = sdkError(
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent: [429 Too Many Requests] Your prepayment credits are depleted.",
    );
    const failure = classifyLlmError(depleted);
    expect(failure?.terminal).toBe(true);
    expect(failure?.message).toMatch(/out of credit/);

    expect(
      classifyLlmError(sdkError("Your credit balance is too low", 429))
        ?.terminal,
    ).toBe(true);
  });

  it("treats an unknown model as terminal and names the env knobs", () => {
    const failure = classifyLlmError(sdkError("model not found", 404));
    expect(failure?.terminal).toBe(true);
    expect(failure?.message).toMatch(/CAST_SCRIPT_MODEL_GEMINI/);
  });

  it("leaves genuinely transient failures on the normal retry path", () => {
    // A plain rate limit says nothing about billing — retrying is correct.
    expect(classifyLlmError(sdkError("rate limit exceeded", 429))).toBeNull();
    expect(classifyLlmError(sdkError("internal server error", 500))).toBeNull();
    expect(classifyLlmError(sdkError("socket hang up"))).toBeNull();
    expect(classifyLlmError(new Error("Request timed out"))).toBeNull();
  });
});

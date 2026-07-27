import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  castTtsModel,
  castVoiceId,
  DEFAULT_TTS_MODEL,
  ELEVENLABS_OUTPUT_FORMAT,
  FALLBACK_VOICE_ID,
  synthesizeSpeech,
} from "../elevenlabs";

// The dev shell exports a real ELEVENLABS_API_KEY — isolate the env so these
// tests behave identically on CI and on the dev machine.
const savedEnv: Record<string, string | undefined> = {};
const KEYS = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID_DEFAULT",
  "ELEVENLABS_TTS_MODEL",
];

beforeEach(() => {
  for (const key of KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("voice/model resolution", () => {
  it("falls back to the premade voice and pinned model without env", () => {
    expect(castVoiceId()).toBe(FALLBACK_VOICE_ID);
    expect(castTtsModel()).toBe(DEFAULT_TTS_MODEL);
  });

  it("env overrides win", () => {
    process.env.ELEVENLABS_VOICE_ID_DEFAULT = "voice-x";
    process.env.ELEVENLABS_TTS_MODEL = "model-x";
    expect(castVoiceId()).toBe("voice-x");
    expect(castTtsModel()).toBe("model-x");
  });
});

describe("synthesizeSpeech", () => {
  it("refuses to call out without an API key", async () => {
    await expect(
      synthesizeSpeech({ text: "hi", voiceId: "v", modelId: "m" }),
    ).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });

  it("posts the pinned CBR output format and returns bytes", async () => {
    const audio = new Uint8Array([1, 2, 3]).buffer;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => audio,
    })) as unknown as typeof fetch;

    const bytes = await synthesizeSpeech({
      text: "hello road",
      voiceId: "voice-1",
      modelId: "model-1",
      apiKey: "key-1",
      fetchImpl,
    });

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/text-to-speech/voice-1");
    expect(url).toContain(`output_format=${ELEVENLABS_OUTPUT_FORMAT}`);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(
      "key-1",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      text: "hello road",
      model_id: "model-1",
    });
  });

  it("surfaces the HTTP status and body on failure", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    })) as unknown as typeof fetch;

    await expect(
      synthesizeSpeech({
        text: "hi",
        voiceId: "v",
        modelId: "m",
        apiKey: "k",
        fetchImpl,
      }),
    ).rejects.toThrow(/429.*rate limited/s);
  });
});

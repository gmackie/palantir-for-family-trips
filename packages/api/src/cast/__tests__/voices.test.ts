import { describe, expect, it, vi } from "vitest";

import {
  FALLBACK_VOICE_ID,
  listCastVoices,
  resolveTripVoiceId,
} from "../elevenlabs";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const CATALOGUE = {
  voices: [
    {
      voice_id: "v_george",
      name: "George",
      labels: { accent: "British", age: "middle aged", junk: 12 },
      preview_url: "https://example.invalid/george.mp3",
    },
    { voice_id: "v_ana", name: "Ana", labels: null, preview_url: null },
    // Malformed rows the catalogue should simply drop.
    { voice_id: "", name: "Nameless" },
    { name: "No id" },
  ],
};

describe("listCastVoices", () => {
  it("maps the catalogue and drops unusable rows", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CATALOGUE));
    const voices = await listCastVoices({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(voices.map((v) => v.voiceId)).toEqual(["v_george", "v_ana"]);
    expect(voices[0]).toMatchObject({
      name: "George",
      previewUrl: "https://example.invalid/george.mp3",
    });
    // Non-string label values are dropped rather than rendered as "[object]".
    expect(voices[0]?.labels).toEqual({
      accent: "British",
      age: "middle aged",
    });
    expect(voices[1]?.labels).toEqual({});
  });

  it("fails soft — a voice outage must not break the cast page", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(
      listCastVoices({
        apiKey: "k",
        fetchImpl: throwing as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);

    const rejected = vi.fn(async () => jsonResponse({}, false, 401));
    await expect(
      listCastVoices({
        apiKey: "k",
        fetchImpl: rejected as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
  });

  it("returns nothing without a key, rather than calling the API", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CATALOGUE));
    await expect(
      listCastVoices({
        apiKey: "",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolveTripVoiceId", () => {
  it("prefers the trip's own choice", () => {
    expect(resolveTripVoiceId("v_ana")).toBe("v_ana");
  });

  it("treats null, empty, and whitespace as unset", () => {
    // A blank stored value must never reach the API as an empty voice id.
    for (const unset of [null, undefined, "", "   "]) {
      expect(resolveTripVoiceId(unset)).toBe(
        process.env.ELEVENLABS_VOICE_ID_DEFAULT ?? FALLBACK_VOICE_ID,
      );
    }
  });

  it("trims a stored id", () => {
    expect(resolveTripVoiceId("  v_ana  ")).toBe("v_ana");
  });
});

/**
 * Minimal fetch-based ElevenLabs TTS client. No SDK dependency — the worker
 * only needs one endpoint, and the REST surface is stable.
 *
 * Output format is pinned to 128 kbps CBR 44.1 kHz MP3 (eng-review Issue 9.6):
 * every segment must share the exact same encoding so the streaming concat can
 * splice frames without re-encoding.
 */

export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
export const DEFAULT_TTS_MODEL = "eleven_turbo_v2_5";
/** ElevenLabs premade "George" — warm narration voice. Overridden by env. */
export const FALLBACK_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

export function castVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID_DEFAULT ?? FALLBACK_VOICE_ID;
}

export function castTtsModel(): string {
  return process.env.ELEVENLABS_TTS_MODEL ?? DEFAULT_TTS_MODEL;
}

export type SynthesizeSpeech = (params: {
  text: string;
  voiceId: string;
  modelId: string;
}) => Promise<Uint8Array>;

/** One hung socket must not pin the cron run into the stale-lease window. */
const TTS_REQUEST_TIMEOUT_MS = 90_000;

export async function synthesizeSpeech(params: {
  text: string;
  voiceId: string;
  modelId: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<Uint8Array> {
  const apiKey = params.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }
  const fetchImpl = params.fetchImpl ?? fetch;

  const response = await fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: params.text,
        model_id: params.modelId,
      }),
      signal: AbortSignal.timeout(params.timeoutMs ?? TTS_REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

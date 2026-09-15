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

  // Feature-detected: consumer packages typecheck this file against TS libs
  // without AbortSignal.timeout (expo) or with skewed AbortSignal shapes
  // (trpc-cli/mcp-server); workers + node both have it at runtime.
  const timeoutSignal = (
    AbortSignal as unknown as { timeout?: (ms: number) => unknown }
  ).timeout?.(params.timeoutMs ?? TTS_REQUEST_TIMEOUT_MS);

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
      ...(timeoutSignal ? { signal: timeoutSignal as never } : {}),
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

/** A narrator the trip can choose. */
export interface CastVoice {
  voiceId: string;
  name: string;
  /** Free-text descriptors from the catalogue (accent, age, use case). */
  labels: Record<string, string>;
  previewUrl: string | null;
}

const VOICES_REQUEST_TIMEOUT_MS = 15_000;

/**
 * The voices this API key can use. Read-only and cheap, but it is a network
 * call on someone's trip page, so it fails soft: an empty list renders as
 * "voice picking is unavailable", never as a broken page.
 */
export async function listCastVoices(params?: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CastVoice[]> {
  const apiKey = params?.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return [];
  const fetchImpl = params?.fetchImpl ?? fetch;

  const timeoutSignal = (
    AbortSignal as unknown as { timeout?: (ms: number) => unknown }
  ).timeout?.(params?.timeoutMs ?? VOICES_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      ...(timeoutSignal ? { signal: timeoutSignal as never } : {}),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  const body = (await response.json().catch(() => null)) as {
    voices?: Array<{
      voice_id?: unknown;
      name?: unknown;
      labels?: unknown;
      preview_url?: unknown;
    }>;
  } | null;

  return (body?.voices ?? [])
    .map((voice) => ({
      voiceId: typeof voice.voice_id === "string" ? voice.voice_id : "",
      name: typeof voice.name === "string" ? voice.name : "",
      labels:
        voice.labels && typeof voice.labels === "object"
          ? Object.fromEntries(
              Object.entries(voice.labels as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v as string]),
            )
          : {},
      previewUrl:
        typeof voice.preview_url === "string" ? voice.preview_url : null,
    }))
    .filter((voice) => voice.voiceId.length > 0 && voice.name.length > 0);
}

/**
 * The narrator for one trip: its own choice, else the deployment default.
 * A blank or whitespace-only stored value is treated as unset rather than
 * being sent to the API as an empty voice id.
 */
export function resolveTripVoiceId(
  tripVoiceId: string | null | undefined,
): string {
  const trimmed = tripVoiceId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : castVoiceId();
}

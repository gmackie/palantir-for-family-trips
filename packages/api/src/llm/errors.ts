import { NoLlmProviderError } from "./structured";

/**
 * Classify a script-generation failure as terminal or worth retrying.
 *
 * The pump retries a failed job up to `CAST_MAX_ATTEMPTS` times, which is right
 * for a flaky connection on van internet and wrong for a missing key or an
 * empty billing account: those fail identically on every attempt, and the
 * user's only feedback is a raw vendor blob 20 minutes later. Configuration and
 * billing failures fail fast with a message that says what to fix.
 *
 * Returns null when the failure isn't recognizably a provider problem, leaving
 * the normal retry path alone.
 */

export type LlmFailure = {
  /** Fail the job now instead of burning the remaining attempts. */
  terminal: boolean;
  /** Operator-readable, safe to show in the console. */
  message: string;
};

/** Phrases that mean "this account cannot pay", not "you're going too fast". */
const BILLING_MARKERS = [
  "prepayment credits",
  "credit balance",
  "billing",
  "insufficient_quota",
  "exceeded your current quota",
  "purchase",
  "payment",
];

const KEY_MARKERS = [
  "api key not valid",
  "api_key_invalid",
  "api_key_service_blocked",
  "invalid x-api-key",
  "authentication",
  "permission",
];

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  // Both SDKs stringify the upstream status into the message when they wrap a
  // fetch failure, e.g. "… : [429 Too Many Requests] Your prepayment credits…".
  const match = /\[(\d{3})\s/.exec(messageOf(error));
  return match ? Number(match[1]) : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function classifyLlmError(error: unknown): LlmFailure | null {
  if (error instanceof NoLlmProviderError) {
    return {
      terminal: true,
      message:
        "No script model is configured for this deployment. Set ANTHROPIC_API_KEY or GEMINI_API_KEY on the worker.",
    };
  }

  const raw = messageOf(error);
  const lowered = raw.toLowerCase();
  const status = statusOf(error);

  if (status === 401 || status === 403 || hasAny(lowered, KEY_MARKERS)) {
    return {
      terminal: true,
      message:
        "The script model rejected this deployment's API key. Check that the key is valid and permitted to call the model API.",
    };
  }

  if (status === 429 && hasAny(lowered, BILLING_MARKERS)) {
    return {
      terminal: true,
      message:
        "The script model account is out of credit. Top up billing for the configured provider, then retry.",
    };
  }

  if (status === 404) {
    return {
      terminal: true,
      message:
        "The configured script model does not exist for this key. Check CAST_SCRIPT_MODEL / CAST_SCRIPT_MODEL_GEMINI.",
    };
  }

  // A plain rate limit, a 5xx, or a dropped connection: worth another attempt.
  return null;
}

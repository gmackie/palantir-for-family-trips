import type { VanTelemetryProvider } from "./provider";
import type { VanSystemReading } from "./types";

/**
 * Real telemetry provider: calls driftport's tRPC HTTP API to read the latest
 * van-system snapshot for a rig.
 *
 * ── Assumed driftport tRPC HTTP contract ────────────────────────────────────
 * Verified against driftport's repo (read-only, no changes made there):
 *   - Route handler: `apps/nextjs/src/app/api/trpc/[trpc]/route.ts` mounts
 *     `fetchRequestHandler` at endpoint `/api/trpc` and exports it as GET + POST.
 *   - Procedure: `system.dashboard` is a `rigProcedure` *query* whose input is
 *     `{ rigId: string (uuid) }` (`packages/api/src/middleware/rig-access.ts`).
 *     It returns an array of `{ rigId, deviceId, system, metric, value, unit,
 *     readAt }` (`packages/api/src/router/system.ts`).
 *   - Transformer: superjson (`packages/api/src/trpc.ts`). So query input is
 *     superjson-wrapped and the response data is under `result.data.json`.
 *   - Auth: `Authorization: Bearer gmk_<key>` resolves an API-key user with an
 *     active `rigMembership` for the rig (`packages/api/src/trpc.ts`).
 *
 * Because driftport's `AppRouter` type is NOT importable cross-repo (separate
 * package), we issue a raw `fetch` rather than using `@trpc/client`.
 *
 * Single-procedure (non-batch) tRPC v11 GET query encoding:
 *   GET {API_URL}/api/trpc/system.dashboard?input=<urlencoded superjson input>
 * where the input is `{"json":{"rigId":"<rigId>"}}`.
 *
 * Fail-safe: any network / non-2xx / parse / shape error throws. The router
 * wraps the call in try/catch and returns `null` so Driving Mode never crashes.
 */
export class DriftportTelemetryProvider implements VanTelemetryProvider {
  async getSnapshot(rigId: string): Promise<VanSystemReading[]> {
    const baseUrl = process.env.DRIFTPORT_API_URL;
    const apiKey = process.env.DRIFTPORT_API_KEY;

    if (!baseUrl) {
      throw new Error("DRIFTPORT_API_URL is not configured");
    }
    if (!apiKey) {
      throw new Error("DRIFTPORT_API_KEY is not configured");
    }

    // superjson-wrapped query input for tRPC's GET transport.
    const input = encodeURIComponent(JSON.stringify({ json: { rigId } }));
    const url = `${baseUrl.replace(/\/$/, "")}/api/trpc/system.dashboard?input=${input}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-trpc-source": "sortey-van-telemetry",
      },
    });

    if (!res.ok) {
      throw new Error(
        `driftport system.dashboard failed: ${res.status} ${res.statusText}`,
      );
    }

    const body = (await res.json()) as unknown;

    // superjson response envelope: { result: { data: { json: <payload> } } }.
    const rows = extractRows(body);

    return rows.map((row) => ({
      system: String(row.system),
      metric: String(row.metric),
      value: Number(row.value),
      unit: String(row.unit),
      readAt:
        row.readAt instanceof Date
          ? row.readAt.toISOString()
          : String(row.readAt),
    }));
  }
}

type DriftportRow = {
  system: unknown;
  metric: unknown;
  value: unknown;
  unit: unknown;
  readAt: unknown;
};

/**
 * Pull the readings array out of the tRPC/superjson response envelope. Tolerant
 * of both the superjson-wrapped (`result.data.json`) and plain (`result.data`)
 * shapes; throws if the payload is not an array.
 */
function extractRows(body: unknown): DriftportRow[] {
  const data = (body as { result?: { data?: unknown } } | null)?.result?.data;
  const payload =
    data && typeof data === "object" && "json" in data
      ? (data as { json: unknown }).json
      : data;

  if (!Array.isArray(payload)) {
    throw new Error("driftport system.dashboard returned an unexpected shape");
  }

  return payload as DriftportRow[];
}

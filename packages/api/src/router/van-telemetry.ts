import { desc, eq } from "@sortey/db";
import { fuelLogs, vanProfiles } from "@sortey/db/schema";
import { isEnabled } from "@sortey/flags";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import type { VanTelemetryProvider } from "../van-telemetry/provider";
import { resolveTelemetryProvider } from "../van-telemetry/resolve";
import type { VanSystemReading } from "../van-telemetry/types";

/**
 * Resolves the driftport rig linked to a trip. The van profile is associated to
 * a trip the same way Driving Mode's `drivingSummary` does it: via the trip's
 * most recent fuel log (`fuel_log.vanProfileId`). Returns `driftportRigId`, or
 * `null` if the trip has no fuel log, the log has no van profile, or the profile
 * is not linked to a rig.
 */
export interface VanTelemetryStore {
  findDriftportRigId(input: { tripId: string }): Promise<string | null>;
}

// biome-ignore lint/suspicious/noExplicitAny: drizzle client, mirrors other router stores
export function createVanTelemetryStore(db: any): VanTelemetryStore {
  return {
    findDriftportRigId: async ({ tripId }) => {
      const [fuelRow] = (await db
        .select({ vanProfileId: fuelLogs.vanProfileId })
        .from(fuelLogs)
        .where(eq(fuelLogs.tripId, tripId))
        .orderBy(desc(fuelLogs.loggedAt))
        .limit(1)) as Array<{ vanProfileId: string | null }>;

      if (!fuelRow?.vanProfileId) {
        return null;
      }

      const [vanRow] = (await db
        .select({ driftportRigId: vanProfiles.driftportRigId })
        .from(vanProfiles)
        .where(eq(vanProfiles.id, fuelRow.vanProfileId))
        .limit(1)) as Array<{ driftportRigId: string | null }>;

      return vanRow?.driftportRigId ?? null;
    },
  };
}

/**
 * Pure, testable core of `vanTelemetry.getSnapshot`.
 *
 * Fail-safe contract — returns `null` (never throws) when:
 *   - the `driftportTelemetryPreview` flag is off for the user,
 *   - the trip's van is not linked to a driftport rig, or
 *   - the telemetry provider fails (network/parse). Driving Mode must never
 *     crash, so the card simply hides.
 */
export async function getVanTelemetrySnapshot(args: {
  store: VanTelemetryStore;
  provider: VanTelemetryProvider;
  userId: string;
  tripId: string;
}): Promise<VanSystemReading[] | null> {
  const { store, provider, userId, tripId } = args;

  if (!isEnabled("driftportTelemetryPreview", { userId })) {
    return null;
  }

  const rigId = await store.findDriftportRigId({ tripId });
  if (!rigId) {
    return null;
  }

  try {
    return await provider.getSnapshot(rigId);
  } catch {
    // Telemetry is best-effort; swallow and hide the card rather than crash.
    return null;
  }
}

/**
 * Canonical driftport deep link for a rig. `https://driftport.io/rigs/<rigId>`
 * is a universal link: it opens the driftport mobile app when installed and
 * falls back to the driftport web dashboard otherwise. `DRIFTPORT_WEB_URL`
 * overrides the base for staging setups; it is distinct from
 * `DRIFTPORT_API_URL` (the server-to-server telemetry endpoint).
 */
export function buildDriftportRigUrl(
  rigId: string,
  baseUrl = process.env.DRIFTPORT_WEB_URL ?? "https://driftport.io",
): string {
  return `${baseUrl.replace(/\/$/, "")}/rigs/${rigId}`;
}

export interface VanRigLink {
  rigId: string;
  url: string;
}

/**
 * Pure, testable core of `vanTelemetry.getRigLink`. Same fail-safe contract
 * and flag gate as the snapshot: `null` hides the link entirely.
 */
export async function getVanRigLink(args: {
  store: VanTelemetryStore;
  userId: string;
  tripId: string;
  baseUrl?: string;
}): Promise<VanRigLink | null> {
  const { store, userId, tripId, baseUrl } = args;

  if (!isEnabled("driftportTelemetryPreview", { userId })) {
    return null;
  }

  const rigId = await store.findDriftportRigId({ tripId });
  if (!rigId) {
    return null;
  }

  return { rigId, url: buildDriftportRigUrl(rigId, baseUrl) };
}

export const vanTelemetryRouter = {
  getSnapshot: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) =>
      getVanTelemetrySnapshot({
        store: createVanTelemetryStore(ctx.db),
        provider: resolveTelemetryProvider(),
        userId: ctx.session.user.id,
        tripId: ctx.tripId,
      }),
    ),
  getRigLink: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) =>
      getVanRigLink({
        store: createVanTelemetryStore(ctx.db),
        userId: ctx.session.user.id,
        tripId: ctx.tripId,
      }),
    ),
} satisfies TRPCRouterRecord;

import { and, desc, eq, inArray } from "@sortey/db";
import { getR2Bucket } from "@sortey/db/runtime";
import {
  CAST_JOB_ACTIVE_STATUSES,
  type CastJobStatus,
  castEpisodeJobs,
  castEpisodes,
  trips,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { probeCastDriveLeg, resolveCastTargetDate } from "../cast/context";
import { type CastR2Bucket, deleteCheckpoints } from "../cast/tts";

/**
 * Corridor Cast — night-before episode generation for tomorrow's drive.
 *
 * The mutation only ENQUEUES; the worker cron pump does all paid work. The
 * script read gate (awaiting_approval → approved) is the one human step
 * between the evening tap and TTS spend.
 */

const activeStatuses = [...CAST_JOB_ACTIVE_STATUSES] as CastJobStatus[];

const jobSummary = {
  id: castEpisodeJobs.id,
  targetDate: castEpisodeJobs.targetDate,
  durationMinutes: castEpisodeJobs.durationMinutes,
  status: castEpisodeJobs.status,
  error: castEpisodeJobs.error,
  attemptCount: castEpisodeJobs.attemptCount,
  llmInputTokens: castEpisodeJobs.llmInputTokens,
  llmOutputTokens: castEpisodeJobs.llmOutputTokens,
  ttsCharacters: castEpisodeJobs.ttsCharacters,
  createdAt: castEpisodeJobs.createdAt,
  updatedAt: castEpisodeJobs.updatedAt,
};

export const castRouter = {
  /**
   * Everything the Generate button needs: tomorrow's resolved target date IN
   * THE TRIP'S TZ (rendered on the button so a UTC-defaulted trip row is
   * visible at tap time — eng-review Issue 9.8), and whether that day has a
   * drive leg at all.
   */
  tonight: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const [trip] = (await ctx.db
        .select({ tz: trips.tz })
        .from(trips)
        .where(eq(trips.id, ctx.tripId))
        .limit(1)) as Array<{ tz: string }>;
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });

      const targetDate = resolveCastTargetDate(trip.tz, new Date());
      const probe = await probeCastDriveLeg(ctx.db, {
        tripId: ctx.tripId,
        targetDate,
      });
      return { targetDate, tz: trip.tz, ...probe };
    }),

  /** Enqueue tomorrow's episode. Idempotent: a second tap returns the active job. */
  generate: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        durationMinutes: z.union([z.literal(15), z.literal(30)]),
        /** Defaults to tomorrow in the trip's tz. */
        targetDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [trip] = (await ctx.db
        .select({ tz: trips.tz })
        .from(trips)
        .where(eq(trips.id, ctx.tripId))
        .limit(1)) as Array<{ tz: string }>;
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });

      const targetDate =
        input.targetDate ?? resolveCastTargetDate(trip.tz, new Date());

      // Server-side no-leg rejection (test plan: direct API call on a no-leg
      // day must fail even though the button is hidden).
      const probe = await probeCastDriveLeg(ctx.db, {
        tripId: ctx.tripId,
        targetDate,
      });
      if (!probe.hasDriveLeg) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No drive leg on ${targetDate} — nothing to narrate.`,
        });
      }

      // A replaced FAILED job's parked segment audio is orphaned once a new
      // job (possibly a new script) takes the slot — clean it up now.
      await cleanupFailedJobCheckpoints(ctx.db, ctx.tripId, targetDate);

      // Server-side dedup (eng-review Issue 9.7): the partial unique index on
      // (trip_id, target_date) WHERE status is active makes the double-tap a
      // no-op; ON CONFLICT DO NOTHING + re-select returns the winner.
      const inserted = (await ctx.db
        .insert(castEpisodeJobs)
        .values({
          tripId: ctx.tripId,
          createdByUserId: ctx.session.user.id,
          targetDate,
          durationMinutes: input.durationMinutes,
        })
        .onConflictDoNothing()
        .returning({ id: castEpisodeJobs.id })) as Array<{ id: string }>;

      if (inserted.length > 0) {
        return { jobId: inserted[0]!.id, deduplicated: false, targetDate };
      }

      const [existing] = (await ctx.db
        .select({ id: castEpisodeJobs.id })
        .from(castEpisodeJobs)
        .where(
          and(
            eq(castEpisodeJobs.tripId, ctx.tripId),
            eq(castEpisodeJobs.targetDate, targetDate),
            inArray(castEpisodeJobs.status, activeStatuses),
          ),
        )
        .limit(1)) as Array<{ id: string }>;

      if (!existing) {
        // Conflict raced with the active job completing — retry the insert once.
        const retried = (await ctx.db
          .insert(castEpisodeJobs)
          .values({
            tripId: ctx.tripId,
            createdByUserId: ctx.session.user.id,
            targetDate,
            durationMinutes: input.durationMinutes,
          })
          .onConflictDoNothing()
          .returning({ id: castEpisodeJobs.id })) as Array<{ id: string }>;
        if (retried.length > 0) {
          return { jobId: retried[0]!.id, deduplicated: false, targetDate };
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another generation for this day is already in flight.",
        });
      }

      return { jobId: existing.id, deduplicated: true, targetDate };
    }),

  /** Poll: jobs + episodes for the trip, newest first. */
  status: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const jobs = await ctx.db
        .select(jobSummary)
        .from(castEpisodeJobs)
        .where(eq(castEpisodeJobs.tripId, ctx.tripId))
        .orderBy(desc(castEpisodeJobs.createdAt))
        .limit(10);

      const episodes = await ctx.db
        .select({
          id: castEpisodes.id,
          jobId: castEpisodes.jobId,
          targetDate: castEpisodes.targetDate,
          durationMinutes: castEpisodes.durationMinutes,
          title: castEpisodes.title,
          sizeBytes: castEpisodes.sizeBytes,
          durationSeconds: castEpisodes.durationSeconds,
          segmentsJson: castEpisodes.segmentsJson,
          createdAt: castEpisodes.createdAt,
        })
        .from(castEpisodes)
        .where(eq(castEpisodes.tripId, ctx.tripId))
        .orderBy(desc(castEpisodes.createdAt))
        .limit(10);

      return { jobs, episodes };
    }),

  /** The read gate: fetch the script for review before any TTS spend. */
  script: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        jobId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [job] = (await ctx.db
        .select({
          id: castEpisodeJobs.id,
          status: castEpisodeJobs.status,
          scriptJson: castEpisodeJobs.scriptJson,
          targetDate: castEpisodeJobs.targetDate,
          durationMinutes: castEpisodeJobs.durationMinutes,
        })
        .from(castEpisodeJobs)
        .where(
          and(
            eq(castEpisodeJobs.id, input.jobId),
            eq(castEpisodeJobs.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{
        id: string;
        status: CastJobStatus;
        scriptJson: unknown;
        targetDate: string;
        durationMinutes: number;
      }>;
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      return job;
    }),

  /** Approve the read script — unlocks TTS on the next pump run. */
  approveScript: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        jobId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = (await ctx.db
        .update(castEpisodeJobs)
        .set({ status: "approved" as CastJobStatus })
        .where(
          and(
            eq(castEpisodeJobs.id, input.jobId),
            eq(castEpisodeJobs.tripId, ctx.tripId),
            eq(castEpisodeJobs.status, "awaiting_approval" as CastJobStatus),
          ),
        )
        .returning({ id: castEpisodeJobs.id })) as Array<{ id: string }>;
      if (updated.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Script is not awaiting approval.",
        });
      }
      return { jobId: input.jobId };
    }),

  /**
   * Retry a failed job. RESUMES, never restarts: an existing script goes
   * straight back to synthesis, where per-segment R2 checkpoints skip every
   * already-paid segment.
   */
  retry: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        jobId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [job] = (await ctx.db
        .select({
          id: castEpisodeJobs.id,
          status: castEpisodeJobs.status,
          scriptJson: castEpisodeJobs.scriptJson,
        })
        .from(castEpisodeJobs)
        .where(
          and(
            eq(castEpisodeJobs.id, input.jobId),
            eq(castEpisodeJobs.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{
        id: string;
        status: CastJobStatus;
        scriptJson: unknown;
      }>;
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      if (job.status !== "failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only a failed generation can be retried.",
        });
      }

      const nextStatus: CastJobStatus = job.scriptJson
        ? "synthesizing"
        : "pending";
      await ctx.db
        .update(castEpisodeJobs)
        .set({
          status: nextStatus,
          error: null,
          attemptCount: 0,
          claimedAt: null,
        })
        .where(eq(castEpisodeJobs.id, input.jobId));
      return { jobId: input.jobId, status: nextStatus };
    }),
} satisfies TRPCRouterRecord;

async function cleanupFailedJobCheckpoints(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  targetDate: string,
): Promise<void> {
  const failed = (await db
    .select({
      id: castEpisodeJobs.id,
      checkpointsJson: castEpisodeJobs.checkpointsJson,
    })
    .from(castEpisodeJobs)
    .where(
      and(
        eq(castEpisodeJobs.tripId, tripId),
        eq(castEpisodeJobs.targetDate, targetDate),
        eq(castEpisodeJobs.status, "failed" as CastJobStatus),
      ),
    )) as Array<{
    id: string;
    checkpointsJson: Array<{
      segmentKey: string;
      contentHash: string;
      r2Key: string;
      sizeBytes: number;
      durationSeconds: number;
    }> | null;
  }>;

  const r2 = getR2Bucket() as CastR2Bucket | null;
  for (const job of failed) {
    if (!job.checkpointsJson?.length) continue;
    if (r2) await deleteCheckpoints(r2, job.checkpointsJson);
    await db
      .update(castEpisodeJobs)
      .set({ checkpointsJson: [] })
      .where(eq(castEpisodeJobs.id, job.id));
  }
}

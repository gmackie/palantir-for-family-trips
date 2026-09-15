import { and, desc, eq, gte, inArray, sql } from "@sortey/db";
import { getR2Bucket } from "@sortey/db/runtime";
import {
  CAST_JOB_ACTIVE_STATUSES,
  type CastGroundingFact,
  type CastGroundingSource,
  type CastJobStatus,
  type CastScript,
  type CastScriptEval,
  castEpisodeJobs,
  castEpisodes,
  castGroundingBriefs,
  tripSegments,
  trips,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import {
  assertWithinCastBudget,
  CastBudgetExceededError,
  castBudgetLimits,
  monthStart,
  remainingCastBudget,
} from "../cast/budget";
import {
  castTodayInTz,
  probeCastDriveLeg,
  resolveCastTargetDate,
} from "../cast/context";
import {
  type CastVoice,
  listCastVoices,
  resolveTripVoiceId,
} from "../cast/elevenlabs";
import { CAST_EXPIRED_ERROR } from "../cast/job";
import { type CastR2Bucket, deleteCheckpoints } from "../cast/tts";
import { NoLlmProviderError, resolveLlmProvider } from "../llm/structured";
import { assertRateLimit } from "../rate-limit";

/** LLM spend guard: script generation starts without any approval gate. */
const CAST_GENERATE_RATE_LIMIT = {
  limit: 6,
  windowMs: 60 * 60 * 1000,
  message: "Too many episode generations. Wait a bit and try again.",
} as const;

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

/** This calendar month's metered Corridor Cast usage for one trip. */
async function loadCastMonthUsage(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  tripId: string,
  now: Date = new Date(),
): Promise<{
  llmOutputTokens: number;
  ttsCharacters: number;
  episodes: number;
}> {
  const [row] = (await db
    .select({
      llmOutputTokens: sql<number>`coalesce(sum(${castEpisodeJobs.llmOutputTokens}), 0)::int`,
      ttsCharacters: sql<number>`coalesce(sum(${castEpisodeJobs.ttsCharacters}), 0)::int`,
      episodes: sql<number>`count(*)::int`,
    })
    .from(castEpisodeJobs)
    .where(
      and(
        eq(castEpisodeJobs.tripId, tripId),
        gte(castEpisodeJobs.createdAt, monthStart(now)),
      ),
    )) as Array<{
    llmOutputTokens: number;
    ttsCharacters: number;
    episodes: number;
  }>;
  return {
    llmOutputTokens: Number(row?.llmOutputTokens ?? 0),
    ttsCharacters: Number(row?.ttsCharacters ?? 0),
    episodes: Number(row?.episodes ?? 0),
  };
}

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
      // Surfaced so the console can warn before the ceiling refuses a tap.
      const usage = await loadCastMonthUsage(ctx.db, ctx.tripId);
      return {
        targetDate,
        tz: trip.tz,
        ...probe,
        budget: {
          usage,
          limits: castBudgetLimits(),
          remaining: remainingCastBudget(usage),
        },
      };
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
          .refine((date) => {
            // Regex-shaped but calendar-invalid dates (2026-02-31) must fail
            // here, not as an opaque Postgres datestyle 500.
            const [y, m, d] = date.split("-").map(Number) as [
              number,
              number,
              number,
            ];
            const parsed = new Date(Date.UTC(y, m - 1, d));
            return parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
          }, "Not a real calendar date")
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

      assertRateLimit({
        key: `cast:generate:${ctx.session.user.id}`,
        ...CAST_GENERATE_RATE_LIMIT,
      });

      // Preflight: an unkeyed deployment would enqueue a job that can only
      // fail. Say so now instead of surfacing it 5 minutes later as a job
      // error the traveller has to go read.
      try {
        resolveLlmProvider();
      } catch (error) {
        if (error instanceof NoLlmProviderError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "No script model is configured for this deployment, so an episode cannot be written.",
          });
        }
        throw error;
      }

      // Spend ceiling, checked before either the model or the voice bill
      // starts. Refusing afterwards is just an expensive error message.
      try {
        assertWithinCastBudget(await loadCastMonthUsage(ctx.db, ctx.tripId));
      } catch (error) {
        if (error instanceof CastBudgetExceededError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        }
        throw error;
      }

      const targetDate =
        input.targetDate ?? resolveCastTargetDate(trip.tz, new Date());

      // A past drive day would only generate a script for the expiry sweep
      // to kill — after the LLM spend. Refuse up front.
      if (targetDate < castTodayInTz(trip.tz, new Date())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${targetDate} has already passed in ${trip.tz}.`,
        });
      }

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

      // Replacing a FAILED job supersedes it: its parked segment audio is
      // orphaned (a new job may write a new script) and its Retry must stop
      // resuming. Mark it superseded and clean the temp objects now.
      await supersedeFailedJobs(ctx.db, ctx.tripId, targetDate);

      const tryInsertJob = async (): Promise<string | null> => {
        const rows = (await ctx.db
          .insert(castEpisodeJobs)
          .values({
            tripId: ctx.tripId,
            createdByUserId: ctx.session.user.id,
            targetDate,
            durationMinutes: input.durationMinutes,
          })
          .onConflictDoNothing()
          .returning({ id: castEpisodeJobs.id })) as Array<{ id: string }>;
        return rows[0]?.id ?? null;
      };

      // Server-side dedup (eng-review Issue 9.7): the partial unique index on
      // (trip_id, target_date) WHERE status is active makes the double-tap a
      // no-op; ON CONFLICT DO NOTHING + re-select returns the winner.
      const insertedId = await tryInsertJob();
      if (insertedId) {
        return { jobId: insertedId, deduplicated: false, targetDate };
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
        const retriedId = await tryInsertJob();
        if (retriedId) {
          return { jobId: retriedId, deduplicated: false, targetDate };
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
          evalJson: castEpisodeJobs.evalJson,
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
        scriptJson: CastScript | null;
        targetDate: string;
        durationMinutes: number;
        evalJson: CastScriptEval | null;
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
   * Narrator choices for this deployment's ElevenLabs key, plus the trip's
   * current pick. Fails soft to an empty catalogue — a voice API outage must
   * not break the cast page.
   */
  voices: tripProcedure()
    .input(
      z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1) }),
    )
    .query(async ({ ctx }) => {
      const [trip] = (await ctx.db
        .select({ castVoiceId: trips.castVoiceId })
        .from(trips)
        .where(eq(trips.id, ctx.tripId))
        .limit(1)) as Array<{ castVoiceId: string | null }>;
      if (!trip) throw new TRPCError({ code: "NOT_FOUND" });

      const voices: CastVoice[] = await listCastVoices();
      return {
        voices,
        /** What the next episode will actually use. */
        effectiveVoiceId: resolveTripVoiceId(trip.castVoiceId),
        /** Null means "follow the deployment default". */
        tripVoiceId: trip.castVoiceId,
      };
    }),

  /** Choose the trip's narrator. Null restores the deployment default. */
  setVoice: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        voiceId: z.string().trim().min(1).max(64).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Only a voice this key can actually speak with — an unusable id would
      // otherwise surface as a mid-synthesis TTS failure after the read gate.
      if (input.voiceId) {
        const voices = await listCastVoices();
        if (
          voices.length > 0 &&
          !voices.some((v) => v.voiceId === input.voiceId)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That voice is not available to this deployment.",
          });
        }
      }

      await ctx.db
        .update(trips)
        .set({ castVoiceId: input.voiceId })
        .where(eq(trips.id, ctx.tripId));

      return { voiceId: resolveTripVoiceId(input.voiceId) };
    }),

  /**
   * Push a provenance-tracked research brief for a drive segment (produced by
   * an OODA research thread — the cast-grounding bridge parses the export).
   * Latest brief per segment wins; the script generator's tier-1.5 rules let
   * verified facts be narrated with attribution.
   */
  uploadGroundingBrief: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        segmentId: z.string().min(1),
        title: z.string().min(1).max(300),
        facts: z
          .array(
            z.object({
              title: z.string().min(1).max(300),
              text: z.string().min(1).max(4000),
              verified: z.boolean(),
              sourceIndexes: z.array(z.number().int()).max(20),
            }),
          )
          .min(1)
          .max(80),
        sources: z
          .array(
            z.object({
              index: z.number().int(),
              capabilityId: z.string().max(200),
              url: z.string().max(1000).nullable(),
              retrievedAt: z.string().max(100).nullable(),
            }),
          )
          .max(80),
        provenance: z
          .object({
            oodaThreadId: z.string().max(200).optional(),
            exportedAt: z.string().max(100).optional(),
            workspaceCommit: z.string().max(100).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The segment must belong to this trip — a cross-trip segment id would
      // let a member attach research to someone else's corridor.
      const [segment] = (await ctx.db
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .where(
          and(
            eq(tripSegments.id, input.segmentId),
            eq(tripSegments.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{ id: string }>;
      if (!segment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Segment does not belong to this trip.",
        });
      }

      const inserted = (await ctx.db
        .insert(castGroundingBriefs)
        .values({
          tripId: ctx.tripId,
          segmentId: input.segmentId,
          title: input.title,
          facts: input.facts,
          sources: input.sources,
          provenance: input.provenance ?? null,
        })
        .returning({ id: castGroundingBriefs.id })) as Array<{ id: string }>;

      return {
        briefId: inserted[0]?.id,
        factCount: input.facts.length,
        verifiedCount: input.facts.filter((f) => f.verified).length,
      };
    }),

  /**
   * The trip's research: every segment's latest brief with its sources, plus
   * the drive legs that have none. The gaps matter as much as the briefs —
   * research is gathered out-of-band in an OODA thread, so knowing which
   * corridor is still unresearched is the whole prompt to go do it.
   */
  grounding: tripProcedure()
    .input(
      z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1) }),
    )
    .query(async ({ ctx }) => {
      const briefs = (await ctx.db
        .select({
          id: castGroundingBriefs.id,
          segmentId: castGroundingBriefs.segmentId,
          title: castGroundingBriefs.title,
          facts: castGroundingBriefs.facts,
          sources: castGroundingBriefs.sources,
          provenance: castGroundingBriefs.provenance,
          createdAt: castGroundingBriefs.createdAt,
          segmentName: tripSegments.name,
        })
        .from(castGroundingBriefs)
        .innerJoin(
          tripSegments,
          eq(tripSegments.id, castGroundingBriefs.segmentId),
        )
        .where(eq(castGroundingBriefs.tripId, ctx.tripId))
        .orderBy(desc(castGroundingBriefs.createdAt))) as Array<{
        id: string;
        segmentId: string;
        title: string;
        facts: CastGroundingFact[];
        sources: CastGroundingSource[];
        provenance: unknown;
        createdAt: Date;
        segmentName: string;
      }>;

      // Only the newest brief per segment is ever used by the context pack,
      // so superseded ones are noise here too.
      const latestBySegment = new Map<string, (typeof briefs)[number]>();
      for (const brief of briefs) {
        if (!latestBySegment.has(brief.segmentId)) {
          latestBySegment.set(brief.segmentId, brief);
        }
      }

      const segments = (await ctx.db
        .select({ id: tripSegments.id, name: tripSegments.name })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId))
        .orderBy(tripSegments.sortOrder)) as Array<{
        id: string;
        name: string;
      }>;

      return {
        briefs: [...latestBySegment.values()].map((brief) => ({
          id: brief.id,
          segmentId: brief.segmentId,
          segmentName: brief.segmentName,
          title: brief.title,
          createdAt: brief.createdAt,
          sources: brief.sources,
          facts: brief.facts,
          verifiedCount: brief.facts.filter((f) => f.verified).length,
        })),
        /** Segments with no research yet — the queue for the next thread. */
        gaps: segments
          .filter((segment) => !latestBySegment.has(segment.id))
          .map((segment) => ({ segmentId: segment.id, name: segment.name })),
      };
    }),

  /**
   * Drop one fact from a brief. A bad lead should be removable without
   * re-running the research thread — and removing it must not silently
   * renumber the others.
   */
  removeGroundingFact: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        briefId: z.string().min(1),
        factTitle: z.string().min(1).max(300),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [brief] = (await ctx.db
        .select({
          id: castGroundingBriefs.id,
          facts: castGroundingBriefs.facts,
        })
        .from(castGroundingBriefs)
        .where(
          and(
            eq(castGroundingBriefs.id, input.briefId),
            eq(castGroundingBriefs.tripId, ctx.tripId),
          ),
        )
        .limit(1)) as Array<{ id: string; facts: CastGroundingFact[] }>;
      if (!brief) throw new TRPCError({ code: "NOT_FOUND" });

      const remaining = brief.facts.filter((f) => f.title !== input.factTitle);
      if (remaining.length === brief.facts.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That fact is not in this brief.",
        });
      }

      await ctx.db
        .update(castGroundingBriefs)
        .set({ facts: remaining })
        .where(eq(castGroundingBriefs.id, brief.id));

      return { factCount: remaining.length };
    }),

  /** Discard a brief entirely — the next episode falls back to hedged color. */
  deleteGroundingBrief: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        briefId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = (await ctx.db
        .delete(castGroundingBriefs)
        .where(
          and(
            eq(castGroundingBriefs.id, input.briefId),
            eq(castGroundingBriefs.tripId, ctx.tripId),
          ),
        )
        .returning({ id: castGroundingBriefs.id })) as Array<{ id: string }>;
      if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { deleted: true };
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
          targetDate: castEpisodeJobs.targetDate,
          error: castEpisodeJobs.error,
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
        error: string | null;
      }>;
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      if (job.status !== "failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only a failed generation can be retried.",
        });
      }
      if (job.error === SUPERSEDED_ERROR) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This generation was replaced by a newer one for the same day — use Generate instead.",
        });
      }
      if (job.error === CAST_EXPIRED_ERROR) {
        // An expired script was NEVER approved — reviving it to synthesizing
        // would spend the full TTS bill around the read gate, for a drive day
        // that already passed.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This script expired unread and its drive day has passed — generate a new episode instead.",
        });
      }

      // Reviving this job must not collide with the one-active-job-per-day
      // index: a concurrent active job means the slot is taken (a raw retry
      // would surface as an opaque unique-violation 500).
      const [active] = (await ctx.db
        .select({ id: castEpisodeJobs.id })
        .from(castEpisodeJobs)
        .where(
          and(
            eq(castEpisodeJobs.tripId, ctx.tripId),
            eq(castEpisodeJobs.targetDate, job.targetDate),
            inArray(castEpisodeJobs.status, activeStatuses),
          ),
        )
        .limit(1)) as Array<{ id: string }>;
      if (active) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another generation for this day is already in flight.",
        });
      }

      const nextStatus: CastJobStatus = job.scriptJson
        ? "synthesizing"
        : "pending";
      // Status-guarded revive: if a concurrent generate superseded (or
      // anything else moved) this job between our select and now, the update
      // matches nothing and we refuse instead of corrupting live state. A
      // concurrent generate can also take the day slot between our active
      // check and this update — the partial unique index then raises 23505,
      // which must surface as CONFLICT, not an opaque 500.
      let revived: Array<{ id: string }>;
      try {
        revived = (await ctx.db
          .update(castEpisodeJobs)
          .set({
            status: nextStatus,
            error: null,
            attemptCount: 0,
            claimedAt: null,
          })
          .where(
            and(
              eq(castEpisodeJobs.id, input.jobId),
              eq(castEpisodeJobs.status, "failed" as CastJobStatus),
            ),
          )
          .returning({ id: castEpisodeJobs.id })) as Array<{ id: string }>;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another generation for this day is already in flight.",
          });
        }
        throw error;
      }
      if (revived.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This generation changed state — refresh and try again.",
        });
      }
      return { jobId: input.jobId, status: nextStatus };
    }),
} satisfies TRPCRouterRecord;

const SUPERSEDED_ERROR = "Superseded by a newer generation for this day.";

/** Postgres 23505 across driver wrappings (postgres-js nests under `cause`). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (
      typeof current === "object" &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * A failed job being replaced loses its resume rights: its paid temp audio is
 * deleted, so a later Retry would silently re-bill every segment while the UI
 * promises "paid segments are kept". Marking it superseded makes Retry refuse
 * instead.
 */
async function supersedeFailedJobs(
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
    // Mark BEFORE deleting, status-guarded: if a concurrent retry revived
    // this job between our select and now, the update matches nothing and we
    // must not touch its parked audio.
    const marked = (await db
      .update(castEpisodeJobs)
      .set({ checkpointsJson: [], error: SUPERSEDED_ERROR })
      .where(
        and(
          eq(castEpisodeJobs.id, job.id),
          eq(castEpisodeJobs.status, "failed" as CastJobStatus),
        ),
      )
      .returning({ id: castEpisodeJobs.id })) as Array<{ id: string }>;
    if (marked.length === 0) continue;
    if (job.checkpointsJson?.length && r2) {
      await deleteCheckpoints(r2, job.checkpointsJson);
    }
  }
}

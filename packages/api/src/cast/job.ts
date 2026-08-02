import { eq, sql } from "@sortey/db";
import { db as defaultDb } from "@sortey/db/client";
import {
  type CastCheckpoint,
  type CastJobStatus,
  type CastScript,
  castEpisodeJobs,
  castEpisodes,
} from "@sortey/db/schema";
import { classifyLlmError } from "../llm/errors";
import { concatMp3Segments, validateEpisodeAudio } from "./concat";
import { buildCastDayContext } from "./context";
import { castTtsModel, castVoiceId } from "./elevenlabs";
import { castScriptModel, generateCastScript } from "./script";
import {
  type CastR2Bucket,
  deleteCheckpoints,
  loadCheckpointAudio,
  synthesizeScriptSegments,
} from "./tts";

/**
 * Corridor Cast job pump — runs inside the worker's existing every-5-minutes
 * cron `scheduled()` handler (eng-review Issue 1; NOT Cloudflare Queues).
 *
 * Claim-with-lease: one job is claimed atomically (UPDATE … RETURNING with
 * SKIP LOCKED); `claimed_at` is the lease. A pump that finishes its time
 * budget mid-synthesis voluntarily checkpoints and releases the lease well
 * before the cron wall clock; a lease older than 20 minutes is stale (the
 * run died) and may be reclaimed. Reclaiming a stale lease increments
 * `attempt_count` in the claim itself so crash loops terminate.
 */

export const CAST_LEASE_STALE_MINUTES = 20;
export const CAST_MAX_ATTEMPTS = 4;
/** Marker error for unread scripts whose drive day passed — refused by retry. */
export const CAST_EXPIRED_ERROR =
  "Script expired unread — its drive day has passed.";
/** Leave lots of runway before wrangler's 15-minute cron wall clock. */
export const CAST_PUMP_TIME_BUDGET_MS = 4 * 60 * 1000;

type ClaimedJob = {
  id: string;
  tripId: string;
  targetDate: string;
  durationMinutes: number;
  status: CastJobStatus;
  attemptCount: number;
  scriptJson: CastScript | null;
  checkpointsJson: CastCheckpoint[] | null;
};

export type CastPumpDeps = {
  buildContext: typeof buildCastDayContext;
  generateScript: typeof generateCastScript;
  synthesizeSegments: typeof synthesizeScriptSegments;
  voiceId: () => string;
  ttsModel: () => string;
  scriptModel: () => string;
};

const defaultDeps: CastPumpDeps = {
  buildContext: buildCastDayContext,
  generateScript: generateCastScript,
  synthesizeSegments: synthesizeScriptSegments,
  voiceId: castVoiceId,
  ttsModel: castTtsModel,
  scriptModel: castScriptModel,
};

export type CastPumpResult = {
  claimed: boolean;
  jobId?: string;
  status?: CastJobStatus;
  released?: boolean;
};

export async function claimNextCastJob(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
): Promise<ClaimedJob | null> {
  const rows = (await db.execute(sql`
    UPDATE cast_episode_job
    SET claimed_at = now(),
        attempt_count = attempt_count
          + CASE WHEN claimed_at IS NOT NULL THEN 1 ELSE 0 END
    WHERE id = (
      SELECT id FROM cast_episode_job
      WHERE status IN ('pending', 'approved', 'synthesizing')
        AND (
          claimed_at IS NULL
          OR claimed_at < now() - make_interval(mins => ${CAST_LEASE_STALE_MINUTES})
        )
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      trip_id AS "tripId",
      target_date AS "targetDate",
      duration_minutes AS "durationMinutes",
      status,
      attempt_count AS "attemptCount",
      script_json AS "scriptJson",
      checkpoints_json AS "checkpointsJson"
  `)) as ClaimedJob[] | { rows?: ClaimedJob[] };

  const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return list[0] ?? null;
}

export async function runCastPump(params: {
  r2: CastR2Bucket | null;
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db?: any;
  timeBudgetMs?: number;
  now?: () => number;
  deps?: Partial<CastPumpDeps>;
}): Promise<CastPumpResult> {
  const db = params.db ?? defaultDb;
  const deps: CastPumpDeps = { ...defaultDeps, ...params.deps };
  const now = params.now ?? Date.now;
  const deadline = now() + (params.timeBudgetMs ?? CAST_PUMP_TIME_BUDGET_MS);

  // Expire unread scripts whose drive day has passed IN THE TRIP'S TZ (a UTC
  // comparison would expire a US trip's script mid-afternoon on the drive day
  // itself). awaiting_approval is never claimed below, so without this sweep
  // one skipped night would hold the per-day slot forever and dead-end every
  // future Generate. The error text is the retry-refusal marker: an expired
  // script was never approved, so retry must not funnel it into TTS spend.
  await db.execute(sql`
    UPDATE cast_episode_job AS j
    SET status = 'failed',
        error = ${CAST_EXPIRED_ERROR},
        claimed_at = NULL
    FROM trip AS t
    WHERE j.trip_id = t.id
      AND j.status = 'awaiting_approval'
      AND j.target_date < (now() AT TIME ZONE t.tz)::date
  `);

  const job = await claimNextCastJob(db);
  if (!job) {
    return { claimed: false };
  }

  if (job.attemptCount >= CAST_MAX_ATTEMPTS) {
    await db
      .update(castEpisodeJobs)
      .set({
        status: "failed" as CastJobStatus,
        error: `Gave up after ${job.attemptCount} attempts (stale-lease reclaims count — the run may be crashing mid-flight).`,
        claimedAt: null,
      })
      .where(eq(castEpisodeJobs.id, job.id));
    return { claimed: true, jobId: job.id, status: "failed" };
  }

  try {
    if (job.status === "pending") {
      const status = await runScriptStep(db, job, deps, deadline, now);
      return { claimed: true, jobId: job.id, status };
    }

    // approved → synthesizing is a pure status advance inside the same claim.
    if (job.status === "approved") {
      await db
        .update(castEpisodeJobs)
        .set({ status: "synthesizing" as CastJobStatus })
        .where(eq(castEpisodeJobs.id, job.id));
      job.status = "synthesizing";
    }

    const outcome = await runSynthesisStep({
      db,
      r2: params.r2,
      job,
      deps,
      deadline,
      now,
    });
    return { claimed: true, jobId: job.id, ...outcome };
  } catch (error) {
    // A missing key or an empty billing account fails identically on every
    // attempt, so retrying just delays the same answer by 20 minutes behind a
    // raw vendor blob. Fail those now, with a message that says what to fix.
    const providerFailure = classifyLlmError(error);
    const message =
      providerFailure?.message ??
      (error instanceof Error
        ? error.message
        : String(error ?? "unknown error"));
    const attempts = job.attemptCount + 1;
    const terminal = providerFailure?.terminal || attempts >= CAST_MAX_ATTEMPTS;
    await db
      .update(castEpisodeJobs)
      .set({
        status: terminal ? ("failed" as CastJobStatus) : job.status,
        error: message.slice(0, 2000),
        attemptCount: attempts,
        claimedAt: null,
      })
      .where(eq(castEpisodeJobs.id, job.id));
    // Checkpoints are intentionally KEPT on failure — a user Retry resumes at
    // the failed segment without re-billing. Temp objects are cleaned when the
    // job completes or when a replacement job is enqueued for the same day.
    return {
      claimed: true,
      jobId: job.id,
      status: terminal ? "failed" : job.status,
    };
  }
}

async function runScriptStep(
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any,
  job: ClaimedJob,
  deps: CastPumpDeps,
  deadline: number,
  now: () => number,
): Promise<CastJobStatus> {
  const context = await deps.buildContext(db, {
    tripId: job.tripId,
    targetDate: job.targetDate,
  });

  if (!context.hasDriveLeg) {
    await db
      .update(castEpisodeJobs)
      .set({
        status: "failed" as CastJobStatus,
        error: `No drive leg on ${job.targetDate} — nothing to narrate.`,
        claimedAt: null,
      })
      .where(eq(castEpisodeJobs.id, job.id));
    return "failed";
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let script: Awaited<ReturnType<typeof deps.generateScript>>;
  try {
    script = await deps.generateScript({
      context,
      durationMinutes: job.durationMinutes,
      deadline,
      now,
      onUsage: (usage) => {
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
      },
    });
  } catch (error) {
    // The tokens already spent must be recorded even on a failed run — cost
    // accounting under-reporting exactly when generation is flaky is how a
    // bill surprise hides.
    if (inputTokens > 0 || outputTokens > 0) {
      await db
        .update(castEpisodeJobs)
        .set({
          llmInputTokens: sql`${castEpisodeJobs.llmInputTokens} + ${inputTokens}`,
          llmOutputTokens: sql`${castEpisodeJobs.llmOutputTokens} + ${outputTokens}`,
        })
        .where(eq(castEpisodeJobs.id, job.id));
    }
    throw error;
  }

  // Read gate (eng-review Issue 8): the script is parked for the traveler to
  // read before a single TTS character is billed. No auto-advance.
  await db
    .update(castEpisodeJobs)
    .set({
      status: "awaiting_approval" as CastJobStatus,
      scriptJson: script,
      llmInputTokens: sql`${castEpisodeJobs.llmInputTokens} + ${inputTokens}`,
      llmOutputTokens: sql`${castEpisodeJobs.llmOutputTokens} + ${outputTokens}`,
      error: null,
      claimedAt: null,
    })
    .where(eq(castEpisodeJobs.id, job.id));
  return "awaiting_approval";
}

async function runSynthesisStep(params: {
  // biome-ignore lint/suspicious/noExplicitAny: db is a Drizzle client
  db: any;
  r2: CastR2Bucket | null;
  job: ClaimedJob;
  deps: CastPumpDeps;
  deadline: number;
  now: () => number;
}): Promise<{ status: CastJobStatus; released?: boolean }> {
  const { db, job, deps } = params;
  if (!params.r2) {
    throw new Error("R2 bucket is not bound — cannot synthesize episode audio");
  }
  const r2 = params.r2;
  const script = job.scriptJson;
  if (!script) {
    throw new Error("Job reached synthesis without a script");
  }

  const voiceId = deps.voiceId();
  const ttsModel = deps.ttsModel();
  const persisted: CastCheckpoint[] = [...(job.checkpointsJson ?? [])];

  const outcome = await deps.synthesizeSegments({
    r2,
    tripId: job.tripId,
    script,
    voiceId,
    ttsModel,
    existingCheckpoints: persisted,
    deadline: params.deadline,
    now: params.now,
    onCheckpoint: async (checkpoint) => {
      persisted.push(checkpoint);
      const segment = script.segments.find(
        (s) => s.key === checkpoint.segmentKey,
      );
      await db
        .update(castEpisodeJobs)
        .set({
          checkpointsJson: [...persisted],
          ttsCharacters: sql`${castEpisodeJobs.ttsCharacters} + ${segment?.text.length ?? 0}`,
        })
        .where(eq(castEpisodeJobs.id, job.id));
    },
  });

  if (!outcome.finished) {
    // Voluntary checkpoint-and-release: the next pump run resumes at the
    // first unsynthesized segment. Never run into the cron wall clock.
    await db
      .update(castEpisodeJobs)
      .set({ claimedAt: null })
      .where(eq(castEpisodeJobs.id, job.id));
    return { status: "synthesizing", released: true };
  }

  const segmentAudio = await loadCheckpointAudio(r2, outcome.checkpoints);
  const concat = concatMp3Segments(segmentAudio);
  validateEpisodeAudio(concat);

  const finalKey = `cast/episodes/${job.tripId}/${job.targetDate}-${job.id}.mp3`;
  await r2.put(finalKey, concat.bytes.buffer as ArrayBuffer, {
    httpMetadata: { contentType: "audio/mpeg" },
  });

  const [jobRow] = (await db
    .select({ ttsCharacters: castEpisodeJobs.ttsCharacters })
    .from(castEpisodeJobs)
    .where(eq(castEpisodeJobs.id, job.id))
    .limit(1)) as Array<{ ttsCharacters: number }>;

  const segmentsMeta = outcome.checkpoints.map((checkpoint, i) => ({
    title:
      script.segments.find((s) => s.key === checkpoint.segmentKey)?.title ??
      checkpoint.segmentKey,
    startSeconds: concat.segmentStartSeconds[i] ?? 0,
    durationSeconds: concat.segmentDurationSeconds[i] ?? 0,
  }));

  // Idempotent under crash-replay: a throw between this insert and the
  // status flip below re-runs finalization on the next firing — the unique
  // index on jobId makes the second insert a no-op instead of a duplicate
  // episode row.
  await db
    .insert(castEpisodes)
    .values({
      tripId: job.tripId,
      jobId: job.id,
      targetDate: job.targetDate,
      durationMinutes: job.durationMinutes,
      title: script.episodeTitle,
      r2Key: finalKey,
      sizeBytes: concat.bytes.byteLength,
      durationSeconds: concat.durationSeconds.toFixed(2),
      segmentsJson: segmentsMeta,
      voiceId,
      ttsModel,
      scriptModel: deps.scriptModel(),
      ttsCharacters: jobRow?.ttsCharacters ?? 0,
    })
    .onConflictDoNothing();

  await db
    .update(castEpisodeJobs)
    .set({
      status: "complete" as CastJobStatus,
      error: null,
      claimedAt: null,
    })
    .where(eq(castEpisodeJobs.id, job.id));

  await deleteCheckpoints(r2, outcome.checkpoints);

  return { status: "complete" };
}

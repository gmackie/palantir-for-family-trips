"use client";

import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTRPC } from "~/trpc/react";
import {
  evictForeignEpisodeAudio,
  getCachedEpisodeAudio,
  listCachedEpisodeIds,
  putCachedEpisodeAudio,
} from "./cast-audio-store";

/**
 * Corridor Cast console — the night-before ritual on one card stack:
 * generate (15/30) → read the script → approve → poll → play / download.
 *
 * States per DESIGN.md: loading, empty, in-progress (job pipeline states),
 * error (failed job + retry), success (episode ready / downloaded-offline).
 */

const ACTIVE_STATUSES = new Set([
  "pending",
  "awaiting_approval",
  "approved",
  "synthesizing",
]);

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-[#58A6FF]/15 text-[#58A6FF]",
  awaiting_approval: "bg-[#D29922]/15 text-[#D29922]",
  approved: "bg-[#58A6FF]/15 text-[#58A6FF]",
  synthesizing: "bg-[#58A6FF]/15 text-[#58A6FF]",
  complete: "bg-[#3FB950]/15 text-[#3FB950]",
  failed: "bg-[#F85149]/15 text-[#F85149]",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Writing script",
  awaiting_approval: "Script ready — read it",
  approved: "Queued for voice",
  synthesizing: "Synthesizing voice",
  complete: "Complete",
  failed: "Failed",
};

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function CastConsole({
  workspaceId,
  tripId,
  userId,
}: {
  workspaceId: string;
  tripId: string;
  /** Scopes the offline audio cache — see cast-audio-store. */
  userId: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [durationMinutes, setDurationMinutes] = useState<15 | 30>(30);
  const [openScriptJobId, setOpenScriptJobId] = useState<string | null>(null);

  const tonightQuery = useQuery(
    trpc.cast.tonight.queryOptions({ workspaceId, tripId }),
  );
  const statusQuery = useQuery(
    trpc.cast.status.queryOptions(
      { workspaceId, tripId },
      // Poll while any job is mid-pipeline. The pump advances on a 5-min
      // cron, so 30s keeps the ritual feeling live without hammering the
      // guard chain; user-driven transitions invalidate instantly anyway.
      {
        refetchInterval: (query) =>
          query.state.data?.jobs.some((j) => ACTIVE_STATUSES.has(j.status))
            ? 30_000
            : false,
      },
    ),
  );

  const voicesQuery = useQuery(
    trpc.cast.voices.queryOptions({ workspaceId, tripId }),
  );
  const setVoice = useMutation(
    trpc.cast.setVoice.mutationOptions({
      onSuccess: () => {
        toast.success("Narrator updated. It applies to the next episode.");
        void qc.invalidateQueries({
          queryKey: trpc.cast.voices.queryKey({ workspaceId, tripId }),
        });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const groundingQuery = useQuery(
    trpc.cast.grounding.queryOptions({ workspaceId, tripId }),
  );
  const invalidateGrounding = useCallback(() => {
    void qc.invalidateQueries({
      queryKey: trpc.cast.grounding.queryKey({ workspaceId, tripId }),
    });
  }, [qc, trpc, workspaceId, tripId]);
  const removeFact = useMutation(
    trpc.cast.removeGroundingFact.mutationOptions({
      onSuccess: () => {
        toast.success("Fact dropped. It will not reach the next script.");
        invalidateGrounding();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const deleteBrief = useMutation(
    trpc.cast.deleteGroundingBrief.mutationOptions({
      onSuccess: () => {
        toast.success("Research discarded for that leg.");
        invalidateGrounding();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const invalidateStatus = useCallback(() => {
    void qc.invalidateQueries({
      queryKey: trpc.cast.status.queryKey({ workspaceId, tripId }),
    });
  }, [qc, trpc, workspaceId, tripId]);

  const generate = useMutation(
    trpc.cast.generate.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.deduplicated
            ? "Already generating tonight's episode."
            : `Episode for ${formatDate(result.targetDate)} queued.`,
        );
        invalidateStatus();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const approve = useMutation(
    trpc.cast.approveScript.mutationOptions({
      onSuccess: () => {
        toast.success("Script approved — voice synthesis queued.");
        setOpenScriptJobId(null);
        invalidateStatus();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const retry = useMutation(
    trpc.cast.retry.mutationOptions({
      onSuccess: () => {
        toast.success("Retrying — paid segments are kept.");
        invalidateStatus();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const tonight = tonightQuery.data;
  const jobs = statusQuery.data?.jobs ?? [];
  const episodes = statusQuery.data?.episodes ?? [];
  // Only a job for TONIGHT's date blocks the button — an unread script from
  // an earlier day must never dead-end every future night's episode.
  const activeJob = jobs.find(
    (j) =>
      ACTIVE_STATUSES.has(j.status) && j.targetDate === tonight?.targetDate,
  );

  return (
    <>
      {/* ── Tonight's episode ── */}
      <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
        <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
          Tonight&apos;s episode
        </div>

        {tonightQuery.isLoading ? (
          <p className="text-sm text-[#8B949E]">
            Checking tomorrow&apos;s plan…
          </p>
        ) : !tonight ? (
          <p className="text-sm text-[#F85149]">
            Could not load tomorrow&apos;s plan.
          </p>
        ) : !tonight.hasDriveLeg ? (
          <p className="text-sm text-[#8B949E]">
            No drive leg on {formatDate(tonight.targetDate)} — no episode to
            make. Enjoy the day off the road.
          </p>
        ) : (
          <>
            <p className="text-sm text-[#C9D1D9]">
              Generate the podcast for tomorrow&apos;s drive. The script is
              written first — read it before any voice minutes are spent.
            </p>
            {tonight.degraded && (
              <p className="text-xs text-[#D29922]">
                Tomorrow&apos;s leg has no route geometry yet — the episode will
                skip corridor points of interest.
              </p>
            )}
            {voicesQuery.data && voicesQuery.data.voices.length > 0 && (
              <label className="flex flex-wrap items-center gap-2 text-xs text-[#8B949E]">
                <span className="font-mono uppercase tracking-wider">
                  Narrator
                </span>
                <select
                  value={voicesQuery.data.tripVoiceId ?? ""}
                  disabled={setVoice.isPending}
                  onChange={(event) =>
                    setVoice.mutate({
                      workspaceId,
                      tripId,
                      voiceId: event.target.value || null,
                    })
                  }
                  className="rounded-[2px] border border-[#30363D] bg-[#0A0C10] px-2 py-1 font-mono text-xs text-[#C9D1D9]"
                >
                  <option value="">Default voice</option>
                  {voicesQuery.data.voices.map((voice) => (
                    <option key={voice.voiceId} value={voice.voiceId}>
                      {voice.name}
                      {voice.labels.accent ? ` — ${voice.labels.accent}` : ""}
                    </option>
                  ))}
                </select>
                <span className="text-[#8B949E]">
                  applies to the next episode
                </span>
              </label>
            )}
            <div className="flex items-center gap-2">
              {([15, 30] as const).map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setDurationMinutes(minutes)}
                  className={`rounded-[2px] border px-3 py-1 font-mono text-xs transition-colors ${
                    durationMinutes === minutes
                      ? "border-[#58A6FF] bg-[#58A6FF]/15 text-[#58A6FF]"
                      : "border-[#30363D] text-[#8B949E] hover:bg-[#30363D]/40"
                  }`}
                >
                  {minutes} min
                </button>
              ))}
              <button
                type="button"
                disabled={generate.isPending || !!activeJob}
                onClick={() =>
                  generate.mutate({ workspaceId, tripId, durationMinutes })
                }
                className="ml-auto rounded-[2px] bg-[#3FB950] px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[#0A0C10] transition-colors hover:bg-[#56D364] disabled:opacity-50"
              >
                {activeJob
                  ? "In flight…"
                  : `Generate — ${formatDate(tonight.targetDate)}`}
              </button>
            </div>
            {/* tz visibility tripwire (Issue 9.8): a UTC-defaulted trip row
                shows the wrong date/zone right here, at tap time. */}
            <p className="font-mono text-[10px] text-[#484F58]">
              Tomorrow resolves to {tonight.targetDate} in {tonight.tz}
            </p>
          </>
        )}
      </div>

      {/* ── Job pipeline ── */}
      {jobs.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
          <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
            Generation log
          </div>
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-col gap-1 border-b border-[#21262D]/60 pb-2 last:border-b-0 last:pb-0"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-[#C9D1D9]">
                  {formatDate(job.targetDate)}
                </span>
                <span className="font-mono text-[10px] text-[#484F58]">
                  {job.durationMinutes} min
                </span>
                <span
                  className={`rounded-[2px] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_STYLE[job.status] ?? "bg-[#8B949E]/15 text-[#8B949E]"}`}
                >
                  {STATUS_LABEL[job.status] ?? job.status}
                </span>
                <span className="ml-auto font-mono text-[10px] text-[#484F58]">
                  {job.ttsCharacters > 0
                    ? `${(job.ttsCharacters / 1000).toFixed(1)}k voice chars`
                    : `${(((job.llmInputTokens ?? 0) + (job.llmOutputTokens ?? 0)) / 1000).toFixed(1)}k tokens`}
                </span>
              </div>
              {job.error && (
                <p className="text-xs text-[#F85149]">{job.error}</p>
              )}
              <div className="flex items-center gap-2">
                {job.status === "awaiting_approval" && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenScriptJobId(
                        openScriptJobId === job.id ? null : job.id,
                      )
                    }
                    className="rounded-[2px] border border-[#D29922]/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#D29922] transition-colors hover:bg-[#D29922]/10"
                  >
                    {openScriptJobId === job.id ? "Hide script" : "Read script"}
                  </button>
                )}
                {job.status === "failed" && (
                  <button
                    type="button"
                    disabled={retry.isPending}
                    onClick={() =>
                      retry.mutate({ workspaceId, tripId, jobId: job.id })
                    }
                    className="rounded-[2px] border border-[#58A6FF]/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/10 disabled:opacity-50"
                  >
                    Retry (resumes)
                  </button>
                )}
              </div>
              {openScriptJobId === job.id && (
                <ScriptReview
                  workspaceId={workspaceId}
                  tripId={tripId}
                  jobId={job.id}
                  onApprove={() =>
                    approve.mutate({ workspaceId, tripId, jobId: job.id })
                  }
                  approving={approve.isPending}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Research ── */}
      <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
        <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
          Corridor research
        </div>
        {groundingQuery.isLoading ? (
          <p className="text-sm text-[#8B949E]">Loading research…</p>
        ) : groundingQuery.isError ? (
          <p className="text-sm text-[#F85149]">
            Could not load research: {groundingQuery.error.message}
          </p>
        ) : (
          <>
            {groundingQuery.data?.briefs.length === 0 ? (
              <p className="text-sm text-[#8B949E]">
                No research yet. Without it the episode still runs — the
                histories are just hedged as campfire truth.
              </p>
            ) : (
              groundingQuery.data?.briefs.map((brief) => (
                <details
                  key={brief.id}
                  className="rounded-[3px] border border-[#21262D] bg-[#0A0C10] p-3"
                >
                  <summary className="cursor-pointer text-sm text-[#C9D1D9]">
                    {brief.segmentName}{" "}
                    <span className="font-mono text-xs text-[#8B949E]">
                      {brief.verifiedCount}/{brief.facts.length} sourced ·{" "}
                      {brief.sources.length} sources
                    </span>
                  </summary>
                  <p className="mt-2 text-xs text-[#8B949E]">{brief.title}</p>
                  <ul className="mt-3 flex flex-col gap-2">
                    {brief.facts.map((fact) => (
                      <li
                        key={fact.title}
                        className="flex items-start justify-between gap-3 border-[#21262D] border-t pt-2"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-[#C9D1D9]">
                              {fact.title}
                            </span>
                            <span
                              className={`rounded-[2px] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                fact.verified
                                  ? "bg-[#3FB950]/15 text-[#3FB950]"
                                  : "bg-[#D29922]/15 text-[#D29922]"
                              }`}
                            >
                              {fact.verified ? "Sourced" : "Unverified"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#8B949E]">
                            {fact.text}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={removeFact.isPending}
                          onClick={() =>
                            removeFact.mutate({
                              workspaceId,
                              tripId,
                              briefId: brief.id,
                              factTitle: fact.title,
                            })
                          }
                          className="shrink-0 rounded-[2px] border border-[#30363D] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#8B949E] transition-colors hover:border-[#F85149] hover:text-[#F85149] disabled:opacity-50"
                        >
                          Drop
                        </button>
                      </li>
                    ))}
                  </ul>
                  {brief.sources.length > 0 && (
                    <ol className="mt-3 flex flex-col gap-1 border-[#21262D] border-t pt-2">
                      {brief.sources.map((source) => (
                        <li
                          key={source.index}
                          className="font-mono text-[10px] text-[#8B949E]"
                        >
                          [{source.index}] {source.url ?? "no URL recorded"}
                        </li>
                      ))}
                    </ol>
                  )}
                  <button
                    type="button"
                    disabled={deleteBrief.isPending}
                    onClick={() =>
                      deleteBrief.mutate({
                        workspaceId,
                        tripId,
                        briefId: brief.id,
                      })
                    }
                    className="mt-3 self-start rounded-[2px] border border-[#30363D] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#8B949E] transition-colors hover:border-[#F85149] hover:text-[#F85149] disabled:opacity-50"
                  >
                    Discard this research
                  </button>
                </details>
              ))
            )}
            {groundingQuery.data && groundingQuery.data.gaps.length > 0 && (
              <p className="text-xs text-[#8B949E]">
                No research yet for:{" "}
                <span className="text-[#D29922]">
                  {groundingQuery.data.gaps.map((g) => g.name).join(", ")}
                </span>
                . Run an OODA thread for those corridors and push it with{" "}
                <code className="text-[#C9D1D9]">
                  scripts/cast-grounding.ts push
                </code>
                .
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Episodes ── */}
      <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
        <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
          Episodes
        </div>
        {statusQuery.isLoading ? (
          <p className="text-sm text-[#8B949E]">Loading episodes…</p>
        ) : statusQuery.isError ? (
          // An error must never masquerade as the empty state — in-flight
          // jobs and existing episodes would silently vanish.
          <div className="flex items-center gap-3">
            <p className="text-sm text-[#F85149]">
              Could not load episodes: {statusQuery.error.message}
            </p>
            <button
              type="button"
              onClick={() => void statusQuery.refetch()}
              className="rounded-[2px] border border-[#58A6FF]/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/10"
            >
              Retry
            </button>
          </div>
        ) : episodes.length === 0 ? (
          <p className="text-sm text-[#8B949E]">
            No episodes yet. Tomorrow&apos;s drive is waiting for its narrator.
          </p>
        ) : (
          episodes.map((episode) => (
            <EpisodeRow key={episode.id} episode={episode} userId={userId} />
          ))
        )}
      </div>
    </>
  );
}

function ScriptReview({
  workspaceId,
  tripId,
  jobId,
  onApprove,
  approving,
}: {
  workspaceId: string;
  tripId: string;
  jobId: string;
  onApprove: () => void;
  approving: boolean;
}) {
  const trpc = useTRPC();
  const scriptQuery = useQuery(
    trpc.cast.script.queryOptions({ workspaceId, tripId, jobId }),
  );

  const script = scriptQuery.data?.scriptJson as {
    episodeTitle: string;
    segments: Array<{ key: string; title: string; text: string }>;
  } | null;

  if (scriptQuery.isLoading) {
    return <p className="text-xs text-[#8B949E]">Loading script…</p>;
  }
  if (!script) {
    return <p className="text-xs text-[#F85149]">Script unavailable.</p>;
  }

  const totalWords = script.segments.reduce(
    (sum, s) => sum + s.text.split(/\s+/).length,
    0,
  );

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-[4px] border border-[#30363D] bg-[#161B22] p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[#C9D1D9]">
          {script.episodeTitle}
        </span>
        <span className="font-mono text-[10px] text-[#484F58]">
          {script.segments.length} chapters · ~{totalWords.toLocaleString()}{" "}
          words
        </span>
      </div>
      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
        {script.segments.map((segment) => (
          <div key={segment.key}>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[#8B949E]">
              {segment.title}
            </div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#C9D1D9]">
              {segment.text}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={approving}
        onClick={onApprove}
        className="self-start rounded-[2px] bg-[#3FB950] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A0C10] transition-colors hover:bg-[#56D364] disabled:opacity-50"
      >
        {approving ? "…" : "Approve — spend voice minutes"}
      </button>
    </div>
  );
}

type EpisodeSummary = {
  id: string;
  targetDate: string;
  durationMinutes: number;
  title: string;
  sizeBytes: number;
  durationSeconds: string;
  segmentsJson: Array<{
    title: string;
    startSeconds: number;
    durationSeconds: number;
  }>;
  createdAt: Date;
};

const PLAYBACK_RATES = [1, 1.25, 1.5] as const;

function EpisodeRow({
  episode,
  userId,
}: {
  episode: EpisodeSummary;
  userId: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [caching, setCaching] = useState(false);
  const [rate, setRate] = useState<(typeof PLAYBACK_RATES)[number]>(1);

  const audioHref = `/api/cast/${episode.id}/audio`;

  useEffect(() => {
    let alive = true;
    // Purge any other account's blobs before trusting this list — the store
    // is origin-scoped, so a shared browser can hold a previous user's audio.
    evictForeignEpisodeAudio(userId)
      .catch(() => {})
      .then(() => listCachedEpisodeIds(userId))
      .then((ids) => {
        if (alive && ids) setCached(ids.includes(episode.id));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [episode.id, userId]);

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  const ensureAudio = useCallback(async (): Promise<string | null> => {
    if (objectUrl) return objectUrl;
    setCaching(true);
    try {
      let blob = await getCachedEpisodeAudio(userId, episode.id).catch(
        () => null,
      );
      let persisted = blob != null;
      if (!blob) {
        const response = await fetch(audioHref);
        if (!response.ok) {
          throw new Error(`Audio fetch failed (${response.status})`);
        }
        blob = await response.blob();
        // Cache write failure only costs the offline bonus, not playback —
        // but the "Ready offline" badge must never claim persistence that
        // didn't happen (DESIGN.md: never imply a write succeeded).
        persisted = await putCachedEpisodeAudio(userId, episode.id, blob)
          .then(() => true)
          .catch(() => false);
      }
      setCached(persisted);
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      return url;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load audio",
      );
      return null;
    } finally {
      setCaching(false);
    }
  }, [audioHref, episode.id, objectUrl]);

  const handlePlay = useCallback(async () => {
    const url = await ensureAudio();
    if (!url) return;
    // Let React attach the src, then start playback.
    requestAnimationFrame(() => {
      const el = audioRef.current;
      if (el) {
        el.playbackRate = rate;
        void el.play().catch(() => {});
      }
    });
  }, [ensureAudio, rate]);

  const seekTo = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (el) {
      el.currentTime = seconds;
      void el.play().catch(() => {});
    }
  }, []);

  const durationSeconds = Number(episode.durationSeconds);

  return (
    <div className="flex flex-col gap-2 border-b border-[#21262D]/60 pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[#C9D1D9]">
          {episode.title}
        </span>
        {cached && (
          <span className="rounded-[2px] bg-[#3FB950]/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#3FB950]">
            Ready offline
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 font-mono text-[10px] text-[#484F58]">
        <span>{formatDate(episode.targetDate)}</span>
        <span>{formatClock(durationSeconds)}</span>
        <span>{(episode.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
        <span>{episode.segmentsJson.length} chapters</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!objectUrl && (
          <button
            type="button"
            disabled={caching}
            onClick={handlePlay}
            className="rounded-[2px] bg-[#58A6FF] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A0C10] transition-colors hover:bg-[#79B8FF] disabled:opacity-50"
          >
            {caching ? "Loading…" : cached ? "Play (offline copy)" : "Play"}
          </button>
        )}
        {/* The P0 offline GUARANTEE: a real MP3 in the Files app. */}
        <a
          href={audioHref}
          download={`corridor-cast-${episode.targetDate}.mp3`}
          className="rounded-[2px] border border-[#30363D] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#C9D1D9] transition-colors hover:bg-[#30363D]/40"
        >
          Download MP3
        </a>
        {objectUrl && (
          <div className="flex items-center gap-1">
            {PLAYBACK_RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRate(r);
                  if (audioRef.current) audioRef.current.playbackRate = r;
                }}
                className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                  rate === r
                    ? "border-[#58A6FF] text-[#58A6FF]"
                    : "border-[#30363D] text-[#8B949E] hover:border-[#58A6FF] hover:text-[#58A6FF]"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
        )}
      </div>

      {objectUrl && (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: generated speech audio */}
          <audio
            ref={audioRef}
            src={objectUrl}
            controls
            className="w-full"
            style={{ colorScheme: "dark" }}
          />
          <div className="flex flex-wrap gap-1">
            {episode.segmentsJson.map((segment) => (
              <button
                key={`${segment.title}-${segment.startSeconds}`}
                type="button"
                onClick={() => seekTo(segment.startSeconds)}
                className="rounded-[2px] border border-[#30363D] px-2 py-0.5 text-left font-mono text-[10px] text-[#8B949E] transition-colors hover:border-[#58A6FF] hover:text-[#58A6FF]"
              >
                {formatClock(segment.startSeconds)} · {segment.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

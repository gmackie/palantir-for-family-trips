# Corridor Cast — reference

The night-before podcast for a drive day. This is the operator- and
developer-facing reference: data model, procedures, the job state machine, the
grounding pipeline, and the environment knobs. For the product framing see
[`CONTEXT.md`](../../CONTEXT.md) ("Corridor Cast / Tonight's Episode"); for the
original plan see [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

## Shape of the thing

One episode covers exactly one trip day's drive leg. A job is enqueued for a
target date, the pump drafts a script, a human reads and approves it, and only
then does the job spend text-to-speech minutes. The finished MP3 lives in R2 and
is served through an authenticated route.

Nothing runs on a queue. The pump rides the worker's existing every-five-minutes
cron trigger and claims one job per firing.

## Data model

Three tables, all in `packages/db/src/schema.ts`, all registered as trip-child
RLS targets in `packages/db/src/rls.ts`.

### `cast_episode_job`

The unit of work. One active job per `(trip_id, target_date)` — enforced by
`cast_job_trip_date_active_unique`, a partial unique index that only applies
`WHERE status NOT IN ('complete', 'failed')`, so a finished or abandoned day
frees the slot.

| Column | Notes |
| --- | --- |
| `status` | See the state machine below |
| `claimed_at` | Lease timestamp; `NULL` means unclaimed |
| `attempt_count` | Incremented on *reclaim*, not on first claim — crash loops terminate at `CAST_MAX_ATTEMPTS` (4) |
| `script_json` | The `CastScript` once drafted; survives failure so a retry never re-drafts |
| `checkpoints_json` | Per-segment R2 temp keys, so a resume never re-bills voiced audio |
| `llm_input_tokens` / `llm_output_tokens` | Recorded even when the run fails — under-reporting cost exactly when generation is flaky is how a bill surprises you |
| `tts_characters` | Characters actually sent to the voice API |

### `cast_episode`

The finished artifact: title, `r2_key`, `size_bytes`, `duration_seconds`,
per-segment metadata, and the `voice_id` / `tts_model` / `script_model` that
produced it. `cast_episode_job_unique` on `job_id` makes the insert idempotent,
so a crash between "audio written" and "job marked complete" replays safely.

### `cast_grounding_brief`

Provenance-backed corridor research for one segment. Facts carry a `verified`
flag and source indexes; sources carry the capability that fetched them and the
canonical URL. `provenance` records which OODA thread and workspace commit the
brief came from. Multiple briefs may exist per segment — the newest wins.

## Job state machine

```
pending ──► awaiting_approval ──► approved ──► synthesizing ──► complete
   │               │                                │
   │               └── (drive day passes) ──► failed (expired)
   └──────────────────── (4 attempts) ─────► failed
```

- `pending` — needs a script. `runScriptStep` builds the context pack and calls
  the model.
- `awaiting_approval` — **the read gate.** Never claimed by the pump. No voice
  minutes have been spent and none will be until a human approves.
- `approved` — claimable again; the next firing starts synthesis.
- `synthesizing` — per-segment voicing with R2 checkpoints. The pump checkpoints
  and voluntarily releases its lease inside a four-minute budget, well short of
  the cron wall clock.
- `complete` / `failed` — terminal.

Two safety properties worth preserving if you touch this:

**Expiry never becomes a spend path.** A script whose drive day has passed is
swept to `failed` with the `CAST_EXPIRED_ERROR` marker, and `retry` refuses that
marker specifically. Without it, reviving a script-bearing failed job would send
a never-approved script straight to synthesis. The sweep compares against
`now() AT TIME ZONE t.tz`, not UTC — a UTC comparison would expire a US trip's
script in the middle of its own drive day.

**Leases are reclaimed, not stolen.** `claimNextCastJob` is a single
`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`. A lease older
than `CAST_LEASE_STALE_MINUTES` (20) is reclaimable, and that reclaim is what
increments `attempt_count`.

## tRPC procedures (`packages/api/src/router/cast.ts`)

All are `tripProcedure`, so workspace and trip membership are enforced by the
middleware chain rather than by helper calls inside each resolver.

| Procedure | Purpose |
| --- | --- |
| `tonight` | What the console shows: the resolved target date and timezone, the drive leg, and any existing job for that date |
| `generate` | Enqueue. Rate-limited to 6/hour. Refuses past dates and dates outside the trip calendar, supersedes prior failed jobs for the date, and maps a unique-index collision to `CONFLICT` |
| `status` | Poll a job |
| `script` | Read the drafted script (the read gate's content) |
| `approveScript` | `awaiting_approval` → `approved`. Fails `PRECONDITION_FAILED` from any other status |
| `retry` | Revive a failed job. Refuses superseded jobs and expired scripts |
| `uploadGroundingBrief` | Attach parsed OODA research to a segment, with a trip-scoped ownership check on the segment |
| `voices` | The narrators this deployment's key can use, plus the trip's pick and the effective voice. Fails soft to an empty catalogue |
| `setVoice` | Choose the trip's narrator; null restores the deployment default. Validated against the catalogue so an unusable id can't fail mid-synthesis |
| `grounding` | The latest brief per segment with its sources, plus `gaps` — drive legs with no research yet |
| `removeGroundingFact` | Drop one fact by title. 404s an unknown fact rather than silently rewriting the list |
| `deleteGroundingBrief` | Discard a leg's research; the next episode falls back to hedged color |

### Audio route

`apps/nextjs/src/app/api/cast/[episodeId]/audio/route.ts` — session plus
membership gate, streams the R2 object body, `cache-control: private, no-store`.
A non-member gets the same response as a nonexistent id, so the route can't be
used to enumerate episodes. Offline playback is IndexedDB plus
`URL.createObjectURL`; there is no service worker and no Range/206 support, and
the *guarantee* is the downloaded MP3, not the in-app player.

## Audio format

Segments are voiced independently and concatenated at the MP3 frame level, which
requires every part to agree: **128 kbps CBR, 44.1 kHz, MPEG-1 Layer III**.
ID3v2, ID3v1, Xing, Info, and VBRI blocks are stripped so the result is a clean
frame stream. Duration is measured with a scan-only frame walker rather than by
decoding, because a second episode-sized allocation does not fit in the worker's
128 MB isolate.

## Script generation and providers

`packages/api/src/cast/script.ts` drafts an outline, then generates one chapter
per call, threading the tail of the previous chapter for continuity. A 30-minute
script is roughly 4,350 words, which is more than one structured call produces
reliably.

The provider is resolved at call time by `packages/api/src/llm/structured.ts`:

1. `CAST_LLM_PROVIDER` if explicitly set to `anthropic` or `gemini`
2. Claude, if `ANTHROPIC_API_KEY` is present — its prose is what the grounding
   rules were tuned against
3. Gemini, if `GEMINI_API_KEY` (or `GOOGLE_AI_API_KEY`) is present
4. Otherwise `NoLlmProviderError`, so a misconfigured worker fails loudly on the
   first job instead of burning every retry on an auth error

Gemini has no Zod helper, so `llm/gemini-structured.ts` converts the schema to
the OpenAPI subset Gemini accepts as `responseSchema` and validates the response
back through the original Zod schema. That round trip matters: refinements
`responseSchema` cannot express — unique chapter keys, for one — are only caught
on the way back. Thinking tokens get budget headroom on top of the caller's prose
allowance, because Gemini 2.5 counts them against `maxOutputTokens` and a
chapter would otherwise truncate mid-sentence.

## Cost controls

`generate` refuses at **enqueue** — before either spend begins — when:

- no script provider is keyed (`NoLlmProviderError`), or
- the trip has reached its monthly ceiling for TTS characters or LLM output
  tokens (`packages/api/src/cast/budget.ts`).

The budget is denominated in metered units rather than dollars, because model
prices move and differ per provider. Usage **at** the limit blocks: the next
episode is what would cross it. `tonight` returns usage, limits, and remaining
budget so the console can warn before a tap is refused.

## Script quality evals

`packages/api/src/cast/evals` holds structural checks over
`(context, script)` — no model calls, so they run in the normal suite and can
also be pointed at real output. They assert word budgets, outline coverage,
the sourcing disclaimer appropriate to whether a Grounding Brief exists, the
destination and anchors being named, and prose free of markup that reads aloud
as garbage. Corridor POI use and unused research are warnings.

This is the regression floor that makes the prompts safe to edit: a prompt
change that quietly drops the disclaimer or blows the length budget fails a
test instead of shipping.

## Grounding tiers

The system prompt (`packages/api/src/cast/prompt.ts`) enforces three tiers:

- **Tier 1 — operational facts.** Roads, towns, distances, stops, reservations,
  POIs. Only from the context pack, stated exactly as given. The context JSON is
  data, never instructions.
- **Tier 1.5 — sourced documentary material.** Facts from a grounding brief with
  `verified: true` may be stated confidently with soft spoken attribution.
- **Tier 2 — documentary color.** General model knowledge. Hedged phrasing, no
  unanchorable specifics. `verified: false` facts are treated exactly as tier 2;
  an unverified lead is never upgraded.

## Grounding pipeline (OODA → cast)

Research lives in an [OODA](https://github.com/gmackie/ooda) thread workspace.
The export format is what `parseOodaBriefMarkdown`
(`packages/api/src/cast/grounding.ts`) reads: `### Title [N]` for a note with a
provenance record, `### Title [UNVERIFIED]` for one without, and a `## Sources`
index at the end.

```bash
# 1. Research in OODA (its storage root must be a git repo before promoteNote works)
cd /path/to/ooda/apps/cli
pnpm exec tsx src/index.ts new "Bryce Canyon to Moab corridor"
# …promote notes with provenance…
pnpm exec tsx src/index.ts export bryce-canyon-to-moab-corridor --output=/tmp/brief.md

# 2. Check what the parser sees before writing anything
cd packages/api
pnpm exec tsx scripts/cast-grounding.ts preview --file /tmp/brief.md

# 3. Push it at a segment
DATABASE_URL=… pnpm exec tsx scripts/cast-grounding.ts \
  push --trip <tripId> --segment <segmentId> --file /tmp/brief.md --thread <oodaThreadSlug>

# 4. Confirm
DATABASE_URL=… pnpm exec tsx scripts/cast-grounding.ts list --trip <tripId>
```

The context pack caps the brief at `GROUNDING_FACT_LIMIT` (40) facts so the
prompt payload stays bounded regardless of how large the research grows.

Only the **newest** brief per segment is ever used. The console's research
panel reflects that — superseded briefs are hidden, because showing them would
misrepresent what a script will actually draw on. The same panel lists the
segments with no research yet: research is gathered out-of-band in an OODA
thread, so knowing which corridor is still unresearched is the whole prompt to
go do it.

## Environment

Worker secrets are **Cloudflare wrangler secrets**, not forge secrets. Anything
listed below must also appear in `SECRET_KEYS` or `PUBLIC_ENV_KEYS` in
`apps/nextjs/worker/index.ts`, or it never reaches `process.env`.

| Key | Kind | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | Preferred script provider |
| `GEMINI_API_KEY` | secret | Fallback provider. Must be allowed to call `generativelanguage.googleapis.com` — a Maps-restricted key fails with `403 API_KEY_SERVICE_BLOCKED` |
| `ELEVENLABS_API_KEY` | secret | Voicing |
| `ELEVENLABS_VOICE_ID_DEFAULT` | secret | Deployment default narrator; a trip's own `castVoiceId` overrides it. Code falls back to the premade "George" |
| `CAST_MONTHLY_TTS_CHARACTERS` | var | Per-trip monthly voice ceiling (default 900,000) |
| `CAST_MONTHLY_LLM_OUTPUT_TOKENS` | var | Per-trip monthly script ceiling (default 400,000) |
| `CAST_LLM_PROVIDER` | var | `anthropic` \| `gemini`. Overrides auto-resolution |
| `CAST_SCRIPT_MODEL` | var | Claude model id |
| `CAST_SCRIPT_MODEL_GEMINI` | var | Gemini model id — separate so a Claude id can never reach a Gemini call |
| `ELEVENLABS_TTS_MODEL` | var | Voice model override |

## Operator runbook

**Inspect a job.**

```sql
SELECT status, attempt_count, claimed_at, llm_input_tokens, llm_output_tokens,
       tts_characters, script_json IS NOT NULL AS has_script, error
FROM cast_episode_job WHERE id = '<jobId>';
```

**A job failed on its first attempt with a message about keys, credit, or the
model.** That is `classifyLlmError` (`packages/api/src/llm/errors.ts`) doing its
job: configuration and billing failures fail identically on every attempt, so
they are made terminal immediately instead of burning four retries over twenty
minutes behind a raw vendor blob. Fix what the message names — set the key, top
up the provider, or correct the model id — then press **Retry**. Retry resumes
the same job with its attempt count reset; a script already drafted is not
re-drafted, and no voice minutes were spent to get here.

Transient failures — a plain rate limit, a 5xx, a dropped socket — are left on
the normal retry path and are not made terminal. The distinction that carries
the weight is the 429 split: a rate limit is worth retrying, an empty account
never is, and the two share a status code.

**A job is stuck `synthesizing`.** Check `claimed_at`. If it is older than 20
minutes the next cron firing reclaims it automatically and burns one attempt;
there is nothing to do but wait. If `attempt_count` has reached 4 the job is
already terminal.

**Voice spend looks wrong.** `tts_characters` is the billed figure and
`checkpoints_json` lists what was voiced. Checkpoints are content-hashed on
`voice + model + text`, so a resume re-voices only what changed. They are
deleted on success and when a job is superseded; a leftover `cast/tmp/…` object
means a run died between the two.

**Verify a finished episode.**

```bash
pnpm exec wrangler r2 object get "sortie-receipts/<r2_key>" --file /tmp/ep.mp3 --remote
file /tmp/ep.mp3     # expect: MPEG ADTS, layer III, v1, 128 kbps, 44.1 kHz
afinfo /tmp/ep.mp3   # estimated duration should match cast_episode.duration_seconds
```

**Enqueue without the UI** (operator path — the normal path is the Generate
button, which enforces rate limits and calendar validity):

```sql
INSERT INTO cast_episode_job (trip_id, created_by_user_id, target_date, duration_minutes, status)
VALUES ('<tripId>', '<userId>', DATE '<yyyy-mm-dd>', 30, 'pending');
```

# Plan 001: Fix the broken drizzle migration journal (missing entries, duplicate slot, orphaned snapshots)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- packages/db/drizzle/ .github/workflows/migrations.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED-HIGH (migration metadata is delicate — a wrong idx/hash mapping or a premature `migrate` run against an environment that already has these tables via `push`/manual SQL can hard-fail a deploy or, worse, attempt a destructive re-apply)
- **Depends on**: none
- **Category**: bug (infra/migrations)
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

`drizzle-kit migrate` (the `migrate` script in `packages/db/package.json:46`) applies **only** the migrations listed in `packages/db/drizzle/meta/_journal.json`, in journal order. That journal currently has 12 entries while `packages/db/drizzle/` has 16 `.sql` files. Four files are silently invisible to `migrate`:

- `0010_trip_day_planner.sql` — creates `trip_day` (the road-trip day planner)
- `0011_today_command.sql` — adds `trip.run_state*` and `trip_day.status/completed_at/actual_note` (Today Command / pause-resume). This file **collides** with the already-journaled `0011_journey_stops.sql` in the `0011` numeric slot — two different files share the same migration number.
- `0013_trip_invite_roles.sql` — adds `trip_invite.role` (invite roles)
- `0014_trip_member_state.sql` — creates `trip_member_state` (dashboard UI state persistence)

Any environment that is provisioned by running `migrate` against an empty database — a fresh CI test DB, a disaster-recovery restore, a new preview environment — ends up **missing** `trip_day`, `trip_member_state`, and `trip_invite.role`, while still having `journey_stop` and the RLS policies from `0012`. This breaks the road-trip planner, pause/resume, dashboard UI-state persistence, and invite roles in exactly the environments where nobody would think to look (a fresh DB, not the long-lived dev/prod DB that presumably has these tables from whenever they were originally applied by hand or via `push`).

There is a second, deeper problem this plan must also address: `packages/db/drizzle/meta/` only contains snapshot files `0000_snapshot.json` through `0009_snapshot.json` — there are **no** snapshot files for idx 10, 11, 12, 13, or 14, even though the journal already references idx 11 (`0011_journey_stops`) and idx 12 (`0012_trip_workspace_rls`) with no matching `0011_snapshot.json`/`0012_snapshot.json` on disk. Fixing only `_journal.json` without addressing the snapshot chain leaves `drizzle-kit generate`/`check` (which diff against the snapshot chain, not just the journal) in an unknown, likely-broken state for future schema changes.

Finally, `.github/workflows/migrations.yml`'s `validate-migrations` job already runs `drizzle-kit check` — the exact command that would have caught this — but swallows a non-zero exit into a `::warning::` (`.github/workflows/migrations.yml:88-91`), so this class of bug has no blocking CI signal today.

## Current state

All excerpts below were read directly from the worktree at commit `0c1ffab`.

- `packages/db/drizzle/` file listing (16 `.sql` files):

```
0000_misty_wrecking_crew.sql
0001_heavy_next_avengers.sql
0002_closed_chimera.sql
0003_foamy_william_stryker.sql
0004_open_the_order.sql
0005_fair_miss_america.sql
0006_tan_gorilla_man.sql
0007_tired_wallop.sql
0008_cultured_rage.sql
0009_bored_vertigo.sql
0010_trip_day_planner.sql
0011_journey_stops.sql
0011_today_command.sql        <- duplicate "0011" slot
0012_trip_workspace_rls.sql
0013_trip_invite_roles.sql
0014_trip_member_state.sql
```

- `packages/db/drizzle/meta/_journal.json:1-91` (full file) — 12 entries, `idx` sequence is `0,1,2,3,4,5,6,7,8,9,11,12`. There is no entry for `0010_trip_day_planner`, no entry for `0011_today_command` (only `0011_journey_stops` occupies idx 11), no entry for `0013_trip_invite_roles`, no entry for `0014_trip_member_state`:

```json
    {
      "idx": 9,
      "version": "7",
      "when": 1782149774199,
      "tag": "0009_bored_vertigo",
      "breakpoints": true
    },
    {
      "idx": 11,
      "version": "7",
      "when": 1783869000000,
      "tag": "0011_journey_stops",
      "breakpoints": true
    },
    {
      "idx": 12,
      "version": "7",
      "when": 1783972360070,
      "tag": "0012_trip_workspace_rls",
      "breakpoints": true
    }
  ]
}
```

- `packages/db/drizzle/meta/` file listing — snapshots only go up to `0009_snapshot.json`; there is **no** `0010_snapshot.json` through `0014_snapshot.json`, despite the journal (above) already referencing idx 11 and 12:

```
0000_snapshot.json … 0009_snapshot.json   (10 files)
_journal.json
```

- Snapshot chain identity, read directly from the JSON (`id`/`prevId` form a linked list drizzle-kit uses to validate ordering):
  - `0000_snapshot.json`: `id=8e0b8ec8-...`, `prevId=00000000-0000-0000-0000-000000000000`
  - `0009_snapshot.json`: `id=637a692a-7a39-47b2-b670-19480a44dbd8`, `prevId=cf80ff20-35b2-4ec9-bf2e-cf0d96d128f0`
  - The chain has no continuation past `0009` on disk, even though 6 more migrations exist (`0010`–`0014` plus the renumbered duplicate).

- `packages/db/drizzle/0010_trip_day_planner.sql:1-25` — creates `trip_day` (FK to `trip`, FK to `trip_segment`):

```sql
CREATE TABLE "trip_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"date" date NOT NULL,
	...
	CONSTRAINT "trip_day_trip_date_unique" UNIQUE("trip_id","date")
);
```

- `packages/db/drizzle/0011_today_command.sql:1-6` (full file) — depends on `trip_day` existing, i.e. must run after `0010`:

```sql
ALTER TABLE "trip" ADD COLUMN "run_state" text DEFAULT 'on_plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "run_state_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip" ADD COLUMN "run_state_note" varchar(500);--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "status" text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_day" ADD COLUMN "actual_note" varchar(500);
```

- `packages/db/drizzle/0013_trip_invite_roles.sql:1` (full file):

```sql
ALTER TABLE "trip_invite" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;
```

- `packages/db/drizzle/0014_trip_member_state.sql:1-12` (full file) — creates `trip_member_state`, FK to `trip` and `user`:

```sql
CREATE TABLE "trip_member_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
...
CREATE UNIQUE INDEX "trip_member_state_trip_user_unique" ON "trip_member_state" USING btree ("trip_id","user_id");
```

- Corroboration these tables are real, live parts of the current schema (`packages/db/src/schema.ts`), not dead SQL: `tripDayStatusEnum` (line 27), `runState`/`runStateSince`/`runStateNote` fields on the `trip` table (lines 229-231), `tripMemberState = pgTable("trip_member_state", ...)` (lines 262-281), `tripDays = pgTable("trip_day", ...)` (lines 1567-1610).

- `packages/db/package.json:44-52` — the relevant scripts:

```json
"generate": "pnpm with-env drizzle-kit generate",
"migrate": "pnpm with-env drizzle-kit migrate",
"push": "pnpm with-env drizzle-kit push",
"check": "pnpm with-env drizzle-kit check",
```

- `packages/db/drizzle.config.ts:1-15` (full file) — no custom `migrationsTable`/`migrationsSchema` override, so drizzle-orm's default applied-migrations tracking table (`drizzle.__drizzle_migrations`, hash = sha256 of the `.sql` file's content) applies. **Not independently verified from installed source** — `node_modules` is not installed in this worktree — flagged as an investigation item in Step 2 below rather than asserted as fact.

- `.github/workflows/migrations.yml:63-91` (full `validate-migrations` job) — runs `drizzle-kit check` but the failure path is a warning, not a build failure:

```yaml
      - name: Validate migration integrity
        working-directory: packages/db
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          # Run drizzle-kit check to validate migrations
          pnpm with-env drizzle-kit check 2>&1 || {
            echo "::warning::Migration validation returned non-zero exit code"
            echo "This may indicate schema drift or migration issues"
          }
```

  Contrast with the sibling `check-migrations` job in the same file (`migrations.yml:49-61`), which already fails hard (`exit 1`) on drift — the fix should match that existing house style.

- `docker-compose.yml:5-18` — a local Postgres 16 service (`postgres:5432`, user/pass `postgres`, db `gmacko_dev`) is available for disposable local verification without touching any shared environment.

- History context (not required for the fix, useful for risk framing): `git log --oneline -- packages/db/drizzle/meta/_journal.json` shows the journal was last touched in commit `f340b3a` ("feat: offline packs, dual candidates, rooms polish, RLS" — the same commit that added `0012_trip_workspace_rls.sql`), and per-migration commits are identifiable: `934303e` (0010, multi-day itinerary), the journey-stops feature commit (0011_journey_stops), `f86577b` (0011_today_command, "Today Command + reality replan"), `f340b3a` (0012, RLS), `5386d44` (0013, magic link invites), `aadef56` (0014, dashboard UI state persistence). These are useful if Step 3's snapshot reconstruction needs to check out schema.ts at each historical point.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Local disposable DB | `docker compose up -d postgres` then `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gmacko_dev pnpm -F @sortey/db check` (or export `DATABASE_URL` into `.env` per `with-env`) | container healthy; command runs (exit code is the thing under test) |
| Check migration/schema drift | `pnpm --filter @sortey/db check` (= `pnpm -F @sortey/db check`) | exit 0, "No schema changes" / no drift once fixed |
| Apply journal to a DB | `pnpm --filter @sortey/db migrate` | exit 0, all 16 migrations recorded in `drizzle.__drizzle_migrations` |
| Generate (diff schema.ts vs. last snapshot) | `pnpm --filter @sortey/db generate` | after the fix, should produce an **empty** diff (no new `.sql`) — see Step 4 |
| Typecheck | `pnpm -F @sortey/db typecheck` | exit 0 |
| Tests | `pnpm -F @sortey/db test` | exit 0 (package currently has `--passWithNoTests`) |
| Inspect a live DB's actual tables (for the STOP-condition check) | `psql "$DATABASE_URL" -c "\dt trip_day trip_member_state"` and `psql "$DATABASE_URL" -c "\d trip_invite"` (look for `role` column) | tells you whether a target environment already has these objects outside of `migrate`'s tracking |

## Scope

**In scope** (the only files you should modify/create):
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/drizzle/meta/*_snapshot.json` (new files for the reconciled idx range; existing `0000`–`0009` must NOT change)
- `packages/db/drizzle/0011_today_command.sql` → renamed (see Step 3)
- `.github/workflows/migrations.yml` (the `validate-migrations` job only)

**Out of scope** (do NOT touch):
- The SQL content of any existing migration file (`0000`–`0010`, `0011_journey_stops`, `0012`, `0013`, `0014`) — only the duplicate-slot file gets renamed, and only its filename/journal tag, never its SQL body (the sha256 hash used for applied-migration tracking is computed from file content, not filename, so a rename alone does not change what "already applied" means for that migration).
- `packages/db/src/schema.ts` — this plan reconciles metadata to match the schema that already exists; it does not change the schema.
- The `check-migrations` job in `migrations.yml` (already fails hard correctly; leave as-is).
- Any actual database — this plan does not run `migrate` against any shared/deployed environment. It specifies the procedure and STOP conditions; the operator decides when/where to actually run `migrate` after this plan's changes are reviewed.

## Git workflow

- Branch: `advisor/001-fix-migration-journal`
- Commits: suggest splitting as `fix(db): reconcile drizzle migration journal and snapshot chain` + `ci(migrations): fail validate-migrations on drizzle-kit check drift`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Reproduce the bug against a disposable DB (no fix yet)

1. `docker compose up -d postgres` and wait for healthy (`docker compose ps`).
2. Point `DATABASE_URL` at a throwaway database on that instance (e.g. `postgresql://postgres:postgres@localhost:5432/gmacko_journal_repro` — create the DB first with `createdb`/`psql -c "CREATE DATABASE gmacko_journal_repro"`).
3. Run `pnpm --filter @sortey/db migrate` against the empty DB.
4. Confirm the bug: `psql "$DATABASE_URL" -c "\dt"` should show `journey_stop` and the RLS-covered tables, but **not** `trip_day` or `trip_member_state`; `psql "$DATABASE_URL" -c "\d trip_invite"` should **not** show a `role` column.

**Verify**: the missing objects above are confirmed absent — this is the bug this plan fixes. Drop the throwaway DB when done (`dropdb gmacko_journal_repro`) or keep it for Step 5's re-test.

### Step 2: Investigate drizzle-kit's snapshot requirement (uncertainty this plan must resolve empirically)

The `Current state` section above establishes that snapshots for idx 10-14 are missing from `meta/` even though idx 11-12 are already journaled. Before choosing how much of the snapshot chain to reconstruct, determine what `drizzle-kit` actually requires:

1. On the **current, unmodified** worktree (journal still broken, do not fix yet), run `pnpm --filter @sortey/db check` against the Step 1 disposable DB (any state) and `pnpm --filter @sortey/db generate --name investigate_snapshot_gap` in a scratch copy of `packages/db` (copy the whole `packages/db` directory to `/tmp` first — do not run `generate` in the real worktree, it would write a real migration file).
2. Observe whether either command errors with an `ENOENT` / "cannot find module" / JSON parse error referencing a specific missing `NNNN_snapshot.json` path, or whether it runs (successfully or with a schema-drift result) using only the **last** journaled snapshot.
3. Record the finding in your report:
   - If drizzle-kit only ever reads the snapshot matching the journal's **last** entry to diff against `schema.ts`, then Step 4 below (single reconciling `generate`) will work once Step 3 lands, and only a final synthesized snapshot is strictly required.
   - If drizzle-kit errors trying to load an intermediate snapshot (e.g. `0011_snapshot.json`, which doesn't exist despite idx 11 already being journaled today), that is itself evidence the journal has been broken for a while in a way that already blocks `generate`/`check` today, and Step 3 must synthesize **every** missing snapshot in the 10-15 range (not just the final one), using the historical-commit reconstruction procedure in Step 3's note.

**Verify**: this step produces a written finding (ENOENT-on-intermediate vs. only-last-snapshot-needed) that determines whether Step 4 needs the light path (synthesize only the final snapshot) or the heavy path (synthesize every missing snapshot 0010-0015). Do not proceed to Step 3 until this is recorded.

### Step 3: Resolve the duplicate `0011` slot and reconcile `_journal.json`

1. Rename the file, preserving its exact SQL content: `git mv packages/db/drizzle/0011_today_command.sql packages/db/drizzle/0015_today_command.sql`. Do not edit the file's contents — the applied-migration hash is computed from content, and this migration must remain equivalent to whatever (if anything) has already been hash-tracked for it in any environment.

   Why idx 15 (append at the end) rather than some other free slot: `0015_today_command`'s SQL (`ALTER TABLE "trip_day" ADD COLUMN ...`) requires `trip_day` to already exist, which only happens once `0010_trip_day_planner` has run. Appending it after every other pending entry (10, 11, 12, 13, 14) trivially satisfies that ordering constraint without needing to interleave it between existing, already-journaled entries 11/12 — which stay untouched.

2. Rewrite `packages/db/drizzle/meta/_journal.json` so `entries` is exactly, in this order:
   - idx 0-9: unchanged (byte-identical to current file — do not regenerate `when`/`tag` for these)
   - idx 10: new entry, `"tag": "0010_trip_day_planner"`, `"when"`: pick a timestamp between idx 9's (`1782149774199`) and idx 11's (`1783869000000`) `when` values, consistent with `0010` having been authored before `0011_journey_stops` per the commit history in `Current state` (e.g. `1783000000000` — exact value is not semantically load-bearing to drizzle-kit, only relative journal order is, but keep it monotonic and in the same millisecond-epoch style as neighboring entries)
   - idx 11: unchanged (`0011_journey_stops`, `when: 1783869000000`)
   - idx 12: unchanged (`0012_trip_workspace_rls`, `when: 1783972360070`)
   - idx 13: new entry, `"tag": "0013_trip_invite_roles"`, `"when"` after idx 12's
   - idx 14: new entry, `"tag": "0014_trip_member_state"`, `"when"` after idx 13's
   - idx 15: new entry, `"tag": "0015_today_command"` (matches the renamed file), `"when"` after idx 14's — this is the entry for the file moved in sub-step 1
   - Every new entry: `"version": "7"`, `"breakpoints": true` (match the existing entries' shape exactly).

**Verify**: `python3 -c "import json; j=json.load(open('packages/db/drizzle/meta/_journal.json')); idxs=[e['idx'] for e in j['entries']]; assert idxs == list(range(16)), idxs; print('OK', len(idxs), 'entries')"` → prints `OK 16 entries`. Also `ls packages/db/drizzle/*.sql | wc -l` → `16`, and every journal `tag` has a matching `<tag>.sql` file: `python3 -c "import json,os; j=json.load(open('packages/db/drizzle/meta/_journal.json')); missing=[e['tag'] for e in j['entries'] if not os.path.exists(f\"packages/db/drizzle/{e['tag']}.sql\")]; assert not missing, missing; print('all tags have files')"`.

### Step 4: Reconstruct the snapshot chain (branches on Step 2's finding)

**Light path** (only the final snapshot is required by drizzle-kit):

1. Copy `packages/db` to a scratch directory (e.g. the scratchpad), so `generate` cannot write into the real worktree.
2. In the scratch copy, with the Step 3 journal/file changes present, run `pnpm --filter @sortey/db generate` (adjust the path/filter for the scratch copy) pointed at a `DATABASE_URL` that is irrelevant to the diff (generate does not need a live DB connection for the diff itself, only for config loading — confirm this empirically as part of the run; if it errors demanding a reachable DB, point it at the Step 1 disposable container instead).
3. Because `schema.ts` was not changed and already reflects everything through `0015_today_command`, the expected, **required** result is an empty (or near-empty) generated migration — i.e. drizzle-kit finds no diff between `schema.ts` and the reconstructed-journal state. If it generates a non-trivial `.sql` file, STOP (see STOP conditions) — that means `schema.ts` has drifted from the migrations in ways this plan did not account for, and blindly accepting the fix could hide real schema drift.
4. Copy the generated snapshot JSON (idx 16 in the scratch run) back into the real `packages/db/drizzle/meta/` as `0016_snapshot.json`, and discard the generated (empty) `.sql`/journal-entry — do not journal a real "idx 16" migration for an empty diff; instead hand-copy just the snapshot content into a properly named `0015_snapshot.json` that closes out the chain matching journal idx 15. Adjust `prevId` linkage manually if needed so it chains from whatever `id` your idx-14-equivalent state produced (see the heavy path if this bookkeeping gets confusing — it likely will, given no true idx-10-14 snapshots exist to chain from).

**Heavy path** (drizzle-kit errors on missing intermediate snapshots):

1. For each of idx 10, 13, 14, and 15 (in that order — 11 and 12 already have SQL+journal, just no snapshot; include them too if Step 2 showed they're required and currently missing), check out `packages/db/src/schema.ts` (and `auth-schema.ts`) at the historical commit identified in `Current state` that introduced that migration (`934303e` for 0010, the journey-stops commit for 0011, `f340b3a` for 0012, `5386d44` for 0013, `aadef56` for 0014, `f86577b` for 0015/`0011_today_command`).
2. In a scratch copy of `packages/db` seeded with the snapshot chain reconstructed so far (starting from the real `0009_snapshot.json`), run `drizzle-kit generate` against that historical `schema.ts` and confirm the generated `.sql` matches (semantically — column/table/constraint set, not necessarily byte-for-byte formatting) the already-committed migration file for that slot.
3. Copy the resulting snapshot into `packages/db/drizzle/meta/000N_snapshot.json` for that idx, and move to the next historical commit.
4. Repeat until the chain reaches the current `schema.ts` (idx 15). The final snapshot should show zero diff against the current worktree's `schema.ts`, same check as the light path's step 3.

**Verify** (either path): `pnpm --filter @sortey/db check` against the Step 1 disposable DB (freshly migrated with the corrected journal — see Step 5) exits 0 with no reported drift. `ls packages/db/drizzle/meta/*_snapshot.json | wc -l` equals the number of journal entries (16, or 17 if a genuinely-empty confirmation migration was journaled instead of hand-folded — prefer NOT journaling a synthetic empty migration; keep the journal exactly matching the 16 real files from Step 3).

### Step 5: Full re-test against a fresh DB

1. Drop and recreate the Step 1 disposable database (or make a new one) so it is completely empty.
2. `pnpm --filter @sortey/db migrate` → exit 0, and it should now apply all 16 migrations in order (watch the output list `0010_trip_day_planner`, `0011_journey_stops`, `0012_trip_workspace_rls`, `0013_trip_invite_roles`, `0014_trip_member_state`, `0015_today_command`).
3. `psql "$DATABASE_URL" -c "\dt trip_day trip_member_state journey_stop"` → all three present. `psql "$DATABASE_URL" -c "\d trip_invite"` → `role` column present.
4. `pnpm --filter @sortey/db check` → exit 0, no drift reported.

**Verify**: all four sub-checks above pass. This is the core regression test for the bug this plan fixes — a fresh `migrate` now produces a schema matching `schema.ts`.

### Step 6: Make CI fail on migration validation drift

Edit `.github/workflows/migrations.yml:82-91` (the `validate-migrations` job's `Validate migration integrity` step) from the warning-swallowing form to a hard failure, matching the sibling `check-migrations` job's style (`migrations.yml:49-60`):

```yaml
      - name: Validate migration integrity
        working-directory: packages/db
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          # Run drizzle-kit check to validate migrations; fail the build on drift
          # (this is the check that would have caught the missing-journal-entries bug)
          pnpm with-env drizzle-kit check
```

Removing the `2>&1 || { echo "::warning..."; }` wrapper is sufficient — a non-zero exit from `drizzle-kit check` will now fail the step naturally (same mechanism the `check-migrations` job already relies on). Keep the explanatory comment so a future reader knows why this step exists and is intentionally strict.

**Verify**: `grep -n "drizzle-kit check" .github/workflows/migrations.yml` shows the bare command with no trailing `|| { ... }` warning suppression. If you have `act` or another local GitHub Actions runner available, optionally dry-run the job; otherwise this is verified by inspection plus the fact that Step 5 already proved `drizzle-kit check` exits 0 post-fix (so the newly-strict CI step will pass on this branch) and would have exited non-zero pre-fix (so it would have caught the original bug).

## Test plan

- Step 1 reproduces the bug on a disposable local Postgres (via `docker-compose.yml`'s `postgres` service) — never against a shared environment.
- Step 5 is the regression test: fresh DB + `migrate` + `check`, confirming all 16 migrations apply and `schema.ts` matches the result.
- No `@sortey/db` unit tests exist for migration metadata (`vitest run --passWithNoTests`); this plan does not add any, since the correctness surface here is drizzle-kit's own journal/snapshot format, not application code. `pnpm -F @sortey/db typecheck` and `pnpm -F @sortey/db test` should still both exit 0 after this change (nothing in scope touches `src/`).

## Done criteria

- [ ] `packages/db/drizzle/meta/_journal.json` has exactly 16 entries, `idx` 0-15 contiguous, each `tag` matching an existing `.sql` file in `packages/db/drizzle/`
- [ ] `0011_today_command.sql` renamed to `0015_today_command.sql` with byte-identical SQL content (`git diff --stat` on the rename shows a pure rename, no content change)
- [ ] `packages/db/drizzle/meta/` has a snapshot file for every journaled idx (or documented rationale in the commit message if the light path in Step 4 determined intermediate snapshots are not required by the installed drizzle-kit version)
- [ ] Step 5's fresh-DB `migrate` + `check` both pass against a disposable local Postgres
- [ ] `.github/workflows/migrations.yml`'s `validate-migrations` job fails (non-zero) on `drizzle-kit check` drift instead of emitting a warning
- [ ] `pnpm -F @sortey/db typecheck` and `pnpm -F @sortey/db test` exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] Report explicitly states, per environment the operator names (dev/staging/prod), whether Step 1's STOP-condition check (below) was run against a clone of that environment before recommending `migrate` be run there

## STOP conditions

Stop and report back (do not improvise) if:

- Step 2's investigation shows `drizzle-kit generate`/`check` cannot run at all against the current worktree even before this plan's changes (a deeper drizzle-kit version/config incompatibility, not just the missing journal entries) — that needs its own diagnosis before this plan's fix can be verified.
- Step 4's reconciling `generate` run (light or heavy path) produces a **non-empty** diff against the current `schema.ts` — this means `schema.ts` has changes not captured by any existing `.sql` file, i.e. real undocumented schema drift beyond the journal bug. Do not fold an unexpected diff into this plan's fix silently; report the exact diff.
- Before running `migrate` with the corrected journal against **any** shared environment (dev/staging/prod, or any environment the operator did not explicitly designate as disposable), you have not confirmed via `psql \dt` / `\d trip_invite` (or `drizzle-kit check` against a clone of that environment's DB) whether `trip_day`, `trip_member_state`, or `trip_invite.role` already exist there from a prior `push` or manual `psql` session. If they already exist but were never hash-tracked by `migrate` (likely, since they were never journaled until this plan), running `migrate` there will attempt `CREATE TABLE`/`ALTER TABLE ADD COLUMN` against objects that already exist and fail loudly (Postgres "already exists" error) — safe in the sense of not silently corrupting data, but it will block a deploy. Get an explicit go-ahead from the operator naming which environment, after checking, before running `migrate` anywhere but the disposable Step 1/5 database.
- Any existing, already-journaled entry's `tag`, `when`, or `idx` (0-9, 11, 12) would need to change to make the fix work — those are believed to already be relied upon by hash-tracking in real environments and must not move.

## Maintenance notes

- The root cause this plan doesn't fix by itself: nothing currently forces a contributor to run `pnpm --filter @sortey/db generate` (which keeps journal + snapshot + SQL in lockstep) instead of hand-writing/copy-pasting a numbered `.sql` file into `packages/db/drizzle/` and forgetting to update `_journal.json`. The CI fix in Step 6 is the safety net (it will now fail loudly the next time this happens), but consider a lighter-weight pre-commit or `check-migrations`-job addition that specifically asserts `ls drizzle/*.sql | wc -l` equals the journal's entry count, for a faster/cheaper signal than a full `drizzle-kit check` DB round-trip.
- If Step 4 took the "heavy path," the reconstructed intermediate snapshots (0010, 0013, 0014) are best-effort archaeology, not drizzle-kit's own original output — note this explicitly in the commit message so a future `drizzle-kit up` (schema-version migration for the snapshot format itself) doesn't get confused by any small formatting differences from a "real" drizzle-kit `generate` run.
- Once this lands, the very next real schema change should go through `pnpm --filter @sortey/db generate` normally and be spot-checked (`pnpm --filter @sortey/db check`) before merge, to confirm the reconciled chain behaves normally going forward.

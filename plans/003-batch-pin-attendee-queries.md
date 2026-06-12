# Plan 003: Replace the per-pin attendee queries in pins.list and pins.listForTimeline with single batched queries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ba3457d..HEAD -- packages/api/src/router/pins.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (query restructuring with identical output shape)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ba3457d`, 2026-06-12

## Why this matters

`pins.list` issues one `COUNT` query per pin and `pins.listForTimeline` issues
one attendee-list query per pin. These feed the map and timeline views of the
dashboard, which re-fetch on edits. A trip with 50 pins costs 50+ database
round trips per render instead of 2. The `list` code even carries a
"Batch-load attendee counts" comment above a loop that does the opposite.

## Current state

Relevant file:

- `packages/api/src/router/pins.ts` — pins router. Two N+1 sites: the
  attendee-count loop in `list` (lines ~59–71) and the attendee-list loop in
  `listForTimeline` (lines ~410–424).

Site 1 as it exists today (`pins.ts:59-71`):

```ts
      // Batch-load attendee counts
      const pinIds = rows.map((r) => r.id);
      const attendeeCounts = new Map<string, number>();

      if (pinIds.length > 0) {
        for (const pin of rows) {
          const countResult = (await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(pinAttendees)
            .where(eq(pinAttendees.pinId, pin.id))) as Array<{
            count: number;
          }>;
          attendeeCounts.set(pin.id, countResult[0]?.count ?? 0);
        }
      }
```

Site 2 as it exists today (`pins.ts:410-424`):

```ts
      // Load attendees for each pin
      const result = [];
      for (const pin of rows) {
        const attendees = (await ctx.db
          .select({ userId: pinAttendees.userId })
          .from(pinAttendees)
          .where(eq(pinAttendees.pinId, pin.id))) as Array<{
          userId: string;
        }>;
        result.push({
          ...pin,
          attendees: attendees.map((a) => a.userId),
        });
      }

      return result;
```

The batched-query convention used elsewhere in this repo is
`inArray(table.column, ids)` — see `packages/api/src/router/expenses.ts:212-221`
(claims loaded for many line items in one query). Check the imports at the top
of `pins.ts`: ensure `inArray` is imported from `"@sortey/db"` (add it to the
existing import if missing); `sql` is already imported (used by site 1).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `pnpm install`                   | exit 0              |
| Typecheck | `pnpm -F @sortey/api typecheck`  | exit 0, no errors   |
| Tests     | `pnpm -F @sortey/api test`       | all pass            |
| Lint      | `pnpm -F @sortey/api lint`       | exit 0              |

## Scope

**In scope** (the only file you should modify):
- `packages/api/src/router/pins.ts` (the two loops above only)

**Out of scope** (do NOT touch, even though they look related):
- `setAttendees` (lines ~283–295) — its missing transaction is a separately
  tracked finding; do not bundle it here.
- The pin edit-lock procedures.
- Response shapes of `list` and `listForTimeline` — the dashboard and expo
  apps consume them as-is.
- Adding a test harness for the pins router (see Test plan).

## Git workflow

- Branch off the current branch; name like `advisor/003-pins-batch-attendees`.
- Commit style: conventional commits, e.g.
  `perf(api): batch pin attendee queries (1 query instead of N per list)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Batch the count query in `list`

Replace the loop at site 1 with a single grouped query:

```ts
      const pinIds = rows.map((r) => r.id);
      const attendeeCounts = new Map<string, number>();

      if (pinIds.length > 0) {
        const countRows = (await ctx.db
          .select({
            pinId: pinAttendees.pinId,
            count: sql<number>`count(*)::int`,
          })
          .from(pinAttendees)
          .where(inArray(pinAttendees.pinId, pinIds))
          .groupBy(pinAttendees.pinId)) as Array<{
          pinId: string;
          count: number;
        }>;
        for (const row of countRows) {
          attendeeCounts.set(row.pinId, row.count);
        }
      }
```

Pins with zero attendees simply won't appear in `countRows`; the existing
consumer already falls back via `attendeeCounts.get(pin.id) ?? 0` semantics —
confirm the lines just below the loop use a `?? 0` fallback (they do at
`pins.ts:74` area: `attendeeCount: attendeeCounts.get(pin.id) ?? 0`); if not,
add the fallback.

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 2: Batch the attendee-list query in `listForTimeline`

Replace the loop at site 2 with one query + in-memory grouping:

```ts
      const pinIds = rows.map((r) => r.id);
      const attendeesByPin = new Map<string, string[]>();

      if (pinIds.length > 0) {
        const attendeeRows = (await ctx.db
          .select({ pinId: pinAttendees.pinId, userId: pinAttendees.userId })
          .from(pinAttendees)
          .where(inArray(pinAttendees.pinId, pinIds))) as Array<{
          pinId: string;
          userId: string;
        }>;
        for (const row of attendeeRows) {
          const existing = attendeesByPin.get(row.pinId) ?? [];
          existing.push(row.userId);
          attendeesByPin.set(row.pinId, existing);
        }
      }

      return rows.map((pin) => ({
        ...pin,
        attendees: attendeesByPin.get(pin.id) ?? [],
      }));
```

Preserve the existing ordering of `rows` (the query's `orderBy` handles pin
order; attendee order within a pin is not contractual today — a per-pin loop
returned insertion order, the batched version returns table order; if a test
or consumer depends on attendee ordering, STOP).

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0.

### Step 3: Full check

**Verify**: `pnpm -F @sortey/api test` → all pass (no existing pins tests
should break — there are none; the suite guards against accidental damage
elsewhere). Then `pnpm -F @sortey/api lint` → exit 0.

## Test plan

No new tests in this plan, deliberately: the pins router has no existing test
harness, both changes are pure query restructurings with unchanged output
shapes, and building the router's first harness is out of scope here. The
machine checks below (greps proving no awaited query remains inside the loops)
plus typecheck stand in. Follow-up: when a pins test harness is introduced
(see plans/README.md "Findings audited but not yet planned" — guards/e2e test
items), add a call-count batching guard like the one in
`__tests__/settlements.test.ts` case 5 (plan 001).

## Done criteria

- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0
- [ ] `grep -n "for (const pin of rows)" packages/api/src/router/pins.ts` returns no lines containing an `await` in their loop bodies — concretely: the only remaining `await ctx.db` calls in `list` and `listForTimeline` are the batched ones (manually confirm with `grep -n "await ctx.db" packages/api/src/router/pins.ts`)
- [ ] `grep -c "inArray(pinAttendees.pinId" packages/api/src/router/pins.ts` prints `2`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at either site doesn't match the excerpts (drift).
- Drizzle's `.groupBy` is rejected by the installed version's types for this
  query shape (don't fight the types with casts beyond the file's existing
  `as Array<...>` convention).
- Any consumer demonstrably depends on attendee ordering within a pin.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- If pagination is added to `pins.list`, the batching still holds (it keys off
  the returned page's ids).
- Reviewer: check the `?? 0` / `?? []` fallbacks — pins with no attendees must
  not disappear or throw.
- The same `inArray` batching pattern should be the default for any new
  "list with children" endpoint in this codebase.

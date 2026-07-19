# Plan 006: Server-side idempotency for expense/fuel-log/pin creation so offline retries don't create duplicate money rows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` if that file exists; otherwise leave a short
> status note in your final report and do not create the file yourself.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- apps/expo/src/utils/use-outbox-sync.ts packages/api/src/router/fuel-logs.ts packages/api/src/router/expenses.ts packages/api/src/router/pins.ts packages/api/src/expenses/transport-draft.ts packages/db/src/schema.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches money-bearing insert paths + a schema migration)
- **Depends on**: none
- **Category**: bug / correctness
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

The Expo app queues expense, pin, and fuel-log writes offline and replays them
when connectivity returns (`apps/expo/src/utils/use-outbox-sync.ts`). Every
outbox command already carries a client-generated `clientId` — but
`useOutboxSync` **strips it before sending** to the three creation mutations,
and none of those mutations (`expenses.create`, `pins.create`,
`fuelLogs.create`) has any notion of an idempotency key. If a mutation's
response is lost after the server committed it (flaky mobile network, app
backgrounded mid-request, process killed before the local ack), the outbox
entry stays `pending`/`failed` and the *next* flush resends the exact same
command. Today that produces a second expense, pin, or fuel log — silently
duplicated money and map data, with no way to tell which one is real.

The codebase already has two working precedents for exactly this problem:
`settlements.record` dedupes on a required `idempotencyKey` column via
`onConflictDoNothing` + a fallback select, and `journey.logStop` dedupes on a
client-supplied primary key (`stopId`). This plan extends the same pattern —
optional, nullable `clientId` — to the three mutations that don't have it,
and fixes the client to stop discarding the id it already generates.

This plan is server + schema only. It does not touch the outbox's own bugs
(lost writes on concurrent enqueue/flush, non-atomic ack, unbounded retries,
corrupt-storage handling) — those are `plans/hardening/007-outbox-hardening-and-unify.md`,
which depends on this plan for its primary duplicate-write guard.

## Current state

### The client already generates `clientId` and then throws it away

`apps/expo/src/utils/use-outbox-sync.ts` (full file is 125 lines):

```ts
// lines 36-62 — fuel
await fuelOutbox.flush((command) => {
  const {
    clientId: _clientId,
    workspaceId,
    tripId,
    ...rest
  } = command;
  return trpcClient.fuelLogs.create.mutate({
    workspaceId,
    tripId,
    gallons: rest.gallons,
    pricePerGallon: rest.pricePerGallon,
    totalCents: rest.totalCents,
    fuelType: rest.fuelType,
    loggedAt: rest.loggedAt,
    odometerMiles: rest.odometerMiles,
    segmentId: rest.segmentId,
    vanProfileId: rest.vanProfileId,
    stationName: rest.stationName,
    stationLat: rest.stationLat,
    stationLng: rest.stationLng,
    isCostco: rest.isCostco ?? false,
    notes: rest.notes,
    currency: rest.currency ?? "USD",
    splitWithGroup: rest.splitWithGroup ?? false,
  });
});

// lines 63-80 — expense
await captureOutbox.flush(async (command) => {
  if (command.kind === "expense.create") {
    const { clientId: _c, kind: _k, ...rest } = command;
    return trpcClient.expenses.create.mutate({
      workspaceId: rest.workspaceId,
      tripId: rest.tripId,
      segmentId: rest.segmentId,
      merchant: rest.merchant,
      occurredAt: rest.occurredAt,
      category: rest.category ?? "general",
      currency: rest.currency ?? "USD",
      subtotalCents: rest.subtotalCents ?? 0,
      taxCents: rest.taxCents ?? 0,
      tipCents: rest.tipCents ?? 0,
      totalCents: rest.totalCents ?? 0,
      notes: rest.notes,
    });
  }
  // lines 81-108 — pin
  const { clientId: _c, kind: _k, ...rest } = command;
  return trpcClient.pins.create.mutate({
    workspaceId: rest.workspaceId,
    tripId: rest.tripId,
    segmentId: rest.segmentId,
    title: rest.title,
    type: rest.type as (... pin type union ...),
    lat: rest.lat,
    lng: rest.lng,
    startsAt: rest.startsAt,
    endsAt: rest.endsAt,
    notes: rest.notes,
  });
});
```

The `_clientId`/`_c` bindings are unused-on-purpose (lint-suppressed discards)
— the value is computed by `createCaptureId()` / `createFuelOutboxId()`
(`apps/expo/src/utils/capture-outbox.ts:8-17`,
`apps/expo/src/utils/fuel-outbox.ts:5-14`) and then never leaves the device.

Contrast with the journey call three lines above (lines 23-35), which is
already correct — it forwards every field including the id:

```ts
await journeyOutbox.flush((command) =>
  trpcClient.journey.logStop.mutate({
    workspaceId: command.workspaceId,
    tripId: command.tripId,
    stopId: command.stopId,
    name: command.name,
    lat: command.lat,
    lng: command.lng,
    arrivedAt: command.arrivedAt,
    kind: command.kind,
    note: command.note,
  }),
);
```

### `journey.logStop`'s dedupe pattern (client-supplied primary key)

`packages/api/src/route-planner/journey-ops.ts:188-217` (`logStopOp`):

```ts
export async function logStopOp(
  dbOrStore: Db | JourneyStore,
  p: LogStopParams,
  routeLegImpl: RouteLeg = routeLeg,
) {
  const store = isJourneyStore(dbOrStore)
    ? dbOrStore
    : createJourneyStore(dbOrStore);
  const existing = await store.findStop(p.tripId, p.stopId);
  if (existing) {
    return {
      stopId: existing.id,
      segmentId: existing.segmentId,
      miles: 0,
      routed: existing.routeStatus === "ready",
      routeStatus: existing.routeStatus,
    };
  }

  return store.transaction(async (tx) => {
    const raced = await tx.findStop(p.tripId, p.stopId);
    if (raced) { /* same short-circuit shape */ }
    ... // insert segment + stop (stop.id = p.stopId, a DB primary key — see
        // packages/db/src/schema.ts:345 `id: t.uuid().notNull().primaryKey()`,
        // no defaultRandom()) + pin, all inside the transaction
  });
}
```

This works because `journeyStops.id` is *not* server-generated — the client
supplies it and it's the primary key, so a retry with the same `stopId`
either short-circuits on the pre-check or collides on `findStop`'s re-check
inside the transaction. `expenses`, `pins`, and `fuelLogs` all use
`.defaultRandom()` ids (server-generated), so this exact shape doesn't apply
directly — the closer precedent is the one below.

### `settlements.record`'s dedupe pattern (separate idempotency column) — the pattern to mirror

Schema, `packages/db/src/schema.ts:591`:

```ts
idempotencyKey: t.varchar({ length: 255 }).notNull().unique(),
```

Router, `packages/api/src/router/settlements.ts:273-342` (`settlements.record`):

```ts
  /**
   * Record a settlement payment between two trip members.
   * Deduplicates on idempotencyKey.
   */
  record: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        fromUserId: z.string().min(1),
        toUserId: z.string().min(1),
        amountCents: z.number().int().positive(),
        idempotencyKey: z.string().min(1).max(255),
        note: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ... member validation ...

      const [created] = (await ctx.db
        .insert(settlements)
        .values({
          tripId: ctx.tripId,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          amountCents: input.amountCents,
          idempotencyKey: input.idempotencyKey,
          note: input.note ?? null,
        })
        .onConflictDoNothing({ target: settlements.idempotencyKey })
        .returning()) as Array<typeof settlements.$inferSelect>;

      // If conflict (duplicate key), return the existing one
      if (!created) {
        const [existing] = (await ctx.db
          .select()
          .from(settlements)
          .where(eq(settlements.idempotencyKey, input.idempotencyKey))
          .limit(1)) as Array<typeof settlements.$inferSelect>;
        return existing!;
      }

      return created;
    }),
```

`expenses.ts` already uses the same `onConflictDoNothing` primitive
elsewhere, for a different purpose (tap-to-claim idempotency, not
create-idempotency) — `packages/api/src/router/expenses.ts:882-890`
(`claimLineItem`):

```ts
      await ctx.db
        .insert(lineItemClaims)
        .values({
          lineItemId: input.lineItemId,
          userId: ctx.session.user.id,
        })
        .onConflictDoNothing({
          target: [lineItemClaims.lineItemId, lineItemClaims.userId],
        });
```

### The three mutations that need it, and their current schema

**`packages/db/src/schema.ts:480-515`** — `expenses` table has no
`clientId`/idempotency column. Primary key `id: t.uuid().notNull().primaryKey().defaultRandom()`
(line 481).

**`packages/db/src/schema.ts:894-923`** — `pins` table, same shape:
`id: t.uuid().notNull().primaryKey().defaultRandom()` (line 895), no
idempotency column.

**`packages/db/src/schema.ts:1401-1430`** — `fuelLogs` table, same shape:
`id: t.uuid().notNull().primaryKey().defaultRandom()` (line 1402), no
idempotency column.

**`packages/api/src/router/expenses.ts:172-254`** — `expenses.create` input
(lines 174-188) has no `clientId`. The insert itself is delegated to
`insertExpenseDraft` (imported from `../expenses/transport-draft`, line 23),
which is also called from the ferry→expense link flow (per its own doc
comment at `packages/api/src/expenses/transport-draft.ts:5-12`: "Shared
draft-expense insert used by BOTH `expenses.create` and the ferry fare→expense
link"). That means the dedupe logic must be conditional on `clientId` being
present — the ferry caller doesn't have one and must keep working unchanged.

```ts
// packages/api/src/expenses/transport-draft.ts:31-61
export async function insertExpenseDraft(
  input: TransportDraftInput,
): Promise<typeof expenses.$inferSelect> {
  const [created] = (await input.db
    .insert(expenses)
    .values({
      tripId: input.tripId,
      segmentId: input.segmentId,
      payerUserId: input.payerUserId,
      merchant: input.merchant,
      category: input.category,
      occurredAt: input.occurredAt,
      currency: input.currency,
      subtotalCents: input.subtotalCents,
      taxCents: input.taxCents,
      tipCents: input.tipCents,
      totalCents: input.totalCents,
      notes: input.notes,
      status: "draft",
    })
    .returning()) as Array<typeof expenses.$inferSelect>;

  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create expense.",
    });
  }

  return created;
}
```

**`packages/api/src/router/pins.ts:79-131`** — `pins.create`, input at lines
81-93, insert at lines 114-128. No `clientId`, no shared helper (insert is
inline in the router).

**`packages/api/src/router/fuel-logs.ts`** — `fuelLogs.create` (router
mutation, lines 297-344) delegates to `createFuelLogWithSplit` (lines
171-262), which calls the injected `FuelLogStore.insertFuelLog` (interface at
lines 26-44, DB implementation at lines 68-80):

```ts
// lines 68-80
insertFuelLog: async (values) => {
  const [created] = (await db
    .insert(fuelLogs)
    .values(values)
    .returning()) as FuelLogRow[];
  if (!created) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to log fuel.",
    });
  }
  return created;
},
```

`createFuelLogWithSplit` (lines 171-262) always inserts the fuel log first,
then — if `splitWithGroup` — resolves a segment and calls
`store.insertExpense` to create a *second*, linked money row (a `fuel`
category expense split across trip members), then links it back via
`store.linkExpenseToFuelLog`. A naive retry-safe fix that only dedupes the
fuel log row would still let the split expense be created twice on a retry.
The fix must make the whole orchestration idempotent, not just the insert.

### The outbox commands already have the ids to send

`apps/expo/src/utils/capture-outbox.ts:19-58` — `ExpenseCaptureCommand` and
`PinCaptureCommand` both have `clientId: string` (lines 21, 45).
`apps/expo/src/utils/fuel-outbox.ts:16-35` — `FuelLogCommand` has
`clientId: string` (line 17). These are stable across retries: `enqueue()`
dedupes the *local* queue by `command.clientId` (e.g.
`apps/expo/src/utils/fuel-outbox.ts:70-88`), so the same clientId is reused
for every retry of the same logical write until it succeeds.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API typecheck | `pnpm -F @sortey/api typecheck` | exit 0, no errors |
| API tests | `pnpm -F @sortey/api test` | exit 0, all pass |
| Expo typecheck | `pnpm -F @sortey/expo typecheck` | exit 0, no errors |
| DB migration generate | `pnpm -F @sortey/db generate` | exit 0; new file `packages/db/drizzle/00NN_*.sql` |
| Grep check (post-change) | `grep -n "clientId: _c\|clientId: _clientId" apps/expo/src/utils/use-outbox-sync.ts` | no matches |

`pnpm -F @sortey/db generate` requires `DATABASE_URL` (see
`packages/db/package.json`'s `"generate": "pnpm with-env drizzle-kit generate"`
and `packages/db/drizzle.config.ts`, which throws if `DATABASE_URL` is unset).
If it's not available in your environment, see STOP conditions — do not
hand-edit `packages/db/drizzle/meta/_journal.json` or the snapshot JSON files
to fake a migration.

## Scope

**In scope**:
- `packages/db/src/schema.ts` — add `clientId` column to `expenses`, `pins`,
  `fuelLogs`.
- `packages/db/drizzle/*.sql` + `packages/db/drizzle/meta/*` — new migration
  generated by drizzle-kit (do not hand-write).
- `packages/api/src/router/expenses.ts` — `create` input + mutation.
- `packages/api/src/expenses/transport-draft.ts` — `insertExpenseDraft`
  (add optional `clientId`, keep the ferry caller's behavior unchanged).
- `packages/api/src/router/pins.ts` — `create` input + mutation.
- `packages/api/src/router/fuel-logs.ts` — `FuelLogStore.insertFuelLog`
  interface + DB impl, `createFuelLogWithSplit`, `create` input + mutation.
- `apps/expo/src/utils/use-outbox-sync.ts` — stop stripping `clientId` on
  all three mutate calls.
- New/updated tests: `packages/api/src/router/__tests__/expenses.test.ts`,
  `packages/api/src/router/__tests__/fuel-logs.test.ts`, a new
  `packages/api/src/router/__tests__/pins.test.ts`.

**Out of scope** (do NOT touch, even though they look related):
- `apps/expo/src/utils/{capture,fuel,journey}-outbox.ts` and
  `use-outbox-sync.ts`'s journey call — outbox internals (lost writes,
  non-atomic ack, retry-forever, corrupt storage) are
  `plans/hardening/007-outbox-hardening-and-unify.md`.
- `packages/api/src/route-planner/journey-ops.ts` — already idempotent, not
  touched.
- `settlements.ts` — cited as a pattern, not modified.
- Any RLS / migration for tables other than `expense`, `pin`, `fuel_log`.
- Backfilling `clientId` for existing rows — new column is nullable, no
  backfill needed.

## Git workflow

- Branch: from wherever this plan is executed (this repo's plans don't
  prescribe a branch-per-plan convention beyond what `git log` shows —
  conventional-commit style messages, e.g. `fix(api): dedupe expense/pin/fuel-log creation by clientId`).
- Commit per logical step (schema+migration; expenses; pins; fuel-logs;
  outbox-sync client fix; tests) is fine, or one commit — match whatever the
  rest of the branch's history looks like at execution time.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `clientId` to the three tables

In `packages/db/src/schema.ts`, add a nullable, globally-unique `clientId`
column to each table, following the exact shorthand `settlements.idempotencyKey`
uses (`t.varchar({ length: 255 }).notNull().unique()` minus `.notNull()`,
and `varchar` swapped for `uuid` since the client already generates
RFC4122 UUIDs via `createCaptureId()`/`createFuelOutboxId()`):

- `expenses` (after `notes: t.text(),` at line 502, before the OCR
  provenance fields): `clientId: t.uuid().unique(),`
- `pins` (after `notes: t.text(),` at line 910): `clientId: t.uuid().unique(),`
- `fuelLogs` (after `notes: t.text(),` at line 1428): `clientId: t.uuid().unique(),`

Global uniqueness (not scoped to `tripId`) matches the `settlements`
precedent and is simpler; collisions across trips are not a practical concern
for client-generated random UUIDs.

**Verify**: `pnpm -F @sortey/db typecheck` → exit 0.

### Step 2: Generate the migration

```
pnpm -F @sortey/db generate
```

**Verify**: exit 0; a new `packages/db/drizzle/00NN_<name>.sql` appears
containing three `ALTER TABLE ... ADD COLUMN "client_id" uuid` +
`ADD CONSTRAINT ... UNIQUE` statements (one per table), and
`packages/db/drizzle/meta/_journal.json` gained one entry. Do not edit the
generated SQL by hand.

### Step 3: `expenses.create` — thread `clientId` through and dedupe

In `packages/api/src/expenses/transport-draft.ts`:
- Add `clientId?: string | null;` to `TransportDraftInput` (after `notes`).
- In `insertExpenseDraft`, change the insert to use the settlements pattern:
  include `clientId: input.clientId ?? null` in `.values({...})`, add
  `.onConflictDoNothing({ target: expenses.clientId })` before `.returning()`,
  and when `created` is falsy **and** `input.clientId` is set, fall back to
  `ctx.db... ` — actually `input.db`, matching this file's existing
  `input.db` naming — select the existing row by `eq(expenses.clientId, input.clientId)`
  and return it instead of throwing `INTERNAL_SERVER_ERROR`. When `created`
  is falsy and `input.clientId` is *not* set, keep the existing
  `INTERNAL_SERVER_ERROR` throw (real insert failure, not a dedupe hit).
- Import `eq` from `@sortey/db` (check the file's current imports at line 1;
  add `eq` if not already present).

In `packages/api/src/router/expenses.ts`:
- Add `clientId: z.string().uuid().optional(),` to `create`'s input object
  (after `notes` at line 186, before `payerUserId`).
- Pass `clientId: input.clientId ?? null` into the `insertExpenseDraft({...})`
  call (lines 229-243).
- The push-notification call (`sendPushToTripMembers`, lines 245-251) fires
  unconditionally today. Leave it firing on every call for this plan — a
  duplicate-notification-on-retry edge case is lower severity than a
  duplicate expense row and is reasonable to defer; note it in Maintenance
  notes below instead of fixing it here.

### Step 4: `pins.create` — add `clientId` and dedupe inline

In `packages/api/src/router/pins.ts`:
- Add `clientId: z.string().uuid().optional(),` to `create`'s input object
  (after `notes` at line 91).
- Change the insert (lines 114-128) to include `clientId: input.clientId ?? null`
  in `.values({...})`, add `.onConflictDoNothing({ target: pins.clientId })`,
  and when the insert returns nothing:
  - if `input.clientId` was set, select the existing row by
    `eq(pins.clientId, input.clientId)` and return it (same shape as the
    happy path — no `attendeeCount`, matching what `create` already returns
    today).
  - if `input.clientId` was not set, this is a genuine insert failure —
    throw `TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create pin." })`
    (the current code has no such guard because `created!` is
    non-null-asserted; make the assertion conditional instead of adding a
    new failure mode for existing callers).

### Step 5: `fuelLogs.create` — dedupe the whole orchestration, not just the row

This one needs more care because a duplicate insert isn't just the fuel log
— it can also duplicate the linked split expense.

In `packages/api/src/router/fuel-logs.ts`:
- Add `clientId?: string | null;` to `FuelLogStore.insertFuelLog`'s `values`
  parameter type (line ~27-44).
- Change `FuelLogStore.insertFuelLog`'s return type to
  `Promise<{ row: FuelLogRow; wasCreated: boolean }>` (was `Promise<FuelLogRow>`).
- In the DB implementation (lines 68-80), include `clientId: values.clientId ?? null`
  in `.values(values)`, add `.onConflictDoNothing({ target: fuelLogs.clientId })`,
  and:
  - if a row was created, return `{ row: created, wasCreated: true }`.
  - if not, and `values.clientId` was set, select the existing row by
    `eq(fuelLogs.clientId, values.clientId)` and return
    `{ row: existing, wasCreated: false }`.
  - if not, and `values.clientId` was not set, keep the existing
    `INTERNAL_SERVER_ERROR` throw.
- In `createFuelLogWithSplit` (lines 171-262): change the first call
  (`const log = await store.insertFuelLog({...})`, lines 194-211) to
  `const { row: log, wasCreated } = await store.insertFuelLog({...})`, and
  immediately after it, before the `if (!input.splitWithGroup)` check, add:
  `if (!wasCreated) { return { log }; }` — a deduped retry always
  short-circuits here, regardless of whether the original request wanted a
  split (if it did, the split already happened on the first successful
  request and `log.expenseId` already reflects it; if it didn't, there's
  nothing further to do).
- Add `clientId: input.clientId` to the `store.insertFuelLog({...})` call
  args (lines 194-211) — thread it from `input` (added in the next bullet).
- Add `clientId?: string | null;` to `createFuelLogWithSplit`'s `input`
  parameter type (lines 173-192).
- In the router (`create`, lines 297-344): add
  `clientId: z.string().uuid().optional(),` to the input object (after
  `notes` at line 315, before `currency`), and pass
  `clientId: input.clientId ?? null` into the `createFuelLogWithSplit(...)`
  call args (lines 323-342).

### Step 6: Fix the client — stop stripping `clientId`

In `apps/expo/src/utils/use-outbox-sync.ts`:
- Fuel branch (lines 36-62): change the destructure from
  `const { clientId: _clientId, workspaceId, tripId, ...rest } = command;`
  to `const { workspaceId, tripId, ...rest } = command;` (keep `clientId` in
  `rest`), and add `clientId: rest.clientId,` to the `mutate({...})` call.
- Expense branch (lines 64-79): change
  `const { clientId: _c, kind: _k, ...rest } = command;` to
  `const { kind: _k, ...rest } = command;`, and add
  `clientId: rest.clientId,` to the `mutate({...})` call.
- Pin branch (lines 81-108): same change —
  `const { kind: _k, ...rest } = command;`, add `clientId: rest.clientId,`
  to the `mutate({...})` call.

**Verify**: `grep -n "clientId: _c\|clientId: _clientId" apps/expo/src/utils/use-outbox-sync.ts` → no matches.

## Test plan

Model new tests after the two existing exemplars in this codebase:
`packages/api/src/route-planner/__tests__/journey-ops.test.ts`'s
`"uses the client stop id to make retries idempotent"` (lines 100-110 —
calls the op twice with identical input, asserts identical result and that
storage grew by exactly one row) and `packages/api/src/router/__tests__/fuel-logs.test.ts`'s
in-memory `FuelLogStore` mock (lines 38-91, `createMemoryFuelLogStore`).

- **`packages/api/src/router/__tests__/expenses.test.ts`**: this file
  currently tests pure logic functions, not the mutation handler directly
  (see the file's own `// ─── Domain logic mirrors (inlined from expenses.ts procedures) ───` section, lines 64-105). Add a new `describe("insertExpenseDraft — clientId dedupe")`
  block that imports `insertExpenseDraft` from `../../expenses/transport-draft`
  directly and exercises it against a minimal fake `db` object (an object
  with `.insert().values().onConflictDoNothing().returning()` and
  `.select().from().where().limit()` chains returning canned arrays — mirror
  the chain shape already used by `ctx.db` calls in `expenses.ts`). Cases:
  - no `clientId` supplied: two calls insert two distinct rows (unchanged
    behavior — this covers the ferry caller).
  - same `clientId` supplied twice: first call inserts, second call returns
    the same row without a second insert (assert the fake db's insert was
    called exactly once, and the second call's `.select()` fallback path was
    taken).
- **`packages/api/src/router/__tests__/fuel-logs.test.ts`**: extend
  `createMemoryFuelLogStore`'s `insertFuelLog` mock to accept/store
  `clientId` and return `{ row, wasCreated }` matching the new interface.
  Add a case: call `createFuelLogWithSplit` twice with the same `clientId`
  and `splitWithGroup: true` — assert `state.fuelLogs` has length 1,
  `state.expenses` has length 1 (not 2), and the second call's result equals
  the first's.
- **`packages/api/src/router/__tests__/pins.test.ts`** (new file — no pins
  router test exists yet): follow the `expenses.test.ts` file header
  convention (`process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/gmacko_test";`
  at the top, per every router test file in this repo) and test the dedupe
  logic against a fake `db` the same way as the `expenses.create` test above
  (pins.create's insert is inline in the router, not behind a shared
  helper — you may need to extract the dedupe branch into a small testable
  function, e.g. `insertPinDeduped(db, values)` in `pins.ts`, if the router
  procedure itself isn't easily unit-testable in isolation; if you do this,
  keep it minimal and consistent with how `transport-draft.ts` already
  separates the insert from the router for `expenses`).
- Verification: `pnpm -F @sortey/api test` → all pass, including the new
  cases above.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/db typecheck` exits 0
- [ ] `pnpm -F @sortey/db generate` produced a new migration adding
      `client_id` to `expense`, `pin`, `fuel_log` (or STOP condition invoked
      if `DATABASE_URL` unavailable)
- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0; new dedupe tests exist in
      `expenses.test.ts`, `fuel-logs.test.ts`, and a new `pins.test.ts`, and
      pass
- [ ] `pnpm -F @sortey/expo typecheck` exits 0
- [ ] `grep -n "clientId: _c\|clientId: _clientId" apps/expo/src/utils/use-outbox-sync.ts` returns no matches
- [ ] `grep -n "onConflictDoNothing" packages/api/src/expenses/transport-draft.ts packages/api/src/router/pins.ts packages/api/src/router/fuel-logs.ts` returns at least one match per file
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written at `0c1ffab`).
- `pnpm -F @sortey/db generate` fails because `DATABASE_URL` isn't set or no
  Postgres is reachable — do not hand-edit `packages/db/drizzle/meta/_journal.json`
  or snapshot files to fake a migration; report the blocker instead.
- A step's verification fails twice after a reasonable fix attempt.
- You find `insertExpenseDraft` has a second caller beyond `expenses.create`
  and the ferry link that this plan didn't account for — confirm the new
  optional `clientId` parameter doesn't change that caller's behavior before
  proceeding (it shouldn't, since `undefined`/`null` clientId always skips
  the dedupe branch, but verify).
- The `pins.create` router procedure can't reasonably be made unit-testable
  without a larger refactor than "extract one small function" — in that
  case, stop before doing a larger `pins.ts` restructure and report back
  with what a router-level integration test would need instead (e.g. a test
  tRPC caller harness), since that's a bigger decision than this plan scopes
  for.

## Maintenance notes

- The push notification in `expenses.create` (`sendPushToTripMembers`,
  `packages/api/src/router/expenses.ts:245-251`) still fires on every call,
  including a deduped retry that hits the `onConflictDoNothing` fallback
  path — if `insertExpenseDraft` is changed to return early on a dedupe hit
  *before* the router's notification call runs, this is naturally fixed for
  free; otherwise it's a follow-up (low severity: a spurious push
  notification, not a data-integrity issue).
- Once `plans/hardening/007-outbox-hardening-and-unify.md` lands, the outbox
  will have its own bounded retry/dead-letter handling — this plan's server
  dedupe is what makes those retries *safe* to repeat, not what limits how
  many times they're tried.
- If a future non-outbox caller of `expenses.create`/`pins.create`/`fuelLogs.create`
  (e.g. a bulk-import tool) starts passing `clientId`, it gets the same
  dedupe guarantee for free — no further schema work needed.
- A reviewer should scrutinize: the `onConflictDoNothing` + fallback-select
  is not atomic against a second *concurrent* insert with the same
  `clientId` racing between the failed insert and the fallback select — in
  practice this is a single mobile client retrying serially (never two
  concurrent requests with the same clientId), so the window is
  theoretical, same as the existing `settlements.record` precedent accepts.

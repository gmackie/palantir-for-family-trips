# Plan 007: Harden and unify the three Expo outbox implementations

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/hardening/README.md` if that file exists; otherwise leave a short
> status note in your final report and do not create the file yourself.
>
> **Drift check (run first)**: `git diff --stat 0c1ffab..HEAD -- apps/expo/src/utils/capture-outbox.ts apps/expo/src/utils/fuel-outbox.ts apps/expo/src/utils/journey-outbox.ts apps/expo/src/utils/capture-outbox-native.ts apps/expo/src/utils/fuel-outbox-native.ts apps/expo/src/utils/journey-outbox-native.ts apps/expo/src/utils/use-outbox-sync.ts apps/expo/src/utils/capture-outbox.test.ts apps/expo/src/utils/fuel-outbox.test.ts apps/expo/src/utils/journey-outbox.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (touches all three offline write paths; must not regress
  existing outbox tests)
- **Depends on**: `plans/hardening/006-server-idempotency-offline-writes.md`
  — that plan makes retries *safe* (server dedupes by `clientId`/`stopId`);
  this plan makes retries *bounded and non-lossy*. Do this plan after 006 so
  that testing "what happens when the same command sends twice" doesn't
  require also proving the server won't duplicate data.
- **Category**: bug / tech-debt
- **Planned at**: commit `0c1ffab`, 2026-07-19

## Why this matters

`apps/expo/src/utils/{capture,fuel,journey}-outbox.ts` are three
near-identical ~120-150 line files (`CaptureOutbox`, `FuelOutbox`,
`JourneyOutbox`), each independently implementing the same
enqueue/list/flush/save state machine over a `{get(): Promise<string|null>;
set(value): Promise<void>}` storage interface. Being copy-pasted three times
means the same four bugs exist in triplicate, and any future fix has to be
applied three times (or, more likely, two of the three get missed — this is
already close to happening, since the files have already drifted slightly:
`JourneyOutbox` has no `pendingCount()` method while `CaptureOutbox` and
`FuelOutbox` do).

The four bugs, in order of severity:

1. **Lost writes**: `flushOnce` reads the queue once, then calls
   `save()` with that *stale* snapshot after every single entry — including
   entries added by a concurrent `enqueue()` mid-flush. The concurrent
   enqueue's own `save()` gets silently overwritten.
2. **Non-atomic ack**: an entry is removed from the in-memory array and
   `save()`d *after* `send()` resolves — a crash in that narrow window
   replays an already-successful write. (Plan 006 makes a replay safe
   server-side; this plan is about not needlessly relying on that safety
   net for an ordinary case.)
3. **Retry-forever**: a failed entry is marked `state: "failed"` but the
   next `flush()` retries it anyway, unconditionally, forever — no
   distinction between "the server rejected this request and it will never
   succeed" (e.g. a validation error) and "the network was down" (worth
   retrying).
4. **Corrupt storage silently wiped**: `list()` catches a JSON parse
   failure and returns `[]` — and the next `save()` call (from `enqueue()`
   or `flushOnce()`) then persists that empty array, permanently erasing
   whatever was actually queued.

This plan fixes all four, then extracts the fixed logic into one generic
`Outbox<TCommand>` class so the three files become thin
type-definitions-plus-wiring, matching how `capture-outbox-native.ts`,
`fuel-outbox-native.ts`, and `journey-outbox-native.ts` already just wire a
class to `expo-secure-store` (each is a 15-line file, unchanged pattern to
follow).

## Current state

### The three outboxes today (all three share this shape)

`apps/expo/src/utils/capture-outbox.ts:73-146` (`CaptureOutbox` — the other
two, `FuelOutbox` at `fuel-outbox.ts:50-124` and `JourneyOutbox` at
`journey-outbox.ts:50-119`, are structurally identical modulo the command
type and the dedupe-key field name: `clientId` for Capture/Fuel, `stopId`
for Journey):

```ts
export class CaptureOutbox {
  private flushing: Promise<void> | null = null;

  constructor(private readonly storage: CaptureOutboxStorage) {}

  async list(): Promise<CaptureOutboxEntry[]> {
    const raw = await this.storage.get();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as CaptureOutboxEntry[]) : [];
    } catch {
      return [];                          // BUG 4: corruption looks like "empty"
    }
  }

  async pendingCount(): Promise<number> {
    return (await this.list()).length;
  }

  async enqueue(command: CaptureCommand): Promise<void> {
    const entries = await this.list();
    const existing = entries.find(
      (entry) => entry.command.clientId === command.clientId,
    );
    if (existing) {
      existing.command = command;
      existing.state = "pending";
      existing.error = undefined;
    } else {
      entries.push({
        command,
        state: "pending",
        attempts: 0,
        queuedAt: new Date().toISOString(),
      });
    }
    await this.save(entries);             // races with a concurrent flushOnce's save
  }

  flush(
    send: (command: CaptureCommand) => Promise<unknown>,
  ): Promise<void> {
    if (this.flushing) return this.flushing;   // good: coalesces concurrent flush() callers
    this.flushing = this.flushOnce(send).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(
    send: (command: CaptureCommand) => Promise<unknown>,
  ): Promise<void> {
    const entries = await this.list();     // BUG 1: snapshot taken ONCE, before the loop
    for (const entry of [...entries]) {
      try {
        await send(entry.command);
        const index = entries.findIndex(
          (c) => c.command.clientId === entry.command.clientId,
        );
        if (index !== -1) entries.splice(index, 1);   // BUG 2: mutated in memory...
      } catch (error) {
        entry.state = "failed";
        entry.attempts += 1;               // BUG 3: no cap, no error classification
        entry.error = error instanceof Error ? error.message : "Sync failed";
      }
      await this.save(entries);            // ...then persisted AFTER send() already resolved
    }
  }

  private save(entries: CaptureOutboxEntry[]): Promise<void> {
    return this.storage.set(JSON.stringify(entries));
  }
}
```

**Bug 1 walkthrough (lost writes)**: `flushOnce` calls `this.list()` once at
the top, getting array `A`. Suppose the queue has 3 entries and entry #1's
`send()` takes 500ms. While that `await send(...)` is in flight, the UI
calls `outbox.enqueue(newCommand)` — `enqueue` does its own `list()` (reads
current storage, say still `A`), pushes `newCommand`, and calls
`save([...A, newCommand])`. Then `flushOnce`'s loop finishes entry #1,
splices it out of its *own* `entries` array (which is `A`, not
`[...A, newCommand]`), and calls `this.save(entries)` — overwriting storage
with `A` minus entry #1, silently dropping `newCommand` entirely. It is
gone; nothing re-adds it.

**Bug 2 walkthrough (non-atomic ack)**: `await send(entry.command)` resolves
(the server has now committed the write). Then the process is killed (app
backgrounded and OS-killed, JS thread crash) before `await this.save(entries)`
on the next line completes. On restart, `list()` still shows the entry as
`pending` (or `failed` from a prior attempt) with the full command, and the
next `flush()` calls `send()` again — a second server request for a write
that already succeeded. (Plan 006 makes this safe by dedupe on
`clientId`/`stopId`; this bug is why a client-side fix is still worth doing
independently — fewer redundant server round-trips, and defense-in-depth if
006's server dedupe is ever bypassed by a caller that doesn't set
`clientId`.)

**Bug 3 walkthrough (retry-forever)**: `entry.attempts += 1` is tracked but
never read anywhere in this file or in
`apps/expo/src/utils/use-outbox-sync.ts`. A command that will *always* fail
(e.g. the server rejects it as invalid — 400) is retried on every single
`flush()` call (every reconnect, every manual "Sync" tap) forever, with no
way for the user to see "this one is permanently stuck" or discard it.

**Bug 4 walkthrough (corrupt storage wiped)**: if `SecureStore`'s stored
JSON is corrupted (partial write from a prior crash, storage
migration/format change, manual tampering), `list()`'s `catch { return []; }`
makes the corruption indistinguishable from "queue is empty." The very next
`save()` call — which `list()` itself doesn't trigger, but any caller of
`enqueue()` or `flushOnce()` will — persists `[]`, permanently destroying
whatever was actually in storage. There is no recovery path and no user
visibility into it happening.

### The two wrapper layers

`apps/expo/src/utils/capture-outbox-native.ts` (full file, 15 lines — `fuel-`
and `journey-outbox-native.ts` are the same shape):

```ts
import * as SecureStore from "expo-secure-store";

import {
  CAPTURE_OUTBOX_KEY,
  CaptureOutbox,
  type CaptureOutboxStorage,
} from "./capture-outbox";

const secureStorage: CaptureOutboxStorage = {
  get: () => SecureStore.getItemAsync(CAPTURE_OUTBOX_KEY),
  set: (value) => SecureStore.setItemAsync(CAPTURE_OUTBOX_KEY, value),
};

export const captureOutbox = new CaptureOutbox(secureStorage);
```

`apps/expo/src/utils/use-outbox-sync.ts:1-7` imports these three singletons
(`captureOutbox`, `fuelOutbox`, `journeyOutbox` — note the *-native* module
names) and drives `.flush()` on each in `syncNow` (lines 17-115). This file
is otherwise out of scope here except for whatever minimal call-site change
falls out of the `Outbox<T>` extraction (see Step 5) — its `clientId`
handling is `plans/hardening/006-server-idempotency-offline-writes.md`'s
concern, not this plan's.

### Existing tests to preserve

`apps/expo/src/utils/capture-outbox.test.ts` (65 lines), `fuel-outbox.test.ts`
(69 lines), `journey-outbox.test.ts` (83 lines) all construct an in-memory
`{ get, set }` storage (e.g. `capture-outbox.test.ts:10-18`) and exercise
`enqueue`/`flush`/`list`/`pendingCount` directly against the concrete class
— none of them import the `-native.ts` wrapper. `journey-outbox.test.ts:71-81`
already has a "coalesces simultaneous flushes" test that exercises the
`this.flushing` promise-reuse guard — that behavior must be preserved
exactly (it's correct and not one of the four bugs).

### These tests currently have no wired-up way to run

Verified: `apps/expo/package.json` has **no `"test"` script** (its
`"scripts"` block has `build`/`dev`/`typecheck`/`lint`/etc. but not `test`),
and there is **no `apps/expo/vitest.config.ts`** and **no `vitest` /
`@sortey/vitest-config` dependency** anywhere in `apps/expo/package.json`.
Compare `apps/nextjs/package.json`, which *does* have all three
(`"test": "vitest run --config vitest.worker.config.ts"`, a
`vitest.worker.config.ts`, and `"vitest": "^4.1.7"` in `devDependencies`) —
that's the pattern to mirror. `packages/api/vitest.config.ts` is the
simpler, non-worker-pool version to copy (this app doesn't need Cloudflare
Workers pool):

```ts
// packages/api/vitest.config.ts, in full
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/index.ts"],
    },
  },
});
```

`tooling/vitest` (workspace package `@sortey/vitest-config`) exports a
`baseConfig` (`tooling/vitest/src/base.ts`) other packages could extend via
`import { baseConfig } from "@sortey/vitest-config/base"` — but no package in
this repo currently does that in its `vitest.config.ts` (`packages/api`,
`packages/db`, `packages/realtime`, `packages/validators`, `packages/settings`
all define their own inline config, same as the excerpt above); follow that
established local-inline-config convention rather than being the first to
wire up the shared preset, to keep this plan's footprint minimal.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Expo typecheck | `pnpm -F @sortey/expo typecheck` | exit 0, no errors |
| Expo outbox tests | `pnpm -F @sortey/expo test -- src/utils/capture-outbox.test.ts src/utils/fuel-outbox.test.ts src/utils/journey-outbox.test.ts src/utils/outbox.test.ts` | exit 0, all pass (this script does not exist yet — Step 1 adds it) |
| Grep check | `grep -rn "class CaptureOutbox\|class FuelOutbox\|class JourneyOutbox" apps/expo/src/utils/` | no matches after Step 4 (classes replaced by `Outbox<T>` usage) |

## Scope

**In scope**:
- `apps/expo/package.json` — add a `"test"` script + `vitest` devDependency
  (Step 1, needed to make this plan's own done-criteria checkable; see
  STOP conditions if this is judged out of bounds).
- `apps/expo/vitest.config.ts` — new file (Step 1).
- New `apps/expo/src/utils/outbox.ts` — the generic `Outbox<TCommand>` class
  (Step 2-4).
- New `apps/expo/src/utils/outbox.test.ts` — tests for the generic class's
  hardening behavior (lost-write, non-atomic-ack, retry-cap, corruption).
- `apps/expo/src/utils/capture-outbox.ts`, `fuel-outbox.ts`,
  `journey-outbox.ts` — reduced to type definitions + thin `Outbox<T>`
  instantiation (Step 4).
- `apps/expo/src/utils/capture-outbox.test.ts`, `fuel-outbox.test.ts`,
  `journey-outbox.test.ts` — updated only as needed to keep passing against
  the new implementation (should need minimal-to-no changes, since the
  public API — `enqueue`/`list`/`flush`/`pendingCount` — is preserved).

**Out of scope** (do NOT touch, even though they look related):
- `apps/expo/src/utils/{capture,fuel,journey}-outbox-native.ts` — these
  already just wire a class to `SecureStore`; the class they import stays
  named the same (`CaptureOutbox`, `FuelOutbox`, `JourneyOutbox` — see Step
  4, these become thin subclasses/factories of `Outbox<T>`, not renamed),
  so these three files need **zero changes**. If your Step 4 design would
  require touching them, reconsider the design first.
- `apps/expo/src/utils/use-outbox-sync.ts`'s `clientId`-stripping bug — that
  is `plans/hardening/006-server-idempotency-offline-writes.md`. Do not fix
  it here even though you'll be looking at this file's neighborhood.
- Any UI surface for showing/discarding dead-lettered entries (Step 3 adds
  the *data model* — a `"dead"` state and a way to list/clear them — but not
  a screen or button; that's future product work, out of scope).
- Server-side changes of any kind.
- `packages/api`, `packages/db`.

## Git workflow

- Same conventions as `plans/hardening/006-*`: conventional-commit style
  messages (e.g. `refactor(expo): extract generic Outbox<T>, fix lost-write/retry-forever/corrupt-storage bugs`).
- Do NOT push or open a PR unless instructed.
- If 006 hasn't landed yet in your branch, this plan's tests and types don't
  depend on 006's server changes — it's safe to execute this plan's own
  steps in isolation, but the "Depends on" note above is about *review
  order and reasoning*, not a hard technical blocker. If you're unsure
  whether 006 has landed, check: `git log --oneline --all | grep -i "006-server-idempotency"`.

## Steps

### Step 1: Wire up a test runner for `apps/expo`

Add to `apps/expo/package.json`'s `"scripts"`: `"test": "vitest run"` and
`"test:watch": "vitest"` (matching the naming other packages use). Add
`"vitest": "catalog:"` to `"devDependencies"` if the workspace catalog has
an entry for it (check `pnpm-workspace.yaml`'s `catalog:` section for a
`vitest` key first — `apps/nextjs/package.json` uses `"@vitest/coverage-v8"`
and pins `"vitest": "^4.1.7"` directly rather than via `catalog:`; match
whichever form the catalog actually supports).

Create `apps/expo/vitest.config.ts`, copying the `packages/api/vitest.config.ts`
shape shown in "Current state" above, with `include` widened to match this
package's test location: `include: ["src/**/*.{test,spec}.ts"]` (same glob
— tests already live under `src/utils/`, no change needed there).

**Verify**: `pnpm -F @sortey/expo test -- src/utils/capture-outbox.test.ts` →
runs and passes (3 existing test files should already pass unmodified at
this point — this step only wires up the runner, no outbox code changes
yet).

### Step 2: Design `Outbox<TCommand>` — fix bugs 1, 2, and 4 first

Create `apps/expo/src/utils/outbox.ts`. Generic over the command type and a
dedupe-key selector (a function `getKey: (command: TCommand) => string`,
since Capture/Fuel key on `command.clientId` and Journey keys on
`command.stopId`):

```ts
export interface OutboxEntry<TCommand> {
  command: TCommand;
  state: "pending" | "failed" | "dead";  // "dead": Step 3
  attempts: number;
  error?: string;
  queuedAt: string;
}

export interface OutboxStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
}

export interface OutboxOptions<TCommand> {
  getKey: (command: TCommand) => string;
  maxAttempts?: number;       // Step 3, default e.g. 8
  isPermanentFailure?: (error: unknown) => boolean;  // Step 3
}
```

Fix bug 4 (corrupt storage) in `list()`: distinguish "no value stored yet"
(`raw === null`, genuinely empty — return `[]`, safe) from "value stored but
not valid JSON / not an array" (corruption — do NOT silently coerce to `[]`;
instead throw a distinguishable error, e.g. `class OutboxCorruptionError extends Error`,
so callers can surface it instead of it being swallowed and then
overwritten by the next `save()`). `enqueue()` and `flushOnce()` must let
this error propagate rather than catching it and proceeding to `save([])` —
that propagation *is* the fix; no auto-recovery attempt (no safe way to
guess the lost data), just stop touching storage until something else (a
future repair step, or a user-visible "your offline queue was corrupted and
cleared" explicit action) handles it.

Fix bugs 1 and 2 (lost writes + non-atomic ack) together in
`flushOnce`/`enqueue`, by making every mutation of storage a
read-current→mutate→write cycle instead of operating on a stale snapshot,
and by writing the ack (removal) *before* considering the entry fully done
— concretely:

```ts
private async flushOnce(send: (command: TCommand) => Promise<unknown>): Promise<void> {
  // Re-list at the top of EVERY iteration, not once before the loop —
  // this is what fixes bug 1 (a concurrent enqueue() between iterations
  // is now visible to the next list() call instead of being clobbered).
  for (;;) {
    const entries = await this.list();
    const next = entries.find((e) => e.state !== "dead");
    if (!next) return;
    const key = this.options.getKey(next.command);
    try {
      await send(next.command);
      // Re-list again post-send (not reuse `entries`) before removing —
      // this narrows bug 2's window to "between this list() and this
      // save()" instead of "for the entire rest of the flush loop", and
      // means a concurrent enqueue() that happened during the `send()`
      // await is preserved instead of being silently dropped.
      const current = await this.list();
      const filtered = current.filter((e) => this.options.getKey(e.command) !== key);
      await this.save(filtered);
    } catch (error) {
      const current = await this.list();
      const idx = current.findIndex((e) => this.options.getKey(e.command) === key);
      if (idx !== -1) {
        // ... bump attempts/state on `current[idx]`, Step 3 classification ...
      }
      await this.save(current);
    }
  }
}
```

This still has a narrow non-atomic-ack window (`send()` resolves, then a
crash before the post-send `save()`) — that's inherent to "two separate
async storage operations can't be made truly atomic without an OS-level
transactional store," which `expo-secure-store` isn't. The fix is *reducing*
the window (from "the rest of the flush loop" to "one read+write pair") and
relying on plan 006's server-side dedupe to make a replay in that narrow
window harmless, not eliminating the window outright. Document this
explicitly in the class's doc comment.

`enqueue()` doesn't need to change beyond what it already does (read
list → mutate → save) — it was never the buggy side of the race; it's
already correct read-mutate-write. The fix is making `flushOnce` behave the
same way instead of holding a stale array across awaits.

### Step 3: Add bounded retry + failure classification — fixes bug 3

Add `maxAttempts` (default 8) and an optional `isPermanentFailure` predicate
to `OutboxOptions`. In the catch branch of `flushOnce`:
- If `isPermanentFailure?.(error)` is true (e.g. the send function should
  throw something recognizable for a tRPC 4xx — check what shape errors
  `trpcClient.*.mutate()` rejects with today via a quick read of
  `apps/expo/src/utils/api.ts` before deciding the signature; if there's no
  existing convention for classifying tRPC error codes client-side, default
  `isPermanentFailure` to `undefined` / "nothing is permanent" for this
  plan and leave real classification as a documented follow-up — don't
  invent a brittle heuristic against `error.message` string matching), OR
  `entry.attempts >= maxAttempts`: set `state: "dead"` instead of
  `"failed"`.
- `flushOnce`'s loop (the `for (;;)` shape above) already skips `"dead"`
  entries via `entries.find((e) => e.state !== "dead")` — so dead entries
  stop being retried automatically, but stay in storage (not silently
  dropped) for later inspection/clearing.
- Add two new public methods to `Outbox<T>`: `listDead(): Promise<OutboxEntry<TCommand>[]>`
  (filter `list()` by `state === "dead"`) and `discardDead(): Promise<void>`
  (read-mutate-write: remove all `"dead"` entries and save). These are the
  "way to surface/discard permanently-failed entries" the plan requires —
  no UI is added in this plan, but the data-layer hook is here for a future
  screen to call.

### Step 4: Reduce the three files to type-definitions + wiring

Rewrite `apps/expo/src/utils/capture-outbox.ts` to keep its exports
(`CAPTURE_OUTBOX_KEY`, `createCaptureId`, `ExpenseCaptureCommand`,
`PinCaptureCommand`, `CaptureCommand`, `CaptureOutboxEntry`,
`CaptureOutboxStorage`, `CaptureOutbox`) but implement `CaptureOutbox` as a
thin subclass (or factory function returning an `Outbox<CaptureCommand>`
instance, whichever reads more naturally against this codebase's style —
this file currently uses a `class`, so prefer `class CaptureOutbox extends Outbox<CaptureCommand> { constructor(storage) { super(storage, { getKey: (c) => c.clientId }); } }`
if `Outbox`'s constructor shape allows it) so every existing import site
(`capture-outbox-native.ts`'s `new CaptureOutbox(secureStorage)`,
`capture-outbox.test.ts`'s `new CaptureOutbox(memoryStorage())`) keeps
working unchanged. `CaptureOutboxEntry` becomes a type alias:
`export type CaptureOutboxEntry = OutboxEntry<CaptureCommand>;`.
`CaptureOutboxStorage` becomes `export type CaptureOutboxStorage = OutboxStorage;`
(or re-export directly — either is fine as long as the existing named export
keeps working).

Do the same for `fuel-outbox.ts` (`getKey: (c) => c.clientId`) and
`journey-outbox.ts` (`getKey: (c) => c.stopId`).

**Do not** rename or move `CAPTURE_OUTBOX_KEY`/`FUEL_OUTBOX_KEY`/
`JOURNEY_OUTBOX_KEY`, `createCaptureId`/`createFuelOutboxId`/
`createJourneyStopId`, or any of the command type shapes — these are used
by `use-outbox-sync.ts` and the `-native.ts` wrappers and are out of this
plan's scope to touch.

### Step 5: Confirm `use-outbox-sync.ts` needs no changes

`use-outbox-sync.ts` calls `.flush(sendFn)` on each of the three singletons
(lines 23-109) and nothing else from these modules — `Outbox<T>.flush`'s
public signature (`(send: (command: TCommand) => Promise<unknown>) => Promise<void>`)
is unchanged from today's per-class `flush`. If your Step 2-4
implementation changes this signature, stop and reconsider — it's a sign
the extraction leaked an implementation detail into the public API.

**Verify**: `pnpm -F @sortey/expo typecheck` → exit 0 (this alone catches a
signature mismatch, since `use-outbox-sync.ts` calls `.flush()` with a
function argument that must still type-check against all three).

## Test plan

- **New `apps/expo/src/utils/outbox.test.ts`**: test the generic class
  directly (construct with a trivial command type like
  `{ id: string; n: number }` and `getKey: (c) => c.id}`), covering:
  - **Lost-write regression test**: enqueue one command; call `flush(send)`
    where `send` is an async function that, on its first call, awaits a
    controllable promise (e.g. hold a `resolve` function from `new Promise`)
    before resolving; while that `flush()` call is still pending (send not
    yet resolved), call `enqueue()` with a second, different command; then
    resolve the held promise and await `flush()`'s completion. Assert
    `list()` afterward contains exactly the second command (not empty, not
    missing it) — this is the exact scenario described in "Bug 1
    walkthrough" above, and is the regression test that would have failed
    against the current (buggy) implementation.
  - **Retry cap**: enqueue one command; call `flush()` with a `send` that
    always throws, `maxAttempts` times total (across `maxAttempts` separate
    `flush()` calls, since each `flush()` call only tries pending entries
    once through the loop per the existing per-entry-once-per-flush
    behavior) — assert the entry's `state` becomes `"dead"` at the
    `maxAttempts`th failure and that a subsequent `flush()` call does NOT
    invoke `send` again for it (assert a call counter stays flat).
  - **Corruption is not silently wiped**: seed storage with a non-JSON
    string (e.g. `"{not valid json"`); call `list()` and assert it throws
    (or returns a distinguishable corruption marker, per your Step 2
    design) rather than returning `[]`; then assert calling `enqueue()`
    afterward does NOT call `storage.set()` with data that discards
    whatever was there (this needs a storage mock that can tell you what
    `set()` was called with, or wasn't called at all).
  - **`listDead()`/`discardDead()`**: after driving an entry to `"dead"`
    via the retry-cap scenario, assert `listDead()` returns it and
    `discardDead()` removes it from subsequent `list()` calls.
- **`capture-outbox.test.ts`, `fuel-outbox.test.ts`, `journey-outbox.test.ts`**:
  must still pass unmodified against the new `Outbox<T>`-backed
  implementation. In particular:
  - `journey-outbox.test.ts:71-81` ("coalesces simultaneous flushes") must
    keep passing — this exercises the `this.flushing` promise-dedup guard,
    which Step 2-4 must preserve as-is.
  - `fuel-outbox.test.ts:60-67` ("dedupes by clientId on re-enqueue") must
    keep passing — confirms `getKey` wiring is correct for `FuelOutbox`.
  - `capture-outbox.test.ts:54-63` ("keeps failed entries") must keep
    passing — confirms a single failure still lands in `"failed"` (not
    `"dead"` — the default `maxAttempts` from Step 3 must be > 1, so one
    failure alone doesn't dead-letter an entry; if the existing tests
    somehow encode an assumption incompatible with the new `"dead"` state,
    that's a drift signal — STOP and report rather than weakening the test).
- Verification:
  `pnpm -F @sortey/expo test -- src/utils/outbox.test.ts src/utils/capture-outbox.test.ts src/utils/fuel-outbox.test.ts src/utils/journey-outbox.test.ts`
  → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm -F @sortey/expo typecheck` exits 0
- [ ] `pnpm -F @sortey/expo test -- src/utils/outbox.test.ts src/utils/capture-outbox.test.ts src/utils/fuel-outbox.test.ts src/utils/journey-outbox.test.ts` exits 0, all pass
- [ ] `apps/expo/src/utils/outbox.ts` exists and exports `Outbox`,
      `OutboxEntry`, `OutboxStorage`, `OutboxOptions`
- [ ] `grep -c "async list\|async flush\|async enqueue" apps/expo/src/utils/capture-outbox.ts apps/expo/src/utils/fuel-outbox.ts apps/expo/src/utils/journey-outbox.ts` — each of the three files has 0 or near-0 matches (the logic moved to `outbox.ts`; these files are now thin)
- [ ] `apps/expo/src/utils/capture-outbox-native.ts`, `fuel-outbox-native.ts`, `journey-outbox-native.ts` are byte-for-byte unchanged (`git diff --stat` shows no changes to these three paths)
- [ ] `apps/expo/src/utils/use-outbox-sync.ts` is unchanged by this plan (any changes there belong to plan 006)
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (drift since `0c1ffab`).
- Adding a `"test"` script + vitest config to `apps/expo/package.json`
  (Step 1) turns out to be contentious or already superseded by other
  in-flight work — check `git log --oneline -- apps/expo/package.json apps/expo/vitest.config.ts`
  first; if someone else is mid-flight on wiring up expo's test runner,
  stop and reconcile rather than creating a conflicting config.
- A step's verification fails twice after a reasonable fix attempt.
- Your `Outbox<T>` design would require changing the `.flush()` public
  signature that `use-outbox-sync.ts` depends on (see Step 5) — that's a
  sign the abstraction is wrong, not a reason to also edit
  `use-outbox-sync.ts` here (that file's changes are plan 006's).
- You find a fourth outbox-like file (or a caller of these three outside
  `use-outbox-sync.ts` and the `-native.ts` wrappers) that this plan's
  recon didn't surface — confirm the generic extraction doesn't miss it
  before proceeding.

## Maintenance notes

- `isPermanentFailure` is deliberately left unimplemented (always
  "nothing is permanent, only the attempt cap matters") in this plan,
  pending a real convention for classifying tRPC error codes on the client
  — a follow-up plan should wire this once `apps/expo/src/utils/api.ts`'s
  error-handling conventions are inventoried; check whether `trpcClient`
  already surfaces `TRPCClientError.data.httpStatus` or `.data.code`
  anywhere in the Expo app before designing it, so the classifier matches
  an existing pattern instead of introducing a new one.
- The `"dead"` state and `listDead()`/`discardDead()` are data-layer only —
  a reviewer should confirm no UI currently assumes `state` is only
  `"pending" | "failed"` (search `apps/expo/src` for `.state ===` against
  these outboxes) before this ships, since a `"dead"` value appearing
  somewhere unexpected would be a silent UI bug, not a crash.
- If a future change adds a fourth outbox (e.g. for a new offline-capturable
  entity), it should be a ~15-line file matching `journey-outbox.ts`'s
  post-this-plan shape: types + one `getKey` + `new Outbox(storage, {...})`.
  If it grows past that, the abstraction in `outbox.ts` is missing
  something and should be extended there, not worked around per-file.
- This plan intentionally narrows (not eliminates) the non-atomic-ack
  window in bug 2. If `expo-secure-store` or its usage here ever moves to
  something with real transactional guarantees, revisit whether the
  narrowed window can be closed entirely.

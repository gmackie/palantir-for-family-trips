# /autoplan Review — Group Trip Command Center

**Reviewed:** `docs/ai/INITIAL_PROPOSAL.md` + `docs/ai/IMPLEMENTATION_PLAN.md` + `DESIGN.md`
**Template reference:** `../create-gmacko-app`
**Branch:** `master` @ 0c07345
**Voices run:** 4 independent Claude subagents (CEO, Design, Eng, DX). **Codex cross-validation was skipped** to save session time; run `codex exec` per phase later if desired. All findings below come from a single reviewer perspective per phase.

---

## Top-line verdict

The plan's infrastructure tier is strong. The template ground truth, phase decomposition, and schema sketches are usable as-is by a fresh engineer. Two areas are weak: **scope/wedge thinking** (CEO phase) and **design specificity for novel interactions** (Design phase). Eng found three real bugs and one architectural risk that must land before Phase 2 code. DX found a path typo that would silently break Phases 2–5 if copy-pasted.

---

## Phase 1 — CEO (Strategy & Scope)

### Consensus table (single voice — Codex skipped)

| Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|
| 1. Premises valid? | FAIL (3 of 5 load-bearing premises are unvalidated) | N/A | single-reviewer concern |
| 2. Right problem? | FAIL (plan staples 3 jobs-to-be-done together) | N/A | single-reviewer concern |
| 3. Scope calibration? | FAIL (too much on wrong axes) | N/A | single-reviewer concern |
| 4. Alternatives explored? | FAIL (5 obvious alternatives unaddressed) | N/A | single-reviewer concern |
| 5. Competitive risks? | FAIL (no moat beyond aesthetic) | N/A | single-reviewer concern |
| 6. 6-month trajectory? | WEAK (distribution unaddressed) | N/A | single-reviewer concern |

### Critical CEO findings (surfaced as User Challenges)

**UC-1. Pick the wedge: OCR-powered Splitwise.** The plan tries to be trip planner + expense splitter + legacy dashboard preservation in one move. Real users pick one job. Recommendation: kill Phase 5 (map/itinerary), kill Phase 6 (legacy dashboard preservation), kill dual claim modes (ship tap-to-claim only), kill the group-mode toggle (every trip is a group trip). Collapses 6 phases to 4.

**UC-2. Ship Expo for v1, not Next.js.** Receipt capture is the killer flow. Camera on mobile web is clunky; PWA install is dead. Template already ships `apps/expo`. The plan picks Next.js because "that's what we know," which will be the 6-month regret.

**UC-3. Flip to Option A (Trip = Workspace).** Plan picks Option B out of obligation to template plumbing, not product reasoning. Option A is simpler, uses template plumbing as intended, and "ending a trip = archiving a workspace" is a feature (trips genuinely end). Add a "clone trip" escape hatch if repeat-group usage emerges.

### Other CEO findings

- **Alternatives not addressed**: Splitwise REST API as backend (2-week ship), shared Notion + Zapier, no-OCR-with-clever-keyboard, delete-legacy-dashboard, Expo-first.
- **No distribution/invite-loop story.** Splitwise grows via invites. This plan has no viral mechanic beyond "organizer emails people."
- **"Palantir aesthetic" is a vibe, not a moat.** Stop framing it as a differentiator in proposal text.

---

## Phase 2 — Design

### Consensus table (single voice)

| Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|
| 1. Information hierarchy specified? | FAIL | N/A | single |
| 2. Missing states covered? | FAIL (5 surfaces with critical gaps) | N/A | single |
| 3. Aesthetic coherence mobile↔desktop? | FAIL | N/A | single |
| 4. Specificity (component specs)? | FAIL (generic-pattern-as-spec) | N/A | single |
| 5. Responsive strategy defined? | FAIL (no breakpoints, no route×form-factor map) | N/A | single |
| 6. Accessibility floor declared? | FAIL | N/A | single |
| 7. Novel claim interaction designable? | FAIL (not ready for wireframes) | N/A | single |

### Critical design findings

**D-1. Phase-ordering bug.** Phase 2 trip creation requires `destinationLat/Lng/defaultZoom`, but the map component lives in Phase 5. Organizer at Phase 2 literally cannot name a destination. Fix: add a minimal server-side geocoded text picker to Phase 2.

**D-2. Claim interaction spec missing.** Tap-to-claim at a restaurant table is the novel UX. Plan has one paragraph. Missing: who sees whose claims pre-commit, conflict resolution UI+authority, pass-the-phone mode (one device shared), unclaimed-items resolution, optimistic rollback semantics, polling cadence. Must exist before Phase 3 starts. Write `docs/ai/CLAIM_SPEC.md`.

**D-3. Palantir-on-Mobile spec missing.** Plan says "mobile-first in-trip, desktop keeps high-density Palantir." That's a bimodal product with no middle ground. Need: 44px touch minimum with density override for desktop-only surfaces, 15px body type on mobile, route×form-factor table with breakpoints (0–767/768–1279/1280+).

**D-4. States matrix.** Every new surface is missing 3–5 states. Worst offenders: OCR-running (5–8s of nothing between upload and draft), claim conflict ("conflicts surface for resolution" is undefined), all-settled (the emotional peak is a table with a button).

**D-5. Accessibility floor undeclared.** WCAG target not specified. 4px base unit produces 28–32px buttons which fail 2.5.5. No keyboard equivalent for tap-to-claim. No text-alternate for map.

---

## Phase 3 — Eng (Architecture, Tests, Security)

### Consensus table (single voice)

| Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|
| 1. Architecture sound? | WEAK (migration + guards both under-specified) | N/A | single |
| 2. Test coverage sufficient? | FAIL (no multi-user Playwright, no OCR mock) | N/A | single |
| 3. Performance risks addressed? | OK (costs acceptable at family-trip scale) | N/A | single |
| 4. Security threats covered? | FAIL (cross-trip auth bleed risk) | N/A | single |
| 5. Error paths handled? | WEAK (failure modes undocumented) | N/A | single |
| 6. Deployment risk manageable? | OK (Forge pre-wired) | N/A | single |

### Critical Eng findings — must land before Phase 2 code

**E-1. Cross-trip auth bleed (CRITICAL security).** Plan uses `requireTripMember(tripId)` as a helper function. Helpers are opt-in — one forgotten call = full data breach. Fix: enforce as tRPC middleware chain `protectedProcedure → workspaceProcedure(wsId) → tripProcedure(tripId)` so individual routers cannot forget. Centralize in `packages/api/src/auth/guards.ts`.

**E-2. `@gmacko/storage` already exists with UploadThing.** Phase 3.2 tells engineers to build a parallel `packages/api/src/storage/` with `LocalDiskStorage`/`S3Storage`. That's a contradiction — the template already ships `@gmacko/storage`. Decide in Phase 3.0 whether to extend `@gmacko/storage` with an S3 backend (right for ForgeGraph bucket) or adopt UploadThing. Do not invent a parallel path.

**E-3. Magic link plan has real bugs.** `apps/nextjs/src/auth/server.ts` already passes `extraPlugins: [nextCookies()]`. `nextCookies()` **must remain last** in the plugin array (Better Auth requirement for Server Actions cookie capture). Correct shape: `[magicLink({...}), nextCookies()]`. Also missing: adding `magicLinkClient()` to `apps/nextjs/src/auth/client.ts` or `authClient.signIn.magicLink` is `undefined`.

**E-4. Use `@gmacko/realtime` (Pusher) for tap-to-claim, not polling.** Template ships Pusher broadcast primitives. Plan says "polling, no websockets v1" — leaving value on the table AND guaranteeing bad UX (2–5s lag between tap and partner seeing it → double-claims become the norm). Fix: channel per expense `private-expense-${expenseId}`, server triggers `line-item:claimed` events, client subscribes and invalidates TanStack Query. Polling as a 3s fallback when realtime disabled.

**E-5. Currency mixing = P0 bug.** Plan says "USD only v1" but OCR of a Tokyo receipt will happily extract JPY amounts into `subtotalCents` as if dollars. Silent data corruption. Fix: reject non-USD receipts at OCR time with currency detection, OR store currency per expense and refuse to mix in settlement.

### Other Eng findings

- **Phase 0 migration is fragile.** "Copy template tree into repo root" in one pass is risky. Prescribe atomic commit sequence: (1) adopt template, (2) restore preserved files, (3) delete Vite leftovers, (4)+ port components one at a time.
- **OCR pipeline runtime undefined.** "Queue OCR" has no queue package in template. Options: sync in dedicated Node route with `maxDuration: 60` returning a poll token, or stand up Inngest. Pick one in Phase 3.
- **Receipt PII policy absent.** Receipts contain last-4 card digits, loyalty numbers, sometimes full names. Plan says nothing about ACLs, signed URLs, or retention. Fix: private bucket + signed URLs + strip card-digit patterns + 90-day retention after trip end.
- **Prompt injection on OCR.** Malicious receipt image could inject instructions. Mitigate via structured output + reconciliation check (`subtotal + tax + tip == total ± $0.02`).
- **Settlement non-determinism.** Greedy algorithm produces different results on tied balances across page loads. Fix: stable tiebreaker via `(amount DESC, userId ASC)`, memoize per `(tripId, balances-hash)`.
- **Settlement race condition.** Two people marking same transaction paid simultaneously → double-debit. Fix: idempotency key on `settlements.record`.
- **Pin edit lock has no reaper.** 30s lock + laptop sleeps = user hits their own lock. Fix: 15s lock + 10s client heartbeat + `beforeunload` beacon release.
- **Directions cache scope.** Plan says "in-memory." Directions A↔B are identical for all members — cache per `(tripId, pinA, pinB, mode)`, not per user.
- **Google Maps key "session signing" is nonsense.** Restrict by HTTP referer in GCP console. Drop the session signing phrasing.
- **No multi-user Playwright.** Tap-to-claim needs two browser contexts (`browser.newContext()`). Plan's single-user e2e won't catch realtime bugs.
- **No Claude API mock strategy.** Add `MockOCRProvider` reading `packages/api/src/ocr/__fixtures__/*.json` keyed by image hash. Live OCR only behind `RUN_LIVE_OCR=1`.
- **Time zones undocumented.** "6pm on Tuesday" in Tokyo from a PST browser is a landmine.
- **Visual regression in Phase 6 only.** Should be a Phase 0 gate too — the whole point of Phase 0 is parity.

---

## Phase 4 — DX (Developer Experience)

### Consensus table (single voice)

| Dimension | Claude subagent | Codex | Consensus |
|---|---|---|---|
| 1. Time to hello world < 5 min? | FAIL | N/A | single |
| 2. Phase handoffs fresh-agent-safe? | FAIL (Phase 3 ambiguous) | N/A | single |
| 3. Error messages specified? | FAIL | N/A | single |
| 4. Local dev coherent? | FAIL (patchwork across OCR/email/storage) | N/A | single |
| 5. Test ergonomics? | WEAK | N/A | single |
| 6. Agent ergonomics? | FAIL (no COOKBOOK.md) | N/A | single |

### Critical DX findings

**DX-1. Path typo in Phases 2–5 (CRITICAL).** Plan Phase 0.5 correctly uses `apps/nextjs/src/app/...`. Phases 2.4, 3.7, 4.5, 5.5 write `apps/nextjs/app/app/...` — wrong path (no `src/`) AND a double `/app/app/` typo. Copy-paste will silently place files where Next.js cannot find them. Fix: global replace throughout Phases 2–5.

**DX-2. `bun test` throughout plan but template uses Vitest + pnpm.** Referenced in Phases 2 and 3. Copy-paste = immediate failure. Fix: global replace `bun test` → `pnpm -F @gmacko/api test` (or correct workspace filter).

**DX-3. Missing `docs/ai/COOKBOOK.md` (highest-leverage DX fix).** A fresh Claude session given Phase 2 will guess wrong about: (a) where to register a new tRPC router in `@gmacko/api`, (b) Drizzle's functional `pgTable` syntax (plan uses pseudo-syntax), (c) `@tanstack/react-form` against a tRPC mutation, (d) `pnpm -F @gmacko/ui ui-add` for shadcn primitives, (e) the trip-guard composition. Five worked examples, one doc.

**DX-4. Missing `docs/ai/LOCAL_DEV.md`.** Need exact sequence: Node 24 (nvm/fnm/flake), `corepack enable`, `docker compose up -d postgres`, env file checklist, `db:migrate`, `auth:generate`, `dev:next`. `scripts/doctor.sh` doesn't check `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, `STORAGE_*`, `GOOGLE_MAPS_API_KEY` — extend it.

**DX-5. No unified `DEV_MODE=local`.** Email → console, storage → disk, OCR → still burns real API. A solo builder iterating on receipt UI will either run up an Anthropic bill or hand-mock every time. Fix: `DEV_MODE=local` sets email=console, storage=disk, ocr=fixture in one switch. Add `OCR_PROVIDER=fixture` reading `packages/api/src/ocr/__fixtures__/*.json`.

**DX-6. Error Playbook missing.** No specification of what the user sees on OCR timeout, Claude 429, storage upload failure, magic-link delivery failure, invite token expiry. Add `docs/ai/ERROR_PLAYBOOK.md`.

**DX-7. Template sync untracked.** Phase 0.1 snapshots the template but doesn't record the upstream SHA. Add `docs/ai/TEMPLATE_SNAPSHOT.md` with SHA + `scripts/sync-template.sh` that diffs upstream at a target SHA against tracked paths.

**DX-8. Workspace onboarding cost for solo users (conditional on Option B).** "You must first create a workspace to create a trip" is a product smell. Fix: auto-create a personal workspace on first sign-in, hide the workspace surface behind `@gmacko/flags` until a second workspace exists.

---

## Cross-Phase Themes

Findings that appeared in multiple independent voices:

**T-1. "Too much hand-waving on novel interactions."** CEO flagged scope over-reach; Design flagged claim interaction spec missing; Eng flagged OCR runtime undefined; DX flagged no COOKBOOK for Phase 3 agent handoff. **All four reviews pointed at Phase 3 as the highest-risk phase.**

**T-2. "Option B needs more scaffolding than the plan admits."** CEO wants Option A (flip). Eng says B is viable only if `workspaceProcedure → tripProcedure` middleware chain lands first. DX says B adds onboarding friction for solo users. Three reviewers, three different angles, same conclusion: **the plan's Workspace commitment is under-specified.**

**T-3. "Template has more than you think."** Eng found `@gmacko/storage` already exists; Eng found `@gmacko/realtime` already ships Pusher; DX found `@gmacko/email` already uses Resend. **Phase 3 planning under-leverages what's already built.**

---

## Auto-Decided Items (no user gate needed)

The following were auto-decided under the /autoplan 6 principles and will be applied to the plan on approval:

| # | Decision | Principle | Rationale |
|---|---|---|---|
| A1 | Global replace `apps/nextjs/app/app/` → `apps/nextjs/src/app/` in Phases 2–5 | P5 explicit | mechanical bug, one right answer |
| A2 | Global replace `bun test` → correct pnpm filter | P5 explicit | mechanical bug |
| A3 | Enforce `nextCookies()` last in `extraPlugins` array | P5 explicit | Better Auth hard requirement |
| A4 | Add `magicLinkClient()` to `apps/nextjs/src/auth/client.ts` | P1 completeness | without this the signin API is `undefined` |
| A5 | Phase 3.2: extend `@gmacko/storage` rather than build parallel path | P4 DRY | duplicate functionality rejected |
| A6 | Use `@gmacko/realtime` (Pusher) for tap-to-claim; polling only as fallback | P1 completeness | realtime ships in template |
| A7 | Cross-trip auth via tRPC middleware chain, not helper function | P1 completeness, P5 explicit | helper = opt-in = breach risk |
| A8 | Store `currency` per expense and refuse cross-currency settlement | P1 completeness | silent data corruption is P0 |
| A9 | Deterministic settlement: sort by `(amount DESC, userId ASC)`, memoize per balances-hash | P5 explicit | non-determinism is user confusion |
| A10 | Idempotency key on `settlements.record` | P1 completeness | prevents double-debit race |
| A11 | Pin edit lock: 15s + 10s client heartbeat + beforeunload beacon | P5 explicit | no reaper needed |
| A12 | Directions cache scope: shared per `(tripId, pinA, pinB, mode)` | P4 DRY | per-user is wasteful |
| A13 | Drop "session-signed" phrasing on Google Maps key; document HTTP referer restriction | P5 explicit | session signing is nonsense |
| A14 | Phase 0.1 atomic commit sequence: (1) adopt template, (2) restore preserved, (3) delete Vite | P5 explicit | reduces migration risk |
| A15 | Phase 0 visual regression snapshot gate (not just Phase 6) | P1 completeness | parity is Phase 0's whole point |
| A16 | OCR retention policy: raw image 90 days after trip end, extracted fields permanent | P1 completeness | PII obligation |
| A17 | OCR prompt injection: structured output + reconciliation check explicit in plan | P5 explicit | tightens existing check |
| A18 | Strip card-digit patterns post-OCR | P1 completeness | PII obligation |
| A19 | `MockOCRProvider` reading fixtures keyed by image hash; live OCR behind `RUN_LIVE_OCR=1` | P1 completeness | test ergonomics |
| A20 | Multi-user Playwright spec for tap-to-claim | P1 completeness | single-user e2e misses realtime bugs |
| A21 | Add Phase 0.8: extend `scripts/doctor.sh` to check all required env vars | P1 completeness | prevents cryptic first-run failures |
| A22 | Add Phase 0.9: scaffold `docs/ai/LOCAL_DEV.md`, `COOKBOOK.md`, `ERROR_PLAYBOOK.md`, `TESTING.md`, `TEMPLATE_SNAPSHOT.md` | P1 completeness | documentation as deliverable |
| A23 | Add Phase 0.A: unified `DEV_MODE=local` env var setting email=console + storage=disk + ocr=fixture | P3 pragmatic | single switch for solo iteration |
| A24 | Add Phase 2 destination picker (server-side geocode text search, no Maps JS) | P1 completeness | fixes phase-ordering bug |
| A25 | Elevate "Claim Interaction Spec" (`docs/ai/CLAIM_SPEC.md`) to Phase 3 prerequisite | P1 completeness | Design flagged as blocker |
| A26 | Add "Palantir on Mobile" section to DESIGN.md before Phase 3 | P1 completeness | mobile density rules |
| A27 | Add States Matrix requirement (5 states per component) to Phase 3+ | P1 completeness | prevents half-built surfaces |
| A28 | Declare WCAG AA floor + 44px touch min (with desktop density override) in DESIGN.md | P1 completeness | a11y baseline |
| A29 | Venmo handle field on `tripMembers`; deep-link buttons on suggested transactions; 24h undo | P5 explicit | real-world settlement happens off-app |
| A30 | Add time zone strategy: store `tz` per trip + render in trip-local time | P1 completeness | 6pm-in-Tokyo landmine |

---

## User Challenges (decide at the gate)

Three decisions the models recommend changing but require user judgment. The user's original direction is the default.

### UC-1 — Scope wedge

**What the user said:** build a group trip command center with shared itinerary (map + timeline), expense splitting with OCR, settlement, and preserve the legacy family dashboard. Group-mode as a per-trip toggle alongside family mode. Dual claim modes (tap-to-claim + organizer-assign).

**What the CEO review recommends:** **Cut Phase 5 (map/itinerary), cut Phase 6 (legacy preservation), cut dual claim modes (ship tap-to-claim only), cut group-mode toggle.** Pick the wedge: "OCR-powered Splitwise." v1 ships trips + members + receipts + OCR + tap-to-claim + settlement. Six phases collapse to four.

**Why:** Real users pick one job-to-be-done. Families planning trips don't settle expenses (one parent pays). Friend groups settling expenses don't build Gantt timelines. Wanderlog already does the map better. The differentiator is "point camera, everyone claims their items, done in 60 seconds" — everything else is table stakes or scope creep. 6-month regret: "we spent Phase 0 migrating a dashboard nobody uses."

**What we might be missing:** The user may actually be building this for a specific group that genuinely needs all three (a family reunion where one cousin coordinates logistics + Splitwise-style splitting + a shared agenda). Or the legacy dashboard may have sentimental / portfolio value that justifies preservation. Or the user may already have tried Splitwise and found the UX unacceptable at a different axis than OCR.

**If we're wrong, the cost is:** a narrower v1 that ships faster and can grow into itinerary later as v2. Worst case: we ship the wedge, nobody cares about OCR without the map context, and we add the map in v2. Not a destroyed project.

**Your call — your original direction stands unless you explicitly change it.**

---

### UC-2 — Next.js vs Expo for v1

**What the user said:** migrate the Vite React app into the create-gmacko-app template (which ships `apps/nextjs`, `apps/expo`, `apps/tanstack-start`). Conversation implied web-first via `apps/nextjs`. Responsive with mobile-first for in-trip use.

**What the CEO review recommends:** **Ship `apps/expo` as the v1 target, not `apps/nextjs`.** Receipt capture is the killer flow; camera + photo library access on mobile web is clunky; PWA install is dead in 2026. Template already ships `apps/expo`. The Next.js web app becomes the planning surface, not the receipt-capture surface.

**Why:** Receipt capture is a camera operation and competitors (Splitwise mobile, Tricount) are all mobile-native. Web camera UX is inferior on every axis except "I already know React on web." 6-month regret: "we built it on Next.js when we should have built it on Expo."

**What we might be missing:** The user is a solo builder with Claude Code, comfortable with Next.js, unfamiliar with Expo. The 10x productivity of staying in a known stack may outweigh the UX advantage of native. Also, Expo e2e (Maestro, Detox) is harder to run in CI than Playwright. Also, distribution via App Store takes real time (review cycles, cert management) — web can ship in a day.

**If we're wrong, the cost is:** a web app that's slightly harder to capture receipts with, which is the one thing competitors do better. But it ships in weeks instead of months.

**Your call — your original direction (web-first via `apps/nextjs`) stands unless you explicitly change it.**

---

### UC-3 — Trip = Workspace (Option A) vs Trip ⊂ Workspace (Option B)

**What the user said:** not explicitly — the plan's current recommendation is Option B (Workspace = long-lived group, Trip = child entity with its own invite subset).

**What the CEO review recommends:** **Flip to Option A (Trip = Workspace).** Simpler, reuses template plumbing as intended, "ending a trip = archiving a workspace" is a feature not a bug. Add a "clone trip" button for the rare repeat-group case.

**What the Eng review recommends:** **Stay with Option B** — but only if the workspace middleware chain (`workspaceProcedure → tripProcedure`) lands before any trip router code. Option B is structurally right; it's just that the plan under-specifies the guard scaffolding.

**Why the models disagree:** CEO prioritizes product simplicity and time-to-ship. Eng prioritizes scaling paths and template alignment. Both are valid perspectives.

**What we might be missing:** The user may have a specific long-lived social unit in mind (a family that takes 3 trips a year, a friend group that does an annual reunion). If that's the product reality, Option B is right and the repeat-invite-flow cost is real. If the user expects most trips to be one-off (a bachelor party that will never reconvene), Option A is simpler and good-enough.

**If we're wrong:**
- Pick A, reality is "repeat groups": users re-invite each other every trip. Annoying but survivable. Add `cloneTripFromPrevious(tripId)` helper in v1.1.
- Pick B, reality is "one-off trips": we paid for a multi-tenant layer we don't use. Unused cruft, but not broken.

**Lean:** This is a taste decision the user should make based on who the actual target users are.

---

## Taste Decisions (recommend, user can override)

1. **Realtime for tap-to-claim**: Pusher primary, 3s polling fallback. Lean A (realtime primary).
2. **Edit lock strategy for pins**: 15s server lock + 10s client heartbeat + beforeunload beacon vs. 30s no-heartbeat. Lean A (heartbeat).
3. **OCR runtime**: dedicated Node route with `maxDuration: 60` returning a poll token vs. Inngest queue. Lean A (no new infra).
4. **Currency handling**: reject non-USD at OCR time vs. store per expense and refuse mixing. Lean B (less lossy, user can correct).
5. **Visual regression snapshot**: Playwright screenshot diff vs. a dedicated visual tool (Chromatic). Lean A (no new infra).

---

## Review Scores

- **CEO**: 3 User Challenges surfaced; scope challenge is the most important call in this whole review.
- **Design**: infrastructure-strong, design-weak. 5 critical findings blocking Phase 3 start.
- **Eng**: 4 critical findings + ~15 medium. All actionable. Security middleware chain and currency handling are non-negotiable.
- **DX**: 2 mechanical bugs (path typo, `bun test`) + 6 documentation gaps. Fix path typo first.

## Dual Voice Status

**Codex cross-validation: skipped.** All findings above are from Claude subagents only. Tagged `[subagent-only]` per /autoplan degradation matrix. If the user wants independent validation on the user challenges specifically, run `codex exec` with the UC-1/UC-2/UC-3 framings after the gate.

## Next Step

User decides the 3 User Challenges at the final approval gate. On approval:
1. Apply A1–A30 auto-decisions to `IMPLEMENTATION_PLAN.md`
2. Create the spec docs flagged by UC/Design (CLAIM_SPEC.md, Palantir-on-Mobile, States Matrix)
3. If scope changes (UC-1), rewrite affected phases
4. If platform changes (UC-2), rewrite Phase 0 to target `apps/expo`
5. If tenancy changes (UC-3), rewrite Phase 2 architecture

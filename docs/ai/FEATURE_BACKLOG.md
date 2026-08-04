# Feature Backlog — Finish All Product Work

**Created:** 2026-07-13  
**Execution order (user-selected):** destination polish → tech debt → road-trip planner → offline-first → App Store  
**Ground truth:** code inspection of `master` / working copy on 2026-07-13. Supersedes stale “not built” claims in `STATUS.md` where they conflict.

---

## Status legend

| Tag | Meaning |
|-----|---------|
| ✅ Done | Shipped and usable end-to-end |
| 🟡 Partial | API/schema/UI half-done; named gap below |
| ❌ Open | Spec exists or gap verified; not implemented |
| ⏸ Deferred | Explicit non-goal or external blocker |

---

## Track 0 — Inventory (this doc)

Write and maintain this backlog as the ordered source of remaining work. Update `docs/ai/STATUS.md` after each track lands.

---

## Track 1 — Destination-trip polish

Goal: group destination trips feel complete on web **and** mobile for lodging, rooms, and arrivals.

| ID | Item | Status | Evidence / gap |
|----|------|--------|----------------|
| D1 | Room assignments API | ✅ | `packages/api/src/router/rooms.ts` + tests |
| D2 | Room board (web) | ✅ | `apps/nextjs/.../lodging/_components/room-board.tsx` |
| D3 | Room board (mobile) | ✅ | `apps/expo/src/components/trip/room-board.tsx` + lodging screen |
| D4 | Member transit CRUD + list | ✅ | Create, edit, list, refresh all wired on web (2026-08-03) |
| D5 | AviationStack refresh (web) | ✅ | `refreshTransitStatus` + `transit-refresh-button.tsx` |
| D6 | AviationStack refresh (mobile) | ✅ | "Refresh status" on flight transit rows |
| D7 | Ground transport groups | ✅ | API + web + mobile join/leave |
| D8 | Personal workspace on first use | ✅ | `ensurePersonalWorkspace` from trips server path |
| D9 | Workspace switcher in nav | ✅ | Flag-gated on trips list |
| D10 | `workspacesVisible` flag | ✅ | `@sortey/flags` — off in prod, on in dev/staging |

> **Audit + fix (2026-08-03).** `scripts/audit-orphans.ts` found 29 of 211
> procedures with no caller. The lodging page rendered three `disabled`
> buttons over working procedures, so the whole write half of the feature was
> unreachable. Now wired on web: `createLodging`, `deleteLodging`,
> `createTransit`, `createTransportGroup`. Down to 24 orphans.
>
> Lodging is now fully wired — create, edit, guests, delete, plus transit
> create/edit and transport-group create. Down to 21 orphans. `listForSegment`
> gained `guestUserIds` because `setGuests` replaces the whole list, and an
> editor that cannot read the current one can only clobber it.
>
> **Pin editing does not exist on any surface (2026-08-03).** `pins.update`,
> `acquireEditLock`, `releaseEditLock`, and `setAttendees` are all uncalled —
> pins can be created and deleted, not edited. The edit-lock machinery is
> complete and correct (TTL column, expiry respected on both acquire and
> update); it is waiting for an edit form nobody has built. Wiring the locks
> means building pin editing first.
>
> Still unwired, each needing a product call rather than a deletion:
> `trips.joinSegment` / `leaveSegment`, `planner.suggestOvernightsTrip`,
> `corridor.amenityGroups` / `searchCached`, and the eight `admin.*`
> procedures (no admin surface exists yet).

**Track 1 acceptance**

- [x] Mobile lodging: view/create/delete rooms, assign/unassign occupants (parity with web RoomBoard)
- [x] Mobile lodging: refresh flight status for flight transits (parity with web)
- [x] `workspacesVisible` flag defined; switcher hidden when disabled (default: multi-tenant off / solo UX)

---

## Track 2 — Tech debt / hygiene

| ID | Item | Status | Notes |
|----|------|--------|-------|
| T1 | Delete `/demo` static dashboard | ✅ | Removed 2026-07-13; live dashboard at `[tripId]/dashboard/` |
| T2 | Shared money formatters | 🟡 | `@sortey/validators/money` exists; lodging page adopted; more pages remain |
| T3 | Shared status tone maps | 🟡 | trips list uses `tripStatusTone`; broader adoption still open |
| T4 | Split `trips.ts` god router | 🟡 | Domain already coexists under `packages/api/src/trips/*`; full router file split deferred |
| T5 | Trip-table RLS in migrations | ✅ | `packages/db/drizzle/0012_trip_workspace_rls.sql` + journal; also `pnpm --filter @sortey/db rls` |
| T6 | Expenses list pagination | ✅ | Keyset pagination in `expenses.list` |
| T7 | Advisor plans 001–006 | ✅ | All MERGED 2026-06-17 |

**Track 2 acceptance**

- [ ] `/demo` removed or redirected; no dead 6k-line shell
- [ ] Web lodging/expenses use shared formatters where trivial
- [ ] Optional: first cut of trips router split (members/invites/segments) if low-risk

---

## Track 3 — Road-trip planner depth

Source: `docs/plans/2026-07-09-itinerary-planner.md`, DayMap/DriftPort specs, `CONTEXT.md`.

| ID | Item | Status | Gap |
|----|------|--------|-----|
| R1 | Trip days CRUD + seed + replan draft | ✅ | |
| R2 | Full map plan + amenity scan | ✅ | |
| R3 | Today Command + reality replan | ✅ | W1+W2 shipped |
| R4 | Side-trip detect + prompt + formal pause | ✅ | `assessSideTrip` + Explore sets `runState`; en_route→paused lifecycle sync; Resume on plan (Drive + Today) |
| R5 | Fuel zones + overnight zones | ✅ | `computeFuelZones` / zones API; mobile route-ahead |
| R6 | Route gradient (web) | ✅ | `route-gradient-map.tsx` |
| R7 | Route gradient (mobile Driving Mode) | ✅ | `RouteAheadCard` gradient bar + zone markers on Drive |
| R8 | P2 hour-aware packer for plain A→B | ✅ | `estimateDriveDays` + `totalDriveMiles` / `leadInMiles` on replanDraft |
| R9 | P4 dual-candidate routes (coast vs inland) | ✅ | `listCandidates` + select; `planRoute.preferredRoute` writes chosen polyline |
| R10 | P5 cut-if-behind automation | ✅ | `cut-if-behind.ts` + replan wiring: a `behind` replan drops the days the traveller pre-authorised (never a drive, event, or anchored day), reports each cut with their own words, and names the shortfall when cutting everything allowed still is not enough |
| R11 | Predicted Stop as first-class list | ✅ | Predicted stops list on Route Ahead (fuel + overnight zones) |
| R12 | DriftPort predictive service logistics | 🟡 | Telemetry spike + service queue; full consumption→POI matching open |
| R13 | Work-window finder (DayMap B1) | 🟡 | `daymap/work-window.ts` — pure planner ranking the day's parts against drive time, house power, and connectivity, with named blockers when nothing fits. Input-driven (manual or telemetry); not yet wired to a surface |

**Track 3 acceptance (near-term)**

- [x] Formal pause/resume for side trips (`runState` / trip status coherent with UI)
- [x] Hour-aware day packer for simple A→B plans
- [x] Predicted overnight/fuel suggestions surface as a list on Route Ahead
- [x] Dual-candidate route preview (listCandidates)

**Track 3 later**

- Full DriftPort predictive loop (R12–R13)
- Web Plan Route dual-candidate picker (mobile done)

---

## Track 4 — Offline-first mobile

Source: `docs/ai/OFFLINE_FIRST_DESIGN.md` (status: Design, not fully implemented).

| ID | Item | Status |
|----|------|--------|
| O1 | Journey stop outbox | ✅ |
| O2 | Today Command offline cache | ✅ |
| O3 | Trip offline pack (driving, segments, zones, today, days) | ✅ | Road-trip home “Make available offline” |
| O4 | Fuel log outbox | ✅ | Queue when offline/fail; global flush |
| O5 | Driving Mode offline shell | 🟡 | Uses offline pack for drivingSummary; map tiles still need network |
| O6 | NetInfo banner + Sync now | ✅ | Root `OutboxSyncHost` |
| O7 | Expense / pin outbox | ✅ | `capture-outbox` — expense.create + pin.create |
| O8 | react-query FileSystem persist | ✅ | Trip-scoped query dehydrate/restore (`query-persist.ts`) |
| O9 | MMKV + full cache / map tiles | ❌ | Optional upgrade; tiles still need network |

**Track 4 acceptance**

- [x] Airplane-mode: queue fuel + journey + expense + pin; flush on reconnect
- [x] Trip offline pack + Drive shell + query-cache restore
- [x] Tests for fuel + capture outboxes
- [ ] Map tiles offline (v2)

---

## Track 5 — App Store / launch finish

Source: `docs/ai/LAUNCH_READINESS.md`.

| ID | Item | Status |
|----|------|--------|
| A1 | Production iOS build + ASC submit | ✅ build 7 + EAS submit FINISHED (`dcc419a5`) |
| A2 | Permission strings + metadata | ✅ |
| A3 | Screenshots 6.9" + iPad 13" | ❌ / 🟡 drafts may exist |
| A4 | App Privacy questionnaire (ASC) | ❌ manual |
| A5 | TestFlight device pass | 🟡 binary in ASC — install & smoke on device |
| A6 | Submit for App Review | ❌ after screenshots + privacy + TF smoke |

**Track 5 acceptance**

- [ ] Screenshot sets uploaded
- [ ] Privacy labels complete
- [ ] TestFlight green on at least one physical iPhone
- [ ] “Waiting for Review” or later

---

## Explicitly deferred

| Item | Why |
|------|-----|
| SMS / 10DLC invites | Device share sheet is near-term; A2P doc is historical |
| Multi-currency settlement | Product non-goal v1 |
| Flight/hotel booking | Non-goal |
| Real-time collaborative cursors | Non-goal |
| Full SQLite mirror offline | Only if cache+outbox is insufficient |

---

## Execution checklist (this campaign)

1. [x] Track 0 — this backlog
2. [x] Track 1 — D3, D6, D10 (and wire D9)
3. [x] Track 2 — T1 done; T2/T3 partial; T4/T5 deferred
4. [x] Track 3 — R4 formal pause, R8 hour packer, R11 predicted-stop list (R9 dual-candidate still open)
5. [x] Track 4 — fuel + expense/pin outboxes, query persist, offline pack, NetInfo banner
6. [x] Track 5 — docs + checklist + drafts inventory (`APP_STORE_CHECKLIST.md`); **ASC upload still manual**

When a track completes, update this file and `docs/ai/STATUS.md` in the same change.

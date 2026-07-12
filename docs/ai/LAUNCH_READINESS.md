# Launch Readiness

**Last assessed:** 2026-07-12  
**Method:** code-grounded audit against `master` + planner/OTA ship + remaining gap implementation.

This is a living checklist. It distinguishes a **private launch** (trusted dogfood / family beta) from a later **public launch**.

## TL;DR

Private launch is **ready for dogfood** on `sortey.app` + Expo OTA:

- Auth, expenses/claims, settlement, chat, road-trip planner, amenities, journey log
- Production API + web deployed; planner OTA on production/preview/development
- Van Journey (Open Sauce arc) seeded with curated overnights
- Launch hardening landed: rate limits (chat + share-link), legal/pricing copy, workspace setup error page, side-trip probe, push client flag ON

Remaining private gaps are **ops** (Resend domain, Sentry/PostHog keys) not product code.

Public launch still needs RLS wiring (session context), stronger global rate limits, and a billing decision when charging users.

---

## Private launch (dogfood / trusted group)

### Blockers

| Item | Status | Notes |
|---|---|---|
| Magic-link sending domain in Resend (`noreply@…`) | **OPS** | Cannot finish in code. Smoke magic-link on production after DNS verify. |
| Production API + web | ✅ | `https://sortey.app` — planner procedures live |
| Mobile JS (planner + amenities) via OTA | ✅ | Fingerprint runtimes; see `MOBILE_OTA_PREFLIGHT.md` |
| `/api/dev/auto-login` guarded outside dev | ✅ | `assertDevAuthEnabled` |
| Homepage not linked to legacy `/demo` | ✅ | Demo route may still exist for internal use |

### Should-fix (code)

| Item | Status | Notes |
|---|---|---|
| Workspace auto-provision silent fail | ✅ | Redirects to `/trips/setup-error` with Retry |
| Workspace switcher on trips list | ✅ | Renders when user has >1 workspace |
| Rate limit chat send | ✅ | 30/min per user+trip (`assertRateLimit`) |
| Rate limit share-link join + preview | ✅ | Per user + per token buckets |
| Terms of service (real copy) | ✅ | `/terms` — Gmacko Ventures LLC |
| Pricing (free beta decision explicit) | ✅ | `/pricing` — $0 free beta; paid later |
| Privacy policy | ✅ | Already real (`/privacy`) |
| Push registration flag | ✅ | `integrations.notifications = true` |
| Sentry/PostHog DSNs in deploy env | **OPS** | Config defaults ON; missing keys no-op |

### Road-trip / planner (dogfood)

| Item | Status |
|---|---|
| Trip Day planner + full map plan | ✅ |
| Replan from date / GPS | ✅ |
| iOverlander overnight + amenity scan | ✅ |
| Web day plan + amenity panels | ✅ |
| Expo day plan / drive / map | ✅ |
| Fuel zones + route-ahead (mobile) | ✅ (`RouteAheadCard` + `predictZones`) |
| Side-trip detection (>2 mi off route) | ✅ (`routePlanner.assessSideTrip` + Drive banner) |
| Corridor search (web + mobile map) | ✅ |
| iOverlander data for primary workspace | ✅ (~62k POIs) |

---

## Public launch (additional)

### Blockers

| Item | Status | Notes |
|---|---|---|
| Real legal + pricing | ✅ for free public soft-launch | Revisit if charging |
| Enable Row-Level Security | ⏳ **Deferred** | Policy builders in `packages/db/src/{tenant,rls}.ts` exist. **Must not** `ENABLE/FORCE RLS` until every request path calls `applyDatabaseSessionContext` (sets `app.user_id` / `app.workspace_id`). App-level `tripProcedure` remains primary control. |
| Rate limiting (chat + share) | ✅ best-effort per isolate | Upgrade to DO/CF binding for global quotas at scale |
| Billing decision | ✅ free beta | Stripe/RevenueCat stay `false` until paywall designed |

### Should-fix

- [ ] Accessibility pass (expenses, itinerary, settlement)
- [ ] DB-backed integration tests for settlement money path
- [ ] Maestro receipt → claim → settle path
- [ ] Global rate limits (CF / DO), not only in-process maps
- [ ] RLS migration + session wiring end-to-end

---

## Feature maturity (2026-07-12)

| Feature | Status |
|---|---|
| Ferry legs | ✅ |
| Room assignments | ✅ |
| Corridor / van POI | ✅ (web + mobile map; import ops per workspace) |
| Receipt OCR write-path | ✅ |
| Multi-day itinerary planner | ✅ |
| OTA + preflight docs | ✅ |
| AviationStack live transit | ⏳ open (schema only) |
| Predicted Stop auto-pins | ⏳ partial (fuel/overnight zones exist; generic predicted stop pins not) |
| Side trip | ✅ detect + prompt; no formal “paused trip” state machine yet |
| driftport van telemetry | post-launch spike |

---

## Production ship checklist (operator)

1. [x] Deploy web/API to `sortey.app`
2. [x] Apply `0010_trip_day_planner` migration
3. [x] Publish EAS Update production / preview / development
4. [x] Seed Open Sauce remaining arc + curated overnights
5. [ ] Verify Resend domain + magic-link E2E
6. [ ] Confirm Sentry + PostHog project DSNs on Worker
7. [ ] Device: OTA pull → Day plan / Drive / Map smoke
8. [ ] Optional: new native build for pre-fingerprint binaries

---

## Code map (launch hardening 2026-07-12)

| Concern | Path |
|---|---|
| Rate limit util | `packages/api/src/rate-limit.ts` |
| Chat / share wiring | `packages/api/src/router/chat.ts`, `trips.ts` |
| Side trip pure + API | `packages/api/src/route-planner/side-trip.ts`, `router/route-planner.ts` |
| Drive UI banner | `apps/expo/src/components/trip/side-trip-card.tsx` |
| Workspace error | `apps/nextjs/src/app/trips/setup-error/page.tsx` |
| Terms / pricing | `apps/nextjs/src/app/terms/page.tsx`, `pricing/page.tsx` |
| Config flags | `packages/config/src/integrations.ts` |
| OTA preflight | `docs/ai/MOBILE_OTA_PREFLIGHT.md` |
| Planner design | `docs/plans/2026-07-09-itinerary-planner.md` |

---

## Verified solid (no action)

Auth (magic link + social), expenses + claims + OCR, settlement algorithm, chat WS, share invites, Cloudflare Workers/Hyperdrive/R2, planner + amenities, mobile driving mode, ferry, rooms.

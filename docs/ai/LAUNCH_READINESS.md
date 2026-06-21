# Launch Readiness

**Last assessed:** 2026-06-21 (master after ferry-legs merge `608d58f`)
**Method:** code-grounded audit, each claim verified against source — see notes on corrected findings below.

This is a living checklist. It distinguishes a **private launch** (the planned ~30-person family-reunion beta in `LAUNCH_PLAN.md`) from a later **public launch**, because the bar differs sharply.

## TL;DR

The core product works end-to-end: auth, expenses + line-item claiming, settlement math (plan-001 fixed), realtime, mobile parity, ferry legs. Billing is intentionally dormant. The gap to a **private** launch is small (one ops step + two tiny code fixes, mostly done here). A **public** launch additionally needs real legal/pricing pages, RLS, rate limiting, and a billing decision.

## Corrected audit findings (do not re-file these as bugs)

An automated audit overstated or mis-reported two items; verified reality:
- **`expenses.list` pagination — NOT missing.** Full keyset pagination (`limit` + `cursor`, clamped) exists (`packages/api/src/router/expenses.ts`, commit `9737839`).
- **Dev auth endpoints — not "account takeover."** `last-magic-link` was already guarded. `auto-login` lacked the `NODE_ENV` guard, but the real impact was "can trigger a magic-link email to an arbitrary address" (spam/enumeration), not session theft (the attacker never receives the emailed link). Guard added on branch `chore/launch-hardening`.

## Private launch (family-reunion beta)

### Blockers
- [ ] **Verify the magic-link sending domain in Resend** (`noreply@gmacko.io`). OPS ACTION — cannot be done in code. Without it, login emails bounce and no one can sign in. Smoke-test the full magic-link path in staging afterward.
- [x] **Guard `/api/dev/auto-login`** with `assertDevAuthEnabled(env.NODE_ENV)` → 404 outside dev (matches `last-magic-link`). Done (`chore/launch-hardening`).
- [x] **Unlink `/demo`** from the public homepage CTA. Done. (Full deletion of the ~6k-line legacy `app-shell.tsx` demo route is a separate cleanup — see post-launch.)

### Should-fix (rough edges, not blockers for a trusted internal group)
- [ ] Workspace auto-provisioning fails silently (`apps/nextjs/src/app/trips/_lib/server.ts`) — show an error banner + retry instead of a blank redirect.
- [ ] Confirm Sentry/PostHog DSNs are actually set in the deploy env (config defaults them ON; missing keys silently no-op).

## Public launch (additional to the above)

### Blockers
- [ ] **Real legal + pricing pages.** `terms/page.tsx` and `pricing/page.tsx` are placeholders ("Replace this…", "Coming soon"). Either write them or remove `pricing` from nav if launching without billing.
- [ ] **Enable Row-Level Security.** Policy builders exist (`packages/db/src/tenant.ts`) but no `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` DDL is in the migrations. App-level `tripProcedure` guards are the primary control and are solid; RLS is the missing defense-in-depth layer for a multi-tenant public app.
- [ ] **Rate limiting.** Two real `TODO(ratelimit)` sites: `chat.ts` (high-freq authenticated write) and `trips.ts` (unauthenticated share-token join). `@sortey/config` already defines `rateLimits` scopes — extend to `chat` + `share-link`.
- [ ] **Billing decision.** `stripe/billing/revenuecat = false`. Correct for a free internal launch. For public: either keep free-tier explicitly or implement a paywall (e.g. trip limit) + Stripe subscription before flipping it on.

### Should-fix
- [ ] Mobile bundle id/scheme (`com.gmacko.sortey` / `sortey://`) finalized for the public App Store listing.
- [ ] Accessibility pass (semantic markup on expenses table, itinerary timeline, settlement cards).
- [ ] DB-backed integration tests for the settlement flow + a mobile Maestro "receipt → claim → settle" path. Money is the core; coverage is currently in-memory-store only.

## Underdeveloped features (ranked by readiness-to-finish)

1. **Ferry legs** — ✅ shipped (this is the feature that prompted this doc).
2. **Room assignments** — schema + storage exist; **no UI**. ~1-2 days.
3. **Corridor / van-POI search** — PostGIS backend ready (`corridor.ts`); **no UI, no data import** (iOverlander/Rec.gov). The campsite/dump-station discovery story.
4. **AviationStack live transit** — `memberTransits` populated; live-flight API never wired.
5. **Road-trip core (designed, ~0 code):** predicted stop, side-trip detection, fuel zones, route-gradient on mobile.
6. **Receipt OCR write-path** — extractors exist; ferry just proved the write path (`extract-structured.ts`). Wire it into `expenses` reusing that plumbing.

## driftport integration (van road-trips) — recommended, post-private-launch

`/Volumes/dev/driftport` is an **IoT control plane for van systems** (battery/solar/climate/water telemetry, remote control, OTA) — vehicle *internals*. Sortey owns trip *externals*. **No feature overlap**; both share the same stack (tRPC + Drizzle + better-auth + CF Workers).

- **Don't duplicate data.** Map `trip.vanProfileId → driftport rig`; one tRPC call (`system.dashboard`) overlays live battery/water/climate on Sortey's **Driving Mode** (where the ferry "leave-by" gating already lives).
- **Differentiator:** campsite pin (Sortey) + "4h solar left, full by 6pm" (driftport) = "should we move?" No competitor pairs trip planning with power-readiness.
- **Open seams:** trip-member ↔ rig-member permission federation; merging GPS position + vehicle-state realtime channels.
- **Caveat:** driftport is also pre-1.0 with dormant billing + a stubbed real-hardware MQTT bridge. Treat as a post-private-launch spike, not a day-0 dependency.

## Verified solid (no action)

Auth (magic link + social), expenses + line-item claims + OCR reconcile, settlement algorithm (plan-001 fixed), realtime claiming/chat/locations, trip invites + share tokens, mobile feature parity, Cloudflare Workers/Hyperdrive/R2 config, full schema migrated, error pages.

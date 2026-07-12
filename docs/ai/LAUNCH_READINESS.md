# Launch Readiness

**Last assessed:** 2026-07-12  
**Method:** code-grounded audit + ops smoke + production dogfood.

## TL;DR

Private launch is **ready for dogfood** on `sortey.app` + Expo OTA.

- Production web/API healthy; planner + side-trip live
- Magic-link is production sign-in (dev auto-login local only)
- Sentry DSN on Worker; Resend key present; from `noreply@gmac.io`
- Legal pages live; free-beta pricing explicit

**You:** open inbox for magic link · phone OTA smoke.

## Production ship checklist

1. [x] Deploy web/API to `sortey.app`
2. [x] Apply `0010_trip_day_planner` migration
3. [x] Publish EAS Update production / preview / development
4. [x] Seed Open Sauce remaining arc + curated overnights
5. [x] Magic-link API + live send to operator emails (`status:true`); from `noreply@gmac.io`
6. [x] Production sign-in form defaults to magic link (not `/api/dev/auto-login`)
7. [x] Sentry DSN on Worker vars (shared Expo project). PostHog still optional.
8. [x] Legal: `/terms`, `/pricing`, `/trips/setup-error`
9. [x] Health: `/api/health` healthy + DB pass
10. [ ] Device: OTA pull → Day plan / Drive / side-trip
11. [ ] Click magic-link in inbox to complete session E2E

## Deferred (public launch)

- RLS FORCE (needs session context wiring first)
- Global rate limits (DO/CF)
- PostHog key
- Formal paused-trip state machine

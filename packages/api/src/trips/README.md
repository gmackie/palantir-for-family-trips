# trips domain modules

This package folder holds pure trip domain helpers used by routers and tests:

- `status-transitions.ts` — lifecycle state machine
- `segment-guard.ts` — cross-trip segment validation
- `driving-summary.ts` — day-of driving dashboard payload

The large `packages/api/src/router/trips.ts` still owns tRPC procedures + the
in-file `TripStore`. Further router splits should move procedures into
`packages/api/src/router/trips/*.ts` and recompose `tripsRouter` without
changing procedure paths.

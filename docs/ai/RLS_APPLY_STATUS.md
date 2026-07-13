# RLS apply status (production DB `trip` / user `trip_app`)

**Last applied:** 2026-07-13

## Applied successfully (RLS + FORCE + policies)

Core tenancy + money:
- `workspace`, `workspace_membership`, `workspace_invite_allowlist`
- `workspace_subscription`, `workspace_usage_rollup`
- `trip`, `trip_segment`, `trip_member`, `trip_invite`, `segment_member`
- `expense`, `line_item`, `receipt_image`
- `application_settings`

Later trip domain (trip_app-owned):
- `journey_stop`, `trip_message`, `ferry_crossing`, `fuel_log`
- `gps_track_point`, `trip_share`, `trip_anchor`, `trip_day`
- `van_state_reading`, `member_location`

## Not applied — wrong table owner (`postgres`)

`trip_app` cannot `ENABLE ROW LEVEL SECURITY` on tables it does not own:

| Table | Action needed (superuser once) |
|-------|--------------------------------|
| `line_item_claim` | `ALTER TABLE line_item_claim OWNER TO trip_app;` then `pnpm --filter @sortey/db rls` |
| `pin`, `lodging`, `poll`, `proposal`, `settlement`, `trip_photo`, `itinerary_event` | same ownership fix if RLS desired |

App-layer `tripProcedure` still guards these routes.

## Migrate note

`drizzle-kit migrate` fails on this DB because `__drizzle_migrations` is empty while tables already exist (tries to re-run `0000` → `post already exists`). Prefer:

```bash
pnpm --filter @sortey/db rls
```

for policy apply. Schema drift should use `drizzle-kit push` carefully, not a cold migrate.

## Regenerating

```bash
pnpm --filter @sortey/db rls
# statements source: packages/db/src/rls.ts buildWorkspaceRlsStatements()
# SQL snapshot: packages/db/drizzle/0012_trip_workspace_rls.sql (core only; re-export after target expansion if needed)
```

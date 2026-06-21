# driftport Telemetry — Provisioning Runbook

**Audience:** A human operator with admin access to both driftport and Sortey's
ForgeGraph secrets.

**What this turns on:** The live "Van Status" card in Sortey's mobile Driving
Mode (battery state-of-charge, inside temperature, water level) sourced from
driftport's `system.dashboard`. Until every step below is done, Sortey stays on
the mock provider and the card stays hidden — the
`driftportTelemetryPreview` flag is **off in production by default**.

**Plan / context:** [`docs/plans/2026-06-21-driftport-telemetry-spike.md`](./plans/2026-06-21-driftport-telemetry-spike.md).

> The integration is a one-way, read-only, service-token HTTP call from Sortey's
> server to driftport's tRPC API. There is **no shared database** and **no
> driftport code change** — everything here is account + secret + flag config.

---

## Prerequisites

- Admin access to the driftport app (to create users, rig memberships, API keys).
- The driftport **base URL** (e.g. `https://driftport.example.com`).
- The driftport **`rig.id` (UUID)** for each van you want Sortey to see.
- `forge` CLI configured for the Sortey app (see ForgeGraph secret convention).
- The Sortey **van profile id** for each van, and the **user id / email** of the
  tester or staging account that should see the preview.

---

## Step 1 — Create a driftport service-account user

Create a dedicated, non-human user in driftport to own the API key. **This is a
real account creation** — do not reuse a personal login.

- Suggested identity: `service-sortey@<your-domain>` (a mailbox you control).
- Give it no more access than it needs; it only has to read rig telemetry.

> Why a service account: the API key binds to a driftport **user**, and that user
> must have an active `rigMembership` for each rig it reads. A dedicated account
> keeps the grant auditable and revocable without touching a person's login.

## Step 2 — Add a `rigMembership` (role `installer`) per rig

For **each** rig that should be visible to Sortey, add a `rigMembership` for the
`service-sortey` user with role **`installer`**.

- Do this once per `rig.id` — a membership for rig A does not grant rig B.
- driftport's `system.dashboard` is a `rigProcedure`; it only returns rows for
  rigs the calling user is a member of. No membership ⇒ no data.

## Step 3 — Mint an API key (`gmk_…`, permission `read`)

As the `service-sortey` user (or via admin on its behalf), create an API key
through driftport's **`settings.createApiKey`** with permission **`read`**.

- Copy the **`gmk_…`** value immediately — driftport shows the full key **once**.
- Store it somewhere safe only until Step 4 puts it in Sortey's secrets, then
  discard the copy.

## Step 4 — Store the secrets in Sortey (ForgeGraph)

Both secrets are **server-side only** (never shipped to the mobile/web client).
Set them via `forge` for the relevant stage (`staging`, then `production` when
ready). Follow the ForgeGraph secret convention (`forge secret set …`).

```sh
# driftport base URL (no trailing path; "/api/trpc/..." is appended by Sortey)
forge secret set DRIFTPORT_API_URL <driftport base url> --stage staging

# the gmk_ key from Step 3
forge secret set DRIFTPORT_API_KEY gmk_... --stage staging
```

- `DRIFTPORT_API_URL` and `DRIFTPORT_API_KEY` are read by
  `DriftportTelemetryProvider` from `process.env` on the server
  (`packages/api/src/van-telemetry/driftport.ts`); they are declared
  `optional()` in `apps/nextjs/src/env.ts`.
- Provider selection: Sortey uses the **real** provider only when the flag is on
  **and** `DRIFTPORT_API_KEY` is set; otherwise it falls back to the mock
  (`packages/api/src/van-telemetry/resolve.ts`). So setting these secrets is safe
  and inert until Step 6 flips the flag.

## Step 5 — Link the van: set `van_profile.driftportRigId`

For each van, set the Sortey `van_profile.driftportRigId` column to the
driftport **`rig.id` (UUID)** from Step 2.

- This is the join Sortey uses to know *which* rig to query for a trip. The
  router resolves a trip → its most recent fuel log → that fuel log's van profile
  → `driftportRigId` (`packages/api/src/router/van-telemetry.ts`). If the value
  is `null`, the card stays hidden even with the flag on.
- Apply the update via the project's prod DB migration path (see the
  trip-prod-db-migrations memory: `forge db migrate` / owner DDL via
  `sudo -u postgres` on `hetzner-master`). A targeted `UPDATE van_profile SET
  driftport_rig_id = '<uuid>' WHERE id = '<van-profile-id>';` is sufficient.

## Step 6 — Enable the `driftportTelemetryPreview` flag

The flag (`packages/flags/src/flags.ts`) defaults: **production off**, staging
on, development on.

- For a controlled rollout, **allowlist** the specific tester(s) rather than
  flipping production globally: add their user id (or email) to the flag's
  `allowlist` so `isEnabled("driftportTelemetryPreview", { userId })` returns
  true for them only. Staging is already on, so a staging tester needs no
  allowlist entry.
- Keep production's default `false` until the smoke test (Step 7) passes.

## Step 7 — Live smoke test (verify the HTTP contract)

> ⚠️ **The driftport tRPC HTTP contract Sortey assumes is verified only by
> *reading* driftport's code, not by a live call.** The first real request must
> be smoke-tested, and the encoding adjusted if driftport behaves differently.

Sortey's current assumption (`packages/api/src/van-telemetry/driftport.ts`):

- **tRPC v11 GET** query at `{DRIFTPORT_API_URL}/api/trpc/system.dashboard`.
- **superjson** input via the query string:
  `?input={"json":{"rigId":"<uuid>"}}` (URL-encoded).
- Response payload read from **`result.data.json`** (falls back to `result.data`).
- Auth header `Authorization: Bearer gmk_<key>`.

To smoke-test:

1. With Steps 1–6 done for a staging rig, open Driving Mode (as an enabled user)
   on a trip whose van is rig-linked and confirm the Van Status card appears with
   live battery / inside-temp / water values.
2. If the card stays hidden, hit driftport directly with the same shape to see
   what it actually returns:

   ```sh
   curl -sS \
     -H "Authorization: Bearer gmk_..." \
     "https://<driftport-base>/api/trpc/system.dashboard?input=%7B%22json%22%3A%7B%22rigId%22%3A%22<uuid>%22%7D%7D" | jq .
   ```

3. **If the encoding is wrong, fix it in
   `packages/api/src/van-telemetry/driftport.ts`** — common adjustments:
   - driftport requires **batch** encoding → use
     `?batch=1&input={"0":{"json":{"rigId":…}}}` and read `result.data.json`
     from the `[0]` element.
   - driftport is **not** superjson-wrapped → the input is plain
     `?input={"rigId":…}` and the payload is at `result.data` (the `extractRows`
     helper already tolerates both `result.data.json` and `result.data`).
   - The procedure path or method differs (e.g. POST) → update the URL/method.

   The router wraps the provider in try/catch and returns `null` on any failure,
   so a wrong contract degrades to a hidden card (never a crashed Driving Mode) —
   but the card won't show real data until the contract matches.

4. Once the staging smoke test passes, repeat Steps 4 and 6 for `production`
   (set the prod secrets, then allowlist or enable the flag in production).

---

## Rollback / disable

- Flip `driftportTelemetryPreview` off (or remove the user from the allowlist) —
  the card hides immediately.
- Revoke the `gmk_` key in driftport (or remove the `rigMembership`) — the
  provider's calls then fail and the card hides fail-safe.
- Unset the secrets: `forge secret set DRIFTPORT_API_KEY "" --stage <stage>` (or
  delete them) — Sortey falls back to the mock provider.

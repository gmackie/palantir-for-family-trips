-- One-time prod DB reconciliation: make `trip_app` the owner of all app tables.
--
-- WHY: the trip prod DB has split ownership — 18 legacy tables are owned by the
-- `postgres` superuser while newer tables are owned by the app role `trip_app`.
-- `drizzle-kit push` (run as `trip_app`, e.g. via `forge db migrate` or CI) must
-- ALTER tables to reconcile schema, but a non-owner cannot ALTER, so push fails
-- with: `error: must be owner of table <name>` (SQLSTATE 42501). Reassigning
-- ownership to `trip_app` lets push run as the app role without superuser.
--
-- HOW TO RUN (must be a superuser — `trip_app` cannot reassign ownership):
--   ssh root@hetzner-master
--   sudo -u postgres psql -d trip -f reassign-table-ownership.sql
-- (or pipe this file in any way that connects as the `postgres` role)
--
-- SAFE: ownership changes are metadata-only — no data is read, moved, or lost.
-- Indexes/constraints follow their table's ownership automatically.
--
-- NOTE: `spatial_ref_sys` is intentionally EXCLUDED — it is a PostGIS system
-- table and must remain owned by `postgres`.

BEGIN;

ALTER TABLE "ground_transport_group"  OWNER TO trip_app;
ALTER TABLE "ground_transport_member" OWNER TO trip_app;
ALTER TABLE "itinerary_event"         OWNER TO trip_app;
ALTER TABLE "line_item_claim"         OWNER TO trip_app;
ALTER TABLE "lodging"                 OWNER TO trip_app;
ALTER TABLE "lodging_guest"           OWNER TO trip_app;
ALTER TABLE "member_transit"          OWNER TO trip_app;
ALTER TABLE "photo_reaction"          OWNER TO trip_app;
ALTER TABLE "pin"                     OWNER TO trip_app;
ALTER TABLE "pin_attendee"            OWNER TO trip_app;
ALTER TABLE "poll"                    OWNER TO trip_app;
ALTER TABLE "poll_option"             OWNER TO trip_app;
ALTER TABLE "poll_vote"               OWNER TO trip_app;
ALTER TABLE "proposal"                OWNER TO trip_app;
ALTER TABLE "proposal_reaction"       OWNER TO trip_app;
ALTER TABLE "push_token"              OWNER TO trip_app;
ALTER TABLE "settlement"              OWNER TO trip_app;
ALTER TABLE "trip_photo"              OWNER TO trip_app;

COMMIT;

-- After this, verify zero app tables remain postgres-owned (spatial_ref_sys is OK):
--   select tablename, tableowner from pg_tables
--   where schemaname='public' and tableowner='postgres';

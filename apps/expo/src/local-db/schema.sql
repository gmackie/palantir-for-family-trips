-- sortey-local.db schema v1 (P0 scaffold)
-- Full design: docs/plans/2026-07-14-trip-copilot-sqlite-schema.md
-- Ingest seeds via repository; co-pilot rules currently use @sortey/api/copilot seeds.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pack_meta (
  pack_id         TEXT PRIMARY KEY NOT NULL,
  trip_id         TEXT NOT NULL DEFAULT '',
  workspace_id    TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL,
  downloaded_at   TEXT NOT NULL,
  expires_at      TEXT,
  source_version  TEXT,
  poi_count       INTEGER NOT NULL DEFAULT 0,
  leg_count       INTEGER NOT NULL DEFAULT 0,
  byte_size       INTEGER,
  label           TEXT,
  notes           TEXT,
  manifest_json   TEXT
);

CREATE TABLE IF NOT EXISTS trip_brief (
  trip_id     TEXT PRIMARY KEY NOT NULL,
  json        TEXT NOT NULL,
  origin      TEXT NOT NULL DEFAULT 'local',
  updated_at  TEXT NOT NULL,
  dirty       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS local_leg (
  id           TEXT PRIMARY KEY NOT NULL,
  trip_id      TEXT NOT NULL DEFAULT '',
  pack_id      TEXT,
  from_key     TEXT NOT NULL,
  to_key       TEXT NOT NULL,
  from_lat     REAL NOT NULL,
  from_lng     REAL NOT NULL,
  to_lat       REAL NOT NULL,
  to_lng       REAL NOT NULL,
  miles        REAL,
  hours        REAL NOT NULL,
  source       TEXT NOT NULL DEFAULT 'table',
  direction    TEXT NOT NULL DEFAULT 'one_way',
  notes        TEXT,
  updated_at   TEXT NOT NULL,
  UNIQUE (trip_id, from_key, to_key)
);

CREATE TABLE IF NOT EXISTS local_poi (
  id              TEXT PRIMARY KEY NOT NULL,
  pack_id         TEXT NOT NULL,
  trip_id         TEXT NOT NULL DEFAULT '',
  workspace_id    TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL,
  external_id     TEXT,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  geohash5        TEXT NOT NULL DEFAULT '',
  tile_y          INTEGER NOT NULL DEFAULT 0,
  tile_x          INTEGER NOT NULL DEFAULT 0,
  is_costco       INTEGER NOT NULL DEFAULT 0,
  is_overnight    INTEGER NOT NULL DEFAULT 0,
  has_laundry     INTEGER NOT NULL DEFAULT 0,
  has_dump        INTEGER NOT NULL DEFAULT 0,
  has_water       INTEGER NOT NULL DEFAULT 0,
  has_fuel        INTEGER NOT NULL DEFAULT 0,
  has_shower      INTEGER NOT NULL DEFAULT 0,
  has_propane     INTEGER NOT NULL DEFAULT 0,
  has_grocery     INTEGER NOT NULL DEFAULT 0,
  is_truck_stop   INTEGER NOT NULL DEFAULT 0,
  rating          REAL,
  review_count    INTEGER,
  fee_class       TEXT NOT NULL DEFAULT 'unknown',
  access_class    TEXT NOT NULL DEFAULT 'unknown',
  data_json       TEXT,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS local_poi_trip_cat ON local_poi (trip_id, category);
CREATE INDEX IF NOT EXISTS local_poi_costco ON local_poi (trip_id, lat, lng) WHERE is_costco = 1;

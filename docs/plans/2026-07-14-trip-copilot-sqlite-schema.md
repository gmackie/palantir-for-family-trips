# Local SQLite schema — Trip Co-Pilot world model

**Date:** 2026-07-14  
**Status:** Draft — schema design (implement behind `LocalDb` in `apps/expo`)  
**Parent:** [`2026-07-14-trip-copilot-on-device.md`](./2026-07-14-trip-copilot-on-device.md)  
**Runtime:** one file `sortey-local.db` (SQLite 3), Expo app documents directory  
**Driver:** `expo-sqlite` (default) or `op-sqlite` if FTS/perf requires it  

This document is the **column-level** contract for the on-device world model. Product behavior stays in the parent co-pilot design; this file is what engineers migrate and query against.

---

## 1. Goals for the schema

| Goal | Implication |
|------|-------------|
| Answer “camps within 30 mi of me” offline | Spatial-friendly indexes + denormalized amenity flags |
| Answer “Costcos along Bay→Yosemite” | `is_costco` + progress along route (or ordered by leg) |
| Answer “2 Zion vs 2 Bryce given Denver 26th” | `trip_brief`, `local_anchor`, `local_trip_day`, `local_leg` |
| Packs replaceable without nuking user prefs | Separate `pack_*` content from `user_*` / brief edits |
| 10k–50k POIs per trip pack remain snappy | No giant JSON-only store; batch insert; indexes |
| Align with server where possible | Categories match `imported_poi` / `AMENITY_GROUPS` |

### Non-goals for v1 schema

- Full PostGIS-quality spatial operators (use bbox + haversine)  
- Sync protocol / CRDT rows  
- Storing SLM weights in SQLite  
- Duplicating every Postgres table (expenses, chat, etc.)

---

## 2. Entity overview

```
┌─────────────────┐     ┌──────────────────┐
│ schema_meta     │     │ trip_brief       │  user-editable co-pilot memory
└─────────────────┘     └────────┬─────────┘
                                 │ trip_id
┌─────────────────┐     ┌────────▼─────────┐     ┌─────────────────┐
│ pack_meta       │────▶│ local_poi        │     │ local_leg       │
│ (downloads)     │     │ local_poi_tile   │     │ (drive graph)   │
└────────┬────────┘     └──────────────────┘     └─────────────────┘
         │ pack_id
         │              ┌──────────────────┐     ┌─────────────────┐
         └─────────────▶│ local_anchor     │     │ local_trip_day  │
                        └──────────────────┘     └─────────────────┘
                                 │
                        ┌────────▼─────────┐
                        │ copilot_message  │  optional chat history
                        └──────────────────┘
```

**Content packs** (`pack_meta` + POIs/legs) are replaceable downloads.  
**Trip plan mirrors** (`local_anchor`, `local_trip_day`) refresh when plan packs sync.  
**Brief** is user-owned; merge carefully on re-download (prefer newer `updated_at`, don’t clobber local edits without prompt).

---

## 3. Conventions

| Convention | Rule |
|------------|------|
| Primary keys | `TEXT` UUIDs or stable composite strings |
| Timestamps | ISO-8601 UTC `TEXT` (`2026-07-14T19:00:00.000Z`) |
| Dates (calendar) | `YYYY-MM-DD` `TEXT` |
| Booleans | `INTEGER` 0/1 |
| Lat/lng | `REAL` WGS84; lat ∈ [-90,90], lng ∈ [-180,180] |
| Money / not used here | — |
| JSON blobs | `TEXT` valid JSON; validated in app layer |
| Soft deletes | Not used for pack rows; delete by `pack_id` replace |
| Foreign keys | **Enabled** (`PRAGMA foreign_keys = ON`) for local integrity where useful; pack wipe uses ordered deletes |

---

## 4. Full DDL (schema version 1)

```sql
-- =============================================================================
-- sortey-local.db  schema_version = 1
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- 4.1 Schema bookkeeping
-- ---------------------------------------------------------------------------

CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

-- Seed: INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1');

-- ---------------------------------------------------------------------------
-- 4.2 Pack registry (what was downloaded)
-- ---------------------------------------------------------------------------

CREATE TABLE pack_meta (
  pack_id         TEXT PRIMARY KEY NOT NULL,
  -- Logical owner of this pack content (empty string = national/global pack)
  trip_id         TEXT NOT NULL DEFAULT '',
  workspace_id    TEXT NOT NULL DEFAULT '',
  -- corridor | national_services | legs | plan_mirror | composite
  kind            TEXT NOT NULL,
  downloaded_at   TEXT NOT NULL,
  expires_at      TEXT,
  -- Server-side content hash / export id for incremental refresh
  source_version  TEXT,
  -- Manifest stats
  poi_count       INTEGER NOT NULL DEFAULT 0,
  leg_count       INTEGER NOT NULL DEFAULT 0,
  byte_size       INTEGER,
  -- Human notes / debug
  label           TEXT,
  notes           TEXT,
  -- JSON: { "padMiles": 40, "categories": [...], "bbox": {...}, ... }
  manifest_json   TEXT
);

CREATE INDEX pack_meta_trip ON pack_meta (trip_id, kind);

-- ---------------------------------------------------------------------------
-- 4.3 Trip brief (co-pilot prefs + soft goals; user-editable offline)
-- ---------------------------------------------------------------------------

CREATE TABLE trip_brief (
  trip_id     TEXT PRIMARY KEY NOT NULL,
  -- Full TripBrief JSON (see parent doc §7). Anchors may also be mirrored
  -- into local_anchor for querying.
  json        TEXT NOT NULL,
  -- local | server | merged
  origin      TEXT NOT NULL DEFAULT 'local',
  updated_at  TEXT NOT NULL,
  -- If server push is newer, UI may prompt; never silent clobber if dirty=1
  dirty       INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- 4.4 Plan mirror: anchors (immovable dates/places)
-- ---------------------------------------------------------------------------

CREATE TABLE local_anchor (
  id           TEXT PRIMARY KEY NOT NULL,
  trip_id      TEXT NOT NULL,
  title        TEXT NOT NULL,
  -- event | lodging | must_see | home | other
  kind         TEXT NOT NULL DEFAULT 'other',
  start_date   TEXT NOT NULL,          -- YYYY-MM-DD
  end_date     TEXT,                  -- inclusive end if multi-day
  lat          REAL,
  lng          REAL,
  place_name   TEXT,
  immovable    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  -- Optional link back to server row
  server_id    TEXT,
  updated_at   TEXT NOT NULL
);

CREATE INDEX local_anchor_trip_date ON local_anchor (trip_id, start_date);

-- ---------------------------------------------------------------------------
-- 4.5 Plan mirror: trip days
-- ---------------------------------------------------------------------------

CREATE TABLE local_trip_day (
  trip_id          TEXT NOT NULL,
  date             TEXT NOT NULL,     -- YYYY-MM-DD
  -- play | drive | position | event | recovery (Day Intent)
  intent           TEXT,
  title            TEXT,
  overnight_name   TEXT,
  overnight_lat    REAL,
  overnight_lng    REAL,
  -- camp | dispersed | hotel | truck_stop | unknown
  overnight_kind   TEXT,
  -- Optional FK-ish to a local_poi overnight choice
  overnight_poi_id TEXT,
  hero_title       TEXT,
  cut_if_behind    TEXT,
  -- planned | active | done | skipped | partial
  day_status       TEXT NOT NULL DEFAULT 'planned',
  -- JSON: blocks, notes, etc. not needed for scoring
  extra_json       TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (trip_id, date)
);

CREATE INDEX local_trip_day_status ON local_trip_day (trip_id, day_status);

-- ---------------------------------------------------------------------------
-- 4.6 Named nodes (for legs graph — stable keys)
-- ---------------------------------------------------------------------------

-- Optional but useful: stable graph nodes the co-pilot refers to by name.
CREATE TABLE local_node (
  node_key     TEXT PRIMARY KEY NOT NULL,  -- 'node:yosemite_valley'
  trip_id      TEXT NOT NULL DEFAULT '',   -- '' = global atlas
  label        TEXT NOT NULL,              -- 'Yosemite Valley'
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  -- bay_area | staging | park | city | home | other
  kind         TEXT NOT NULL DEFAULT 'other',
  pack_id      TEXT,
  updated_at   TEXT NOT NULL
);

CREATE INDEX local_node_trip ON local_node (trip_id);

-- ---------------------------------------------------------------------------
-- 4.7 Drive legs (truth table for "how long is X→Y")
-- ---------------------------------------------------------------------------

CREATE TABLE local_leg (
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
  -- Van-adjusted hours (not free-flow car)
  hours        REAL NOT NULL,
  -- table | haversine | osrm_cached | segment_sum
  source       TEXT NOT NULL DEFAULT 'table',
  -- one_way | bidirectional (if bidirectional, also store reverse or generate)
  direction    TEXT NOT NULL DEFAULT 'one_way',
  notes        TEXT,
  updated_at   TEXT NOT NULL,
  UNIQUE (trip_id, from_key, to_key)
);

CREATE INDEX local_leg_from ON local_leg (trip_id, from_key);
CREATE INDEX local_leg_to ON local_leg (trip_id, to_key);

-- ---------------------------------------------------------------------------
-- 4.8 POIs (core world model)
-- ---------------------------------------------------------------------------

CREATE TABLE local_poi (
  id              TEXT PRIMARY KEY NOT NULL,
  pack_id         TEXT NOT NULL,
  -- Empty string = national/global pack row; else owning trip for corridor pack
  trip_id         TEXT NOT NULL DEFAULT '',
  workspace_id    TEXT NOT NULL DEFAULT '',

  source          TEXT NOT NULL,   -- ioverlander | osm | costco | seed | manual
  external_id     TEXT,            -- source-native id
  name            TEXT NOT NULL,
  -- Category aligns with server imported_poi / AMENITY_GROUPS (+ extensions)
  category        TEXT NOT NULL,

  lat             REAL NOT NULL,
  lng             REAL NOT NULL,

  -- Geohash precision ~5 (~5km) for cheap "nearby" prefilter; app fills on ingest
  geohash5        TEXT NOT NULL,
  -- Integer tile for corridor slices (optional): floor(lat*10), floor(lng*10)
  tile_y          INTEGER NOT NULL,
  tile_x          INTEGER NOT NULL,

  -- Denormalized amenity flags (0/1) — keep hot filters off JSON
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

  -- Optional quality / popularity from source (NULL if unknown)
  rating          REAL,
  review_count    INTEGER,

  -- Fee / access hints for ranking (unknown-safe)
  -- free | paid | unknown
  fee_class       TEXT NOT NULL DEFAULT 'unknown',
  -- public | private | unknown
  access_class    TEXT NOT NULL DEFAULT 'unknown',

  -- Full source payload: phone, hours, website, description, tags, raw
  data_json       TEXT,

  updated_at      TEXT NOT NULL
);

CREATE INDEX local_poi_pack ON local_poi (pack_id);
CREATE INDEX local_poi_trip_cat ON local_poi (trip_id, category);
CREATE INDEX local_poi_geohash ON local_poi (geohash5);
CREATE INDEX local_poi_tile ON local_poi (tile_y, tile_x);
CREATE INDEX local_poi_trip_tile ON local_poi (trip_id, tile_y, tile_x);

-- Partial indexes for common co-pilot filters
CREATE INDEX local_poi_costco ON local_poi (trip_id, lat, lng)
  WHERE is_costco = 1;
CREATE INDEX local_poi_overnight ON local_poi (trip_id, lat, lng)
  WHERE is_overnight = 1;
CREATE INDEX local_poi_laundry ON local_poi (trip_id, lat, lng)
  WHERE has_laundry = 1;
CREATE INDEX local_poi_fuel ON local_poi (trip_id, lat, lng)
  WHERE has_fuel = 1;
CREATE INDEX local_poi_truck ON local_poi (trip_id, lat, lng)
  WHERE is_truck_stop = 1;

-- Uniqueness within a pack+source (allows same OSM id in two packs if needed)
CREATE UNIQUE INDEX local_poi_pack_source_ext
  ON local_poi (pack_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4.9 FTS5 name search (optional but recommended in P1)
-- ---------------------------------------------------------------------------

CREATE VIRTUAL TABLE local_poi_fts USING fts5(
  name,
  category,
  content = 'local_poi',
  content_rowid = 'rowid'
);

-- Maintain FTS via triggers (SQLite content= sync):

CREATE TRIGGER local_poi_ai AFTER INSERT ON local_poi BEGIN
  INSERT INTO local_poi_fts(rowid, name, category)
  VALUES (new.rowid, new.name, new.category);
END;

CREATE TRIGGER local_poi_ad AFTER DELETE ON local_poi BEGIN
  INSERT INTO local_poi_fts(local_poi_fts, rowid, name, category)
  VALUES ('delete', old.rowid, old.name, old.category);
END;

CREATE TRIGGER local_poi_au AFTER UPDATE ON local_poi BEGIN
  INSERT INTO local_poi_fts(local_poi_fts, rowid, name, category)
  VALUES ('delete', old.rowid, old.name, old.category);
  INSERT INTO local_poi_fts(rowid, name, category)
  VALUES (new.rowid, new.name, new.category);
END;

-- ---------------------------------------------------------------------------
-- 4.10 Route progress (optional): map POI → mile marker on trip polyline
-- ---------------------------------------------------------------------------

-- Populated at pack build time for "along the way" ordering (Costco sequence).
CREATE TABLE local_poi_route (
  trip_id       TEXT NOT NULL,
  poi_id        TEXT NOT NULL,
  -- Cumulative miles from trip start along planned polyline (approx)
  mile_marker   REAL NOT NULL,
  -- Distance from route centerline (mi)
  offset_miles  REAL NOT NULL DEFAULT 0,
  segment_id    TEXT,
  PRIMARY KEY (trip_id, poi_id),
  FOREIGN KEY (poi_id) REFERENCES local_poi(id) ON DELETE CASCADE
);

CREATE INDEX local_poi_route_mile ON local_poi_route (trip_id, mile_marker);

-- ---------------------------------------------------------------------------
-- 4.11 Co-pilot chat history (short ring; not a full transcript server)
-- ---------------------------------------------------------------------------

CREATE TABLE copilot_message (
  id            TEXT PRIMARY KEY NOT NULL,
  trip_id       TEXT NOT NULL,
  role          TEXT NOT NULL,   -- user | assistant | system
  content       TEXT NOT NULL,
  -- Serialized PlanOption[] if assistant offered choices
  options_json  TEXT,
  -- rules | slm | cloud | mixed
  sources_json  TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX copilot_message_trip_time ON copilot_message (trip_id, created_at);

-- ---------------------------------------------------------------------------
-- 4.12 Pending plan apply (local-first write queue for co-pilot)
-- ---------------------------------------------------------------------------

-- Separate from journey/fuel outboxes; specifically plan mutations.
CREATE TABLE copilot_apply_queue (
  id            TEXT PRIMARY KEY NOT NULL,
  trip_id       TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  -- JSON: DayPlanDraft[] or setDay payloads
  payload_json  TEXT NOT NULL,
  -- pending | syncing | synced | failed
  state         TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX copilot_apply_state ON copilot_apply_queue (state, updated_at);
```

---

## 5. Column notes (hot tables)

### 5.1 `local_poi.id`

Stable ID strategies (pick one per source at ingest):

| Source | `id` format |
|--------|-------------|
| Server `imported_poi` | server UUID as-is |
| Costco seed | `costco:<store_number>` |
| OSM | `osm:node:<id>` / `osm:way:<id>` |
| Manual seed | `seed:<slug>` |

Never change `id` across pack refreshes for the same logical place if we can avoid it (so user “saved” references stay valid). Prefer **content-addressed** `source + external_id` uniqueness per pack.

### 5.2 Category vs flags

`category` is the **primary type** (one value). Flags are **multi-label denorm** for SQL filters:

| Flag | Set when |
|------|----------|
| `is_costco` | Costco warehouse or Costco gas |
| `is_overnight` | category ∈ overnight set OR data says 24h overnight OK |
| `has_laundry` | category = laundry OR amenities include laundry |
| `has_fuel` | category = fuel OR truck stop with fuel |
| `is_truck_stop` | category = truck_stop OR source tag |

A Costco gas row: `category='fuel'`, `is_costco=1`, `has_fuel=1`.  
A Pilot/Flying J: `category='truck_stop'` or `fuel`, `is_truck_stop=1`, maybe `has_laundry=1`, `is_overnight=1`.

### 5.3 `geohash5` / tiles

On ingest:

```
geohash5 = geohash(lat, lng, precision=5)  // ~5 km cells
tile_y = floor(lat * 10)   // ~11 km
tile_x = floor(lng * 10)
```

**Nearby query pattern:**

1. Compute geohash of user + 8 neighbors (or expand).  
2. `WHERE geohash5 IN (...)` or tile range.  
3. Haversine in SQL or JS; `ORDER BY dist LIMIT N`.

Avoid full table scan of 40k rows on every keystroke.

### 5.4 `data_json` shape (convention)

Not enforced in SQL; TypeScript types on read:

```ts
interface LocalPoiData {
  phone?: string;
  website?: string;
  hours?: string;
  description?: string;
  fee?: string;
  amenities?: string[];      // raw tags
  sourceUrl?: string;
  /** iOverlander / OSM extras */
  raw?: unknown;
}
```

Keep `data_json` nullable-ish empty `{}` rather than NULL for simpler app code if preferred — DDL allows NULL; recommend `NOT NULL DEFAULT '{}'` in migration if we want.

---

## 6. Category catalog (v1)

Align with server `CATEGORY_MAP` / `AMENITY_GROUPS`, plus co-pilot extensions:

| category | Group | Overnight? | Notes |
|----------|-------|------------|--------|
| `wild_camping` | sleep | yes | dispersed |
| `campsite` | sleep | yes | established |
| `parking_overnight` | sleep/parking | yes | |
| `rest_area` | sleep/road | sometimes | flag carefully |
| `truck_stop` | sleep/service | often | **extension** for staging |
| `parking` | parking | no | day use |
| `fuel` | fuel | no | |
| `laundry` | service | no | |
| `water` | service | no | |
| `dump_station` | service | no | |
| `propane` | service | no | |
| `shower` | service | no | |
| `mechanic` | service | no | |
| `grocery` | food | no | Costco warehouse may be grocery+fuel rows |
| `restaurant` | food | no | |
| `toll` | road | no | |
| `wifi` | other | no | low priority in packs |
| `medical` | other | no | optional in pack |

**Pack priority (when capping rows):**  
`sleep > fuel/Costco > laundry/dump/water > grocery > other`.

---

## 7. Canonical tool queries

### 7.1 Nearby camps (30 mi)

```sql
-- :lat :lng :maxLat :minLat :maxLng :minLng  (bbox from 30mi pad)
-- dist computed in app or via expression
SELECT
  p.*,
  -- approximate miles (app can refine)
  (
    (p.lat - :lat) * (p.lat - :lat) +
    (p.lng - :lng) * (p.lng - :lng) * COS(:lat * 0.0174533) * COS(:lat * 0.0174533)
  ) AS dist2
FROM local_poi p
WHERE p.trip_id IN ('', :tripId)   -- trip pack + national
  AND p.is_overnight = 1
  AND p.lat BETWEEN :minLat AND :maxLat
  AND p.lng BETWEEN :minLng AND :maxLng
ORDER BY dist2
LIMIT 30;
```

### 7.2 Costcos ordered along route

```sql
SELECT p.*, r.mile_marker, r.offset_miles
FROM local_poi p
JOIN local_poi_route r ON r.poi_id = p.id AND r.trip_id = :tripId
WHERE p.is_costco = 1
  AND p.trip_id IN ('', :tripId)
ORDER BY r.mile_marker ASC;
```

Fallback without route table: order by distance to successive segment centroids (app-side).

### 7.3 Laundry + overnight near point (Tracy staging)

```sql
SELECT * FROM local_poi
WHERE trip_id IN ('', :tripId)
  AND lat BETWEEN :minLat AND :maxLat
  AND lng BETWEEN :minLng AND :maxLng
  AND (has_laundry = 1 OR is_truck_stop = 1 OR is_overnight = 1)
ORDER BY
  CASE WHEN has_laundry = 1 AND is_overnight = 1 THEN 0
       WHEN has_laundry = 1 THEN 1
       WHEN is_truck_stop = 1 THEN 2
       ELSE 3 END,
  /* dist */ lat;  -- replace with real dist sort in app
LIMIT 20;
```

### 7.4 Drive hours

```sql
SELECT miles, hours, source, notes
FROM local_leg
WHERE trip_id IN ('', :tripId)
  AND from_key = :fromKey
  AND to_key = :toKey
LIMIT 1;
```

Fallback: haversine × 1.3 / 45 mph van default in app; optionally `INSERT` cached result with `source='haversine'`.

### 7.5 Nights until anchor

```sql
SELECT start_date, title, lat, lng
FROM local_anchor
WHERE trip_id = :tripId AND start_date >= :today
ORDER BY start_date ASC
LIMIT 1;
-- nights = date_diff(start_date, today) in app
```

### 7.6 FTS name

```sql
SELECT p.*
FROM local_poi p
JOIN local_poi_fts f ON f.rowid = p.rowid
WHERE local_poi_fts MATCH :query
  AND p.trip_id IN ('', :tripId)
LIMIT 20;
```

---

## 8. Pack lifecycle SQL

### 8.1 Replace corridor pack

```sql
BEGIN;
DELETE FROM local_poi_route WHERE trip_id = :tripId;
DELETE FROM local_poi WHERE pack_id = :oldPackId;
DELETE FROM local_leg WHERE pack_id = :oldPackId;
DELETE FROM pack_meta WHERE pack_id = :oldPackId;

INSERT INTO pack_meta (...);
-- batch INSERT local_poi
-- batch INSERT local_poi_route
-- batch INSERT local_leg / local_node
COMMIT;
```

FTS triggers maintain `local_poi_fts`.

### 8.2 National Costco pack (trip_id = '')

Independent of trip; rarely changes.

```sql
-- kind = 'national_services'
-- trip_id = ''
```

Queries always use `trip_id IN ('', :tripId)` so national Costcos appear on every trip.

### 8.3 Plan mirror refresh (does not delete POIs)

```sql
BEGIN;
DELETE FROM local_anchor WHERE trip_id = :tripId;
DELETE FROM local_trip_day WHERE trip_id = :tripId;
-- insert anchors + days from export
UPDATE pack_meta SET downloaded_at = :now WHERE pack_id = :planPackId;
COMMIT;
```

### 8.4 Brief merge policy

| Condition | Action |
|-----------|--------|
| No local row | Insert server brief |
| Local `dirty=0` and server newer | Replace |
| Local `dirty=1` | Keep local; surface “Server plan updated — keep yours / take server” |

---

## 9. Seed data (P0 without full corridor export)

Minimum seeds to recreate dogfood conversations offline:

### 9.1 Nodes + legs

| from_key | to_key | hours (van) |
|----------|--------|-------------|
| `node:bay_area` | `node:tracy` | 1.2 |
| `node:tracy` | `node:groveland` | 1.8 |
| `node:groveland` | `node:yosemite_valley` | 1.3 |
| `node:yosemite_valley` | `node:zion` | 9.5 |
| `node:zion` | `node:bryce` | 1.8 |
| `node:bryce` | `node:grand_junction` | 4.5 |
| `node:grand_junction` | `node:denver` | 4.2 |
| `node:bryce` | `node:denver` | 9.3 |
| `node:denver` | `node:omaha` | 8.5 |
| `node:omaha` | `node:lake_forest` | 7.5 |

### 9.2 Costco (Bay→Yosemite sample)

| id | name | lat/lng (approx) |
|----|------|------------------|
| `costco:livermore` | Costco Livermore | 37.70, -121.82 |
| `costco:tracy` | Costco Tracy | 37.76, -121.46 |
| `costco:manteca` | Costco Manteca | 37.80, -121.25 |

### 9.3 Staging POIs

| id | category / flags | Area |
|----|------------------|------|
| `seed:tracy_ta` | truck_stop, laundry, overnight | Tracy I-5/205 |
| `seed:groveland_nf` | wild_camping / campsite | Stanislaus sample |

P0 can ship **only seeds**; P1 replaces with real pack export.

---

## 10. TypeScript types (app layer)

```ts
// apps/expo/src/local-db/types.ts (sketch)

export type PackKind =
  | "corridor"
  | "national_services"
  | "legs"
  | "plan_mirror"
  | "composite";

export type PoiCategory =
  | "wild_camping"
  | "campsite"
  | "parking_overnight"
  | "rest_area"
  | "truck_stop"
  | "parking"
  | "fuel"
  | "laundry"
  | "water"
  | "dump_station"
  | "propane"
  | "shower"
  | "mechanic"
  | "grocery"
  | "restaurant"
  | "toll"
  | "wifi"
  | "medical"
  | "pet"
  | "hotel"
  | "custom";

export interface LocalPoiRow {
  id: string;
  packId: string;
  tripId: string;
  workspaceId: string;
  source: string;
  externalId: string | null;
  name: string;
  category: PoiCategory | string;
  lat: number;
  lng: number;
  geohash5: string;
  tileY: number;
  tileX: number;
  isCostco: boolean;
  isOvernight: boolean;
  hasLaundry: boolean;
  hasDump: boolean;
  hasWater: boolean;
  hasFuel: boolean;
  hasShower: boolean;
  hasPropane: boolean;
  hasGrocery: boolean;
  isTruckStop: boolean;
  rating: number | null;
  reviewCount: number | null;
  feeClass: "free" | "paid" | "unknown";
  accessClass: "public" | "private" | "unknown";
  dataJson: string;
  updatedAt: string;
}
```

Map DB snake_case ↔ camelCase in the repository only.

---

## 11. Migrations

| Version | Changes |
|---------|---------|
| 1 | Initial DDL above |
| 2+ | Additive columns preferred; never renumber pack IDs without wipe |

```ts
// Pseudocode
const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: ENTIRE_DDL },
];

async function migrate(db) {
  const row = await db.get("SELECT value FROM schema_meta WHERE key='schema_version'");
  let v = row ? Number(row.value) : 0;
  for (const m of MIGRATIONS) {
    if (m.version > v) {
      await db.exec(m.sql);
      await db.run(
        "INSERT OR REPLACE INTO schema_meta(key,value) VALUES ('schema_version', ?)",
        [String(m.version)],
      );
      v = m.version;
    }
  }
}
```

On catastrophic incompatibility: delete `sortey-local.db` and re-download packs (user-visible).

---

## 12. Integrity & maintenance

| Task | When |
|------|------|
| `PRAGMA foreign_keys=ON` | Every connection |
| `ANALYZE` | After large pack ingest |
| `VACUUM` | Rare; after deleting large packs |
| Cap `copilot_message` | Keep last 100 per trip; delete older |
| Cap `copilot_apply_queue` | Delete `synced` older than 7 days |

---

## 13. What stays out of SQLite

| Data | Where instead |
|------|----------------|
| Route polyline geometry (large) | File pack JSON or separate `route_{tripId}.json` |
| Map tiles | OS/cache / not our problem v1 |
| SLM weights | Filesystem directory |
| Receipt images | Existing file/R2 flow |
| Full expense history | Server + query persist |
| Member live locations | Memory / ephemeral; not co-pilot world |

Optional later: `local_polyline` table with compressed polyline chunks if map offline needs SQL joins — not required for co-pilot v1 if tools only need legs + POIs.

---

## 14. Worked example rows (Tracy night)

**Brief (excerpt):** next immovable = Denver `2026-07-26`; prefs prioritize hike + services.

**POIs:**

| id | name | category | flags |
|----|------|----------|--------|
| costco:tracy | Costco Tracy | fuel | is_costco, has_fuel |
| seed:tracy_ta | TA Tracy | truck_stop | truck_stop, laundry, overnight |

**Query:** laundry + overnight near Tracy → ranks TA first.  
**Option card:** “Stage Tracy truck stop tonight; Costco fuel before 120.”  
**Apply:** `local_trip_day` for tonight → overnight_name TA, kind truck_stop; queue server sync.

---

## 15. Open schema decisions

| # | Topic | Recommendation |
|---|--------|----------------|
| S1 | `trip_id ''` vs NULL for global | Use **empty string** (simpler UNIQUE/IN clauses) |
| S2 | FTS in v1 | **Yes** if expo-sqlite supports fts5; else defer name search |
| S3 | Store reverse legs | Generate reverse with same hours unless one-way mountain passes |
| S4 | `local_poi_route` required? | **Yes for Costco-along-route**; optional for P0 seeds |
| S5 | Multi-workspace | `workspace_id` on POI for private iOverlander rows only on that workspace’s device packs |

---

## 16. Implementation checklist

- [ ] Add `apps/expo/src/local-db/schema.sql` (this DDL)  
- [ ] `LocalDb` open + migrate  
- [ ] Seed script: nodes, legs, Costco, Tracy staging  
- [ ] Repository methods for §7 queries  
- [ ] Server `exportCopilotPack` → ingest into `local_poi` / `pack_meta`  
- [ ] Wire co-pilot tools to repository  
- [ ] Tests: ingest 1k fake POIs; nearby p95; pack replace cleans old pack_id  

---

## 17. Summary

The co-pilot’s offline intelligence is only as good as **`local_poi` + `local_leg` + brief/anchors`**.  

- **POIs** answer *where* (camp, Costco, laundry).  
- **Legs** answer *how long*.  
- **Brief + anchors + days** answer *what the plan is and what cannot move*.  
- **Pack meta** makes downloads honest and replaceable.  

Everything else (chat UI, SLM) sits on top of these tables.

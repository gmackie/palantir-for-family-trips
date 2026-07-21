# Design: Trip Co-Pilot (on-device, offline-first)

**Date:** 2026-07-14 (collab depth: 2026-07-20)  
**Status:** Draft — product + data architecture  
**Dogfood:** Van road trip planning conversations (Bay → Yosemite → Zion → Bryce day-stop → Grand Junction → Denver → Omaha → Lake Forest → home)  
**Depends on:** Today Command + Reality Replan (`docs/plans/2026-07-12-today-command-and-replan-design.md`), Offline-First (`docs/ai/OFFLINE_FIRST_DESIGN.md`), corridor POIs (`imported_poi` / iOverlander), active-trip mobile shell  
**Principle:** Sortie is the **passenger-seat co-pilot**. It argues options, respects anchors, and rewrites nights — **with no cell service**. Cloud is optional assist, not the brain.  
**Conversation + multi-party (depth):** [`2026-07-20-conversational-collaborative-planning.md`](./2026-07-20-conversational-collaborative-planning.md) — sessions, moves, stances, facilitation, party vs private.

---

## 1. Problem

We already plan trips the way a good co-pilot would:

- “Tahoe first or Yosemite first from the Bay?”
- “Tracy truck stop tonight for laundry + Costco?”
- “2 Zion vs 2 Bryce for hiking vs heat vs Denver on the 26th?”
- “Bryce overnight is wrong — stage Grand Junction and do Bryce as a morning stop.”
- “How long is Bryce → Denver?”

That conversation is **the product**. Today it lives in chat with a human/agent who knows the map. The app has **Trip Days, anchors, replan, Today Command, fuel zones, corridor POI search** — but:

1. Planning is **form- and screen-driven**, not conversational.
2. Offline is **JSON trip packs + query cache**, not a **queryable local world model** of POIs/services.
3. Corridor POIs are **online bbox fetches** (`corridor.searchImported`). Off-grid map/planning dies.
4. On-device inference only pays off if **tools** (drive hours, camps, Costco, replan drafts) work offline against **local data**.

**Without a rich local POI store, “chat offline” is a chatbot that can’t answer “where do we sleep tonight near Tracy.”**

---

## 2. Goals / non-goals

### Goals

| ID | Goal |
|----|------|
| G1 | Recreate **conversation-level** planning on the phone: options, costs (hours/nights), one rec + one alt, apply to plan. |
| G2 | **Fully offline** for active road trips: brief, days, legs, **POIs/services**, replan draft/apply (queued sync). |
| G3 | **On-device SLM** for natural language over local tools — not required for correctness (rules work without weights). |
| G4 | **SQLite** on device as the POI / service / leg / brief store (scale + spatial queries). |
| G5 | Explicit **“Prepare co-pilot offline”** download before leaving signal (bounded packs, no silent 100k-row surprise). |
| G6 | Anchors stay sacred; co-pilot only rewrites **between** anchors unless user unlocks. |
| G7 | **Multi-party planning sessions** — N humans + co-pilot share options/stances; commit is role-gated (see collaborative design). |
| G8 | **Conversational depth** — multi-turn constraint stacks and preference conflict, not one-shot prompts. |

### Non-goals (this design)

- Turn-by-turn navigation  
- Replacing Google/Apple Maps  
- Full continental OSM on device  
- Real-time multi-user CRDT merge offline (conflict UI instead; see collab doc)  
- Cloud LLM as the only path (online assist OK later)  
- Perfect hotel booking / campground reservation API in v1  

---

## 3. Vocabulary

| Term | Definition |
|------|------------|
| **Trip co-pilot** | Conversational planner that proposes `PlanOption`s and optional day drafts from local state. Participant id `copilot` in multi-party sessions. |
| **Trip brief** | Durable prefs + hard anchors + soft constraints the co-pilot always reads. |
| **Plan option** | Structured alternative: nights layout, drive hours, hike/heat score, risk to next anchor, cut-if-behind. |
| **Planning session** | Bounded multi-move conversation (solo or party) that may commit a plan change. |
| **Move / stance / decision** | Typed conversational acts — see collaborative design. |
| **Local world** | SQLite tables: POIs, services, legs, brief, packs metadata. |
| **Corridor pack** | Downloaded POI/service slice for a trip’s polyline ± buffer (or bbox chain of days). |
| **Service class** | Fuel, Costco, laundry, dump, water, shower, grocery, overnight (camp/wild/truck stop). |
| **Leg** | Directed drive between two named nodes (or lat/lng) with estimated hours/miles. |
| **Rules engine** | Deterministic scorer/builder of plan options (no model). |
| **SLM** | Small on-device language model that *explains* and *ranks* tool results. |

_Avoid:_ calling this “AI itinerary generator” (implies hallucinated multi-week tours without anchors).

---

## 4. Architecture

### 4.1 Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Chat / Option cards UI  (Today, Drive, dedicated Co-pilot)  │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│  TripCopilot port                                            │
│    chat({ message, lat?, lng?, brief }) →                    │
│      { reply, options[], draft?, sources[] }                 │
└─────────────┬────────────────────────────┬───────────────────┘
              │                            │
   ┌──────────▼──────────┐      ┌──────────▼──────────┐
   │  Rules engine       │      │  On-device SLM       │
   │  (always available) │      │  (optional weights) │
   └──────────┬──────────┘      └──────────┬──────────┘
              │  tools only                 │  tools only
              └──────────────┬──────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│  Local tools (pure + SQLite)                                 │
│  getBrief · listAnchors · nightsUntil · estimateDrive        │
│  scoreStayOptions · nearbyServices · campsNear · costcosNear │
│  replanDraft · applyDraft (local days + outbox)              │
└─────────────┬───────────────────────────────┬────────────────┘
              │                               │
   ┌──────────▼──────────┐         ┌──────────▼──────────┐
   │  expo-sqlite /      │         │  Existing packs     │
   │  op-sqlite          │         │  (days, zones,      │
   │  local.db           │         │   segments JSON)    │
   └──────────┬──────────┘         └─────────────────────┘
              │ sync when online
   ┌──────────▼──────────┐
   │  Server: Postgres   │
   │  imported_poi,      │
   │  planner.*, packs   │
   └─────────────────────┘
```

### 4.2 Iron rules

1. **Numbers only from tools** — model never invents miles/hours/Costco locations.  
2. **Anchors immutable** in soft replan.  
3. **Same `TripCopilot` interface** online or offline; implementations swap.  
4. **Rules without SLM** still produce valid `PlanOption[]` (templated reply).  
5. **Honest UX** — `pack missing`, `model not downloaded`, `GPS weak`, `stale pack`.

### 4.3 Relationship to offline-first v1

`OFFLINE_FIRST_DESIGN.md` chose **react-query persist + JSON trip packs** for low effort. That remains correct for **small trip documents**.

**Co-pilot POI world requires SQLite** (this doc upgrades that decision for the world model only):

| Data | Storage |
|------|---------|
| Trip days, today snapshot, driving summary | Keep JSON / query persist (small) |
| **10k–100k+ POIs, spatial queries** | **SQLite** |
| Outbox mutations | Keep existing outbox tables/files; optionally migrate outbox into SQLite later |
| SLM weights | Filesystem, not SQLite |

---

## 5. Product surfaces

### 5.1 Co-pilot chat

- Entry: active road trip → **Co-pilot** tab or sheet from **Today** / **Drive**.  
- Input: free text (+ optional chips: “Tonight”, “Next 3 days”, “Utah split”, “Cut for Denver”).  
- Output every turn:
  - Short reply (passenger-seat voice)
  - **1 recommended PlanOption + 1 alternative**
  - Costs: nights, drive hours, risk to next anchor
  - Actions: **Apply** · **Show on map** · **Navigate** (deep link maps) · **Not now**

### 5.2 Example turns (dogfood corpus)

These are acceptance scenarios for v1:

| User | Co-pilot behavior |
|------|-------------------|
| “Going to Yosemite from the Bay, camp tonight?” | Stage on 120 corridor; Costco Tracy/Livermore; no Tahoe-first |
| “Laundry + truck stop near Tracy” | Service query laundry + overnight parking; pin + navigate |
| “2 Zion or 2 Bryce?” | Options scored: hike quality, July heat, next anchor Denver |
| “Skip Bryce night, sleep GJ” | Rewrite nights; Bryce = day stop; leg Bryce→GJ hours |
| “How long is Bryce to Denver on the 26th?” | `estimateDrive` only; 9–10 h wheel time + realistic day |

### 5.3 Apply path

Apply writes **local** trip days / run notes immediately; enqueues server replan/day updates when online (same spirit as journey outbox). Never block Apply on network.

---

## 6. Local SQLite: the world model

### 6.1 Why SQLite (not JSON pack alone)

Conversation-level planning needs:

- **Spatial queries** — “camps within 30 mi of Tracy”, “Costcos along polyline”
- **Category / amenity filters** — fuel, laundry, dump, wild_camping, Costco
- **Ranking** — distance + preference weights (Costco first, dark-sky camp second)
- **Scale** — corridor packs of **tens of thousands** of POIs; JSON parse + filter in JS will not stay responsive
- **Incremental updates** — refresh one day-corridor without rewriting a 50 MB JSON blob

### 6.2 Database layout

**File:** `sortey-local.db` (one DB per install). **Driver:** `expo-sqlite` default.

**Full column-level DDL, indexes, tool SQL, pack lifecycle, FTS, seeds, migrations:**

→ **[`2026-07-14-trip-copilot-sqlite-schema.md`](./2026-07-14-trip-copilot-sqlite-schema.md)**

| Table | Role |
|-------|------|
| `schema_meta` | Migration version |
| `pack_meta` | Download registry (corridor / national / legs / plan) |
| `trip_brief` | Prefs + soft goals (`dirty` for merge) |
| `local_anchor` | Immovable dates/places |
| `local_trip_day` | Plan mirror for tools |
| `local_node` | Named graph nodes (`node:zion`) |
| `local_leg` | Drive hours |
| `local_poi` | World model (amenity flags, geohash, tiles) |
| `local_poi_fts` | Name search (FTS5) |
| `local_poi_route` | Mile-marker along polyline (Costco order) |
| `copilot_message` | Short chat history |
| `copilot_apply_queue` | Local-first plan apply outbox |

Global rows use `trip_id = ''` so queries are `trip_id IN ('', :tripId)`.

---

## 7. Trip brief schema

```ts
interface TripBrief {
  tripId: string;
  prefs: {
    prioritize: Array<"hike" | "scenery" | "rest" | "mileage" | "services">;
    avoidLongDaysAfterHours?: number; // e.g. 8
    preferCostcoFuel?: boolean;
    maxDriveHoursPerDay?: number;     // e.g. 10
    lodgingBias?: "camp" | "mixed" | "hotel";
  };
  anchors: Array<{
    id: string;
    title: string;
    date: string;           // start
    endDate?: string;
    lat?: number;
    lng?: number;
    kind: "event" | "lodging" | "must_see" | "home" | "other";
    immovable: true;
  }>;
  softGoals?: string[];     // "Zion for hiking", "see Bryce rim"
  notes?: string;
  updatedAt: string;
}
```

Editable in Settings / Co-pilot “Brief” sheet. Downloaded with pack; user edits offline.

---

## 8. PlanOption schema

```ts
interface PlanOption {
  id: string;
  title: string;              // "2 Zion + Bryce day → GJ"
  summary: string;
  nights: Array<{
    date: string;
    place: string;
    lat?: number;
    lng?: number;
    kind: "camp" | "truck_stop" | "hotel" | "park" | "unknown";
    role: "stage" | "play" | "transit" | "recovery";
  }>;
  costs: {
    totalDriveHours: number;
    maxDayDriveHours: number;
    hikeQuality: 0 | 1 | 2 | 3;   // Zion-weighted
    heatRisk: 0 | 1 | 2 | 3;
    anchorRisk: 0 | 1 | 2 | 3;    // risk to next immovable date
  };
  cutIfBehind: string;
  recommended?: boolean;
}
```

Rules engine produces these; SLM only narrates.

---

## 9. Pack download pipeline (“Prepare co-pilot offline”)

### 9.1 User action

On road-trip home (extend “Make available offline”):

1. Download **plan pack** (days, segments, zones, today) — existing.  
2. Download **co-pilot pack**:
   - Brief + anchors  
   - **Corridor POI extract** for trip polyline ± N miles (default 40–50 mi)  
   - **Service overlay**: Costco + laundry + truck stops along corridor (may use wider pad)  
   - **Leg table** for remaining nodes until trip end / home  
3. Optional: **Download co-pilot model** (~1–2 GB) — separate, progressive.

Show estimated size before download. Allow “corridor only: next 7 days” vs “full remaining trip.”

### 9.2 Server export API (new)

```
planner.exportCopilotPack | packs.exportCopilot
  input: { workspaceId, tripId, mode: 'remaining' | 'full' | 'next_n_days', days?: number }
  output: {
    version, generatedAt,
    brief, anchors, days,
    pois: LocalPoiRow[],      // capped / tiled
    legs: LocalLegRow[],
    stats: { poiCount, byteEstimate }
  }
```

Implementation:

1. Build route points from segments (same as `predictZones` / import scripts).  
2. Query `imported_poi` in corridor (reuse `import-ioverlander` bbox/trip pad logic).  
3. Merge **static Costco list** (seed CSV/JSON in repo or `poi_cache`) with `is_costco`.  
4. Merge **truck_stop / laundry** from OSM extract or curated seed if not in iOverlander.  
5. Cap: e.g. max 50k POIs per pack; prioritize sleep + service + fuel over scenic.  
6. Stream or chunk download for mobile.

### 9.3 Client ingest

```
BEGIN;
DELETE FROM local_poi WHERE pack_id = ?;
INSERT ... batch;
UPDATE pack_meta;
COMMIT;
```

Spatial index rebuild if needed. Verify row counts match manifest.

### 9.4 Freshness

- Pack `expires_at` default **14 days** or until trip end + 3.  
- Soft warning on Today: “Co-pilot pack is 10 days old.”  
- Online refresh replaces pack_id rows.

---

## 10. Local tools (contract)

All tools read SQLite / brief only (no network):

| Tool | Input | Output |
|------|-------|--------|
| `getBrief` | tripId | TripBrief |
| `listDays` | tripId, from?, to? | days[] |
| `listAnchors` | tripId | anchors[] |
| `nightsUntil` | tripId, anchorId \| date | count |
| `estimateDrive` | from, to | { miles, hours, source } |
| `nearby` | lat, lng, categories[], radiusMi, limit | poi[] ranked |
| `alongRoute` | tripId or polyline key, categories[], limit | poi[] |
| `costcosAlong` | tripId or from→to | Costco[] ordered by progress |
| `scoreStaySplits` | context (Utah, next anchor Denver…) | PlanOption[] |
| `replanDraft` | reason, options | DayPlanDraft[] |
| `searchPoiName` | fts query | poi[] |

`scoreStaySplits` encodes dogfood logic (Zion hike weight, Bryce heat, GJ staging, max day hours).

---

## 11. On-device SLM

### 11.1 Role

- Natural language over **tool results only**  
- Pick recommended option + explain tradeoffs  
- Parse user intent → tool calls (JSON)  

### 11.2 Runtime (decision later, interface now)

| Candidate | Notes |
|-----------|--------|
| Apple on-device foundation models | Prefer when min iOS allows; no big download |
| llama.cpp / GGUF via native module | Cross-platform control; 1–3B Q4 |
| Core ML export | iOS performance |

**Expo:** requires **dev client / production native binary**. OTA cannot ship new native ML runtimes — only JS + pack data + maybe weight files if runtime already present.

### 11.3 Resource policy

- Load model when Co-pilot opens or trip becomes active; unload on memory warning / leave trip.  
- Context: brief summary + last 6 turns + tool JSON (compact).  
- Timeout: if inference > N seconds, fall back to rules-only reply.

### 11.4 P0 without weights

Ship chat UI + rules engine. SLM is a drop-in `Narrator` interface:

```ts
interface CopilotNarrator {
  narrate(input: {
    userMessage: string;
    options: PlanOption[];
    toolTrace: unknown[];
  }): Promise<string>;
}
// TemplateNarrator | OnDeviceSlmNarrator | CloudNarrator
```

---

## 12. Server / monorepo work

| Area | Work |
|------|------|
| `packages/db` | Optional pack export tables; Costco seed; truck_stop category docs |
| `packages/api` | `exportCopilotPack`, pack size limits, auth trip-scoped |
| Import scripts | Trip-corridor extract; Costco merge; laundry OSM optional |
| `apps/expo` | SQLite module, ingest, tools, chat UI, download UX |
| Native | SLM module (P2) |
| Docs | This plan; update OFFLINE_FIRST to point SQLite world model here |

---

## 13. Phased delivery

### P0 — Conversation without weights (1–2 weeks)

- `TripBrief` type + storage (SQLite or secure JSON)  
- `PlanOption` + rules for dogfood scenarios (stage tonight, Zion/Bryce split, GJ staging, drive hours table)  
- Co-pilot chat UI on active trip  
- Hardcoded / small seed **legs table** + **Costco along Bay→Yosemite** seed  
- Apply → local day notes / replan draft hook  

**Exit:** recreate Tracy / Zion-vs-Bryce / GJ conversation offline with seeded data.

### P1 — SQLite POI world + pack download (2–4 weeks)

- `expo-sqlite` schema §6  
- Server `exportCopilotPack` from `imported_poi` + Costco seed  
- Mobile download + ingest + `nearby` / `alongRoute` / `costcosAlong`  
- Extend “Make available offline” → co-pilot pack size UI  
- Map reads sleep/fuel from SQLite when offline  

**Exit:** “camps near me” and “Costcos along the way” work with airplane mode after pack download.

### P2 — On-device SLM (2–4 weeks)

- Native runtime + model download settings  
- Tool-calling loop  
- Battery/memory policy  

**Exit:** natural language quality of this design thread without network.

### P3 — Polish

- FTS name search  
- Pack diff updates  
- Cloud narrator fallback  
- National service packs (Costco US) independent of trip  

---

## 14. Data volume estimates (order of magnitude)

| Pack | Rows | Size (order) |
|------|------|----------------|
| Single long road-trip corridor (sleep+service+fuel, 40 mi pad) | 5k–40k | 5–40 MB |
| Costco US (static) | ~600–800 | <1 MB |
| Legs graph (trip + national nodes) | hundreds | <1 MB |
| Brief + days | tiny | <100 KB |
| SLM 1–3B Q4 | — | 1–2 GB (optional) |

Always show size; allow “next 7 days only.”

---

## 15. Privacy & safety

- POI packs stay on device; no upload of chat unless user opts into cloud assist.  
- iOverlander redistribution: only **workspace-scoped** private imports leave the server for that workspace’s devices (same rule as RLS/API). Shared OSM/Costco seeds are fine.  
- Dispersed camping: show source notes; don’t invent legal status.  
- Heat / long-drive warnings are first-class in options, not buried.

---

## 16. Success criteria

1. Airplane mode, packed trip: user asks “where should we sleep tonight for laundry near Tracy?” → option cards with real POIs from SQLite + Apply.  
2. “2 Zion or 2 Bryce given Denver on the 26th?” → scored options with drive hours; Apply rewrites local days.  
3. “Bryce to Denver how long?” → ~9–10 h from `local_leg` / estimator, not model guess.  
4. SLM off: still works (rules + templates). SLM on: better prose, same options.  
5. Pack download shows size; cancel works; incomplete pack doesn’t crash tools.

---

## 17. Open decisions

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | `expo-sqlite` vs `op-sqlite` | Start **expo-sqlite**; benchmark P1 |
| D2 | Geohash vs RTree | **lat/lng indexes + haversine** first; RTree if slow |
| D3 | Costco data source | Curated static seed in repo + refresh script |
| D4 | Truck stops / laundry | OSM extract in pack export + manual seed for dogfood corridors |
| D5 | SLM vendor | Defer to P2 spike on target iPhones; abstract `CopilotNarrator` now |
| D6 | Single DB vs per-trip DB files | **Single DB**, `trip_id` / `pack_id` columns |

---

## 18. Implementation sketch (first PR after approve)

1. This doc merged as source of truth.  
2. `packages/api`: `exportCopilotPack` stub returning brief + empty pois + seed legs.  
3. `apps/expo`: `LocalDb` + migrations + seed Costco/legs for dogfood corridor.  
4. Co-pilot screen: rules-only chat for the dogfood corpus.  
5. Wire Apply to existing replan draft types where possible.

---

## 19. Doc links

- Today / replan: `docs/plans/2026-07-12-today-command-and-replan-design.md`  
- Offline (query cache / outbox): `docs/ai/OFFLINE_FIRST_DESIGN.md` — **world model = this doc (SQLite)**  
- CONTEXT vocabulary: Driving Mode, Fuel Zone, Corridor, Anchor, Replan  
- Mobile OTA for JS: `apps/expo/docs/preview-build-ota-loop.md` (co-pilot UI ships OTA; native SLM needs binary)

---

## 20. One-line summary

> **Trip co-pilot = local SQLite world (POIs, services, legs, brief) + deterministic planning tools + optional on-device SLM — so van conversations like Tracy / Zion / Bryce / Grand Junction work with the radios off.**

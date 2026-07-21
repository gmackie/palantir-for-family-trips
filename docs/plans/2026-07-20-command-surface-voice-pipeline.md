# Design: Chat-primary planning + offline voice + agent APIs

**Date:** 2026-07-20  
**Status:** Draft — product reframe (interaction + voice + multi-agent access)  
**Builds on:** Today Command, trip co-pilot, SQLite world model, conversational sessions  
**Correction:** Chat is **not** demoted. Chat is the **primary human way to interact**. Structured plan state is the **artifact** that chat produces and that everyone looks at. External agents use **MCP + CLI + API**, not the chat UI.

**Principle:** Humans talk (voice/text) in **trip chat / planning chat**. The co-pilot answers with language **and** structured plan objects. Other software agents call the same planning brain through MCP/CLI/API.

---

## 1. Reframe (corrected)

### 1.1 Two mistakes to avoid

| Mistake | Why it’s wrong |
|---------|----------------|
| **Chat is the whole product** | We care about **nights, legs, options, Apply** — not endless bubbles alone |
| **Chat is demoted to an aside** | In the van, people will **talk and type in chat**; that’s the natural UI. Don’t fight it |

### 1.2 What we actually optimize for

| Layer | Role |
|-------|------|
| **Chat** | Primary **human I/O** — multi-party messages, voice transcripts, co-pilot turns |
| **Plan artifacts** | Primary **thing we care about** — tonight, next nights, options, costs, map pins |
| **MCP / CLI / API** | Primary **agent I/O** — other models/tools steer the same trip without the app UI |

Chat **powers** the experience. Plan state is **what the experience is for**.

### 1.3 Product shape

```
                    ┌─────────────────────────────┐
  Humans            │  CHAT (primary interaction) │
  voice / type  ───▶│  members + co-pilot         │
                    └──────────────┬──────────────┘
                                   │ produces / updates
                    ┌──────────────▼──────────────┐
                    │  PLAN ARTIFACTS               │
                    │  nights · options · legs      │
                    │  anchors · Apply / Lock       │
                    │  (pinned header / cards)      │
                    └──────────────┬──────────────┘
                                   │ same domain ops
     ┌─────────────┬───────────────┼───────────────┐
     ▼             ▼               ▼               ▼
   tRPC API      CLI            MCP server      Local offline
   (app/web)   (scripts)      (other agents)   (SQLite+SLM)
```

### 1.4 One-line product

> **Talk in chat (often by voice). Co-pilot and party argue with structured options. Apply updates the living plan. Other agents do the same jobs over MCP/CLI/API.**

---

## 2. What it looks like on mobile (chat-primary)

### 2.1 Active trip home = **Chat + plan chrome**

Not “chat buried in a tab.” Not “plan board with a tiny composer.”

**Default active-trip route:** planning/trip chat with a **persistent plan header** and **inline option cards**.

```
┌─────────────────────────────────────────┐
│ EN ROUTE · pack OK · 6d → Denver        │  ← status
│ Tonight: Tracy TA · laundry             │  ← living plan chrome
│ Tue–Wed Yosemite · Thu Zion…      [Map] │
├─────────────────────────────────────────┤
│                                         │
│  you: we need laundry tonight near      │
│       Tracy then Yosemite               │
│                                         │
│  Sortie: Stage Tracy truck stop.        │
│  Costco Tracy for fuel first.           │
│  ┌─────────────────────────────────┐    │
│  │ ★ Stage Tracy + 2 Yosemite      │    │  ← PlanOption
│  │   1.2h · laundry · Costco       │    │     in-thread
│  │   [Apply] [Alt options]         │    │
│  └─────────────────────────────────┘    │
│                                         │
│  partner: can we still do 2 Zion?       │
│                                         │
│  Sortie: Yes if Denver 26 holds…        │
│  ┌─ A 2 Zion + Bryce day → GJ  ★ ─┐    │
│  └─ B 2 Bryce + 1 Zion ───────────┘    │
│                                         │
├─────────────────────────────────────────┤
│ 🎤 Hold to talk          [ + ] [Send]   │
└─────────────────────────────────────────┘
```

| Region | Role |
|--------|------|
| **Plan chrome** (top, always) | Glanceable truth: tonight, next nights, next anchor |
| **Chat thread** (main scroll) | Primary interaction — humans + co-pilot |
| **Option cards** (in thread) | Structured proposals, not only prose |
| **Composer** | Voice-first when stopped; type always |

**Trip Chat is this surface** when the trip is in road/planning mode — not a second-class “banter only” room. Social banter and planning moves **share one timeline**, with planning moves **typed** so the co-pilot and UI can render cards.

### 2.2 Message kinds in the same thread

| Kind | Who | Renders as |
|------|-----|------------|
| `text` | human | Bubble |
| `voice_transcript` | human (via Whisper) | Bubble + “from voice” |
| `copilot_text` | co-pilot | Bubble |
| `option_set` | co-pilot (or API agent) | **Option cards** |
| `stance` | human | Reaction on card + small line |
| `decision` / `commit` | organizer / system | Plan chrome updates + system line |
| `tool_fact` | co-pilot | Compact fact (“Bryce→Denver 9.3h”) |
| `social` | human | Bubble (no plan parse required) |

Co-pilot and **external agents** both emit `option_set` / `tool_fact` — same schema whether the actor is `copilot` or `agent:claude` via API.

### 2.3 Drive / motion

- **Stopped:** full chat + voice + planning.  
- **Moving:** composer still available for short notes; heavy replan prompts deferred or passenger-only; plan chrome stays glanceable.

### 2.4 Map / Today / Day plan

Still first-class routes — **views of the same plan**, not replacements for chat interaction:

- **Map** — spatial  
- **Today** — execution of committed day  
- **Day plan** — multi-day grid editor  
- **Chat** — how you **change** the plan in natural language  

---

## 3. Offline voice → chat → plan

```
Mic ──▶ Offline Whisper (STT) ──▶ transcript message in chat
                                         │
                                         ▼
                              Co-pilot (on-device or server)
                                         │
                    tools: SQLite POIs, legs, brief, anchors
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              chat reply          option_set cards      plan chrome
              (prose)             (structured)          (if applied)
```

Whisper does **not** replace chat — it **fills the composer** (or posts a `voice_transcript` message) that then hits the same path as typing.

Details on Whisper runtimes: §5 below (unchanged technical substance).

---

## 4. Agent access: MCP + CLI + API

Humans use chat. **Other agents** should not scrape the UI — they use the same planning domain through machine interfaces.

### 4.1 Shared domain operations

Everything that chat can trigger must exist as ops:

| Op | Example |
|----|---------|
| `getTripBrief` | anchors, prefs |
| `getPlan` | days, nights, status |
| `estimateDrive` | from → to hours |
| `searchServices` | camps, Costco, laundry near point/corridor |
| `proposeOptions` | generate PlanOption[] for a scope |
| `postToChat` | agent message + optional option_set |
| `setStance` | (if agent acts for a user — rare) |
| `applyOption` | commit option (authz) |
| `exportCopilotPack` | offline pack for device |

Chat co-pilot is **one client** of these ops. MCP/CLI/API are **other clients**.

### 4.2 API (tRPC / HTTP)

- Existing trip/planner routers extended with planning-session + option apply.  
- Auth: session cookie, API key, or workspace service principal.  
- Idempotent client ids on post/apply (agents retry safely).

### 4.3 CLI (`gmacko-ops` / `sortey` / forge-adjacent)

```bash
# Examples — names TBD
sortey plan show --trip <id>
sortey plan drive --from bryce --to denver
sortey plan propose --trip <id> --scope utah_nights
sortey plan apply --trip <id> --option <id>
sortey chat post --trip <id> --text "…" --as copilot
sortey pack export --trip <id> --out ./pack
```

Used by scripts, CI, and agents in terminals.

### 4.4 MCP server

Expose the same ops as MCP tools for Cursor / Claude / other agents:

| MCP tool | Maps to |
|----------|---------|
| `trip_get_plan` | getPlan |
| `trip_estimate_drive` | estimateDrive |
| `trip_search_pois` | searchServices (online or pack-backed) |
| `trip_propose_options` | proposeOptions |
| `trip_apply_option` | applyOption |
| `trip_post_message` | postToChat (so agents can participate in the human-visible thread) |

**Critical:** An external agent that `trip_post_message` + `trip_propose_options` shows up **in the same chat UI** humans use — one shared timeline, multiple actors (`copilot`, `agent:…`, humans).

### 4.5 Authz for agents

| Actor | Default powers |
|-------|----------------|
| Human member | post, stance |
| Human organizer | apply |
| On-device co-pilot | post, propose; not apply unless user confirms |
| MCP agent (user-delegated) | scoped token: read plan + propose; apply only with elevated grant |
| CLI with user token | same as user |

Never give unconstrained apply to random MCP connections.

### 4.6 Offline vs agent path

| Client | Offline |
|--------|---------|
| Human + Whisper + on-device co-pilot | Full local tools + SQLite pack |
| MCP/CLI on laptop | Needs network **or** local pack file + local runtime |
| Server co-pilot | Online only |

Device remains the offline van brain; MCP agents are typically online collaborators.

---

## 5. Offline speech-to-text (Whisper)

### 5.1 Requirement

- **iOS + Android**, fully offline after model download  
- Feed **chat**, not a separate dead-end screen  
- Private (audio stays on device for STT)

### 5.2 Stack recommendation

| Priority | Runtime | Notes |
|----------|---------|--------|
| 1 | **[whisper.rn](https://github.com/mybigday/whisper.rn)** (whisper.cpp) | Parity iOS/Android offline |
| 2 | **react-native-executorch** Whisper Tiny/Base EN | ~150 MB path; Expo-friendly |
| Avoid as sole path | OS cloud STT / inconsistent offline packs | Breaks van + Android parity |

**Default weights:** `base.en` or `tiny.en` (~50–150 MB), **downloadable** in Settings / “Prepare trip offline.”

### 5.3 UX

- Hold-to-talk in **chat composer**  
- Partial/final transcript → editable → send as message  
- Then co-pilot runs on that message like any text  

---

## 6. On-device co-pilot + SQLite

Unchanged dependency: chat without a world model cannot answer “Costco on the way” offline.

Pipeline:

1. Message in chat (voice or type)  
2. Local tools → `local_poi`, `local_leg`, brief, anchors  
3. Rules (+ optional SLM) → reply + `option_set`  
4. Cards in thread + update plan chrome  
5. Human (or authorized agent) **Apply**  

See: `2026-07-14-trip-copilot-on-device.md`, `2026-07-14-trip-copilot-sqlite-schema.md`.

---

## 7. Multi-party (humans + agents)

| Participant | How they enter the thread |
|-------------|---------------------------|
| Trip members | Chat UI |
| On-device / server co-pilot | Auto participant `copilot` |
| External agents | MCP/API `post_message` + `propose_options` as `agent:<name>` |

Stances and Apply policies: collaborative planning doc — still valid; render stances on **cards in chat**, plan chrome at top.

---

## 8. Phased delivery

### P0 — Chat-primary + structured artifacts

- Active trip home = **chat + plan chrome**  
- Co-pilot replies with **option cards** in-thread  
- Apply updates days + chrome  
- Typed input only  

### P1 — Offline Whisper into composer

- Downloadable Whisper  
- Hold-to-talk → transcript message → same co-pilot path  

### P2 — SQLite pack + full offline co-pilot tools  

### P3 — MCP + CLI parity  

- MCP server tools  
- CLI for plan/propose/apply/post  
- Agents appear in chat timeline  

### P4 — On-device SLM + multi-agent etiquette  

---

## 9. Success criteria

1. Human default interaction is **chat** (voice or type), not hunting forms.  
2. Every serious co-pilot answer can attach **PlanOption** cards and update **plan chrome**.  
3. Airplane mode: Whisper + pack → propose staging/Utah split → Apply.  
4. An external agent via **MCP/API** can propose options that **show in the same chat** and can be Applied by an organizer.  
5. Trip banter and planning share one thread without losing structured decisions.  

---

## 10. Open decisions

| # | Topic | Recommendation |
|---|--------|----------------|
| R1 | One thread vs #planning channel | **One trip chat** with typed moves; filter “planning only” optional |
| R2 | Agent display names | `agent:codex`, `copilot` badges in timeline |
| R3 | MCP host | `@sortey/mcp-server` or trip-scoped tools in existing MCP package |
| R4 | Whisper runtime | Spike whisper.rn vs ExecuTorch on device |

---

## 11. Doc graph

```
THIS DOC — chat-primary UI + voice + MCP/CLI/API agents
  ├── conversational-collaborative-planning.md  (moves, stances, sessions)
  ├── trip-copilot-on-device.md                  (tools, SLM, packs)
  ├── trip-copilot-sqlite-schema.md              (POI DB)
  └── today-command-and-replan.md               (apply / execution)
```

---

## 12. Summary

| Layer | Role |
|-------|------|
| **Chat** | Primary **human** interaction (voice + text + multi-party) |
| **Plan artifacts** | What we **care about** (nights, options, Apply) — chrome + cards |
| **Whisper** | Offline speech → chat messages |
| **SQLite world** | Offline truth for POIs/legs |
| **MCP + CLI + API** | How **other agents** interact with the same brain and timeline |

> **Chat is the steering wheel. The plan is the dashboard. Agents get a programmatic wheel — not a scraped UI.**

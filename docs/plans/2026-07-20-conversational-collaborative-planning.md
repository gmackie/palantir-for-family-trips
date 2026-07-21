# Design: Conversational & collaborative trip planning

**Date:** 2026-07-20  
**Status:** Draft — product + interaction architecture  
**UI reframe (read first):** [`2026-07-20-command-surface-voice-pipeline.md`](./2026-07-20-command-surface-voice-pipeline.md) — **Command Surface is primary real estate**; Trip Chat is an aside; offline Whisper → co-pilot → plan.  
**Parent:** On-device co-pilot ([`2026-07-14-trip-copilot-on-device.md`](./2026-07-14-trip-copilot-on-device.md)), SQLite world model ([`2026-07-14-trip-copilot-sqlite-schema.md`](./2026-07-14-trip-copilot-sqlite-schema.md)), Today/Replan ([`2026-07-12-today-command-and-replan-design.md`](./2026-07-12-today-command-and-replan-design.md))  
**Dogfood scene:** Van party planning nights out loud — today often **one human + co-pilot agent**; product goal is **N humans + co-pilot** sharing **options on the command canvas**.  
**Principle:** Planning is a **conversation that produces structured plan objects rendered on the command surface**. The co-pilot is a **party member with tools**. Trip Chat is not the home screen.

---

## 1. Problem

### 1.1 What good planning actually looks like

Real van / group planning is multi-turn and multi-voice:

| Turn | Who | Move |
|------|-----|------|
| “We’re leaving the Bay, camp tonight?” | Driver | Open problem |
| “Tracy truck stop — laundry + Costco first” | Co-pilot | Stage + services |
| “Can we still hit Yosemite tomorrow?” | Partner | Constraint check |
| “2 Zion or 2 Bryce?” | Party | Tradeoff |
| “I care more about the hike” | Partner A | Preference |
| “I care more about not melting” | Partner B | Preference |
| “Then 2 Zion, Bryce morning, sleep GJ” | Co-pilot | Synthesis |
| “Lock it” | Organizer | Commit |

Today Sortie has:

- **Screens** (day plan, map, Today) — great for execution, weak for debate  
- **Trip chat** (`trip_message`) — social, not plan-structured  
- **Polls / proposals** — good for pre-trip votes; not wired to live road-trip night budgets  
- **Co-pilot design (solo)** — one user ↔ agent  

Missing: a **planning conversation object** that can include **multiple humans + co-pilot**, retains **options and decisions**, and **writes the plan**.

### 1.2 Solo agent is a special case of multi-party

```
Solo dogfood today:     [You] ←→ [Co-pilot]
Target product:         [You] ←→ [Co-pilot] ←→ [Partner] ←→ [Friend]
                              ↘     Plan state     ↙
```

Architecture must treat **solo** as `participants = [self, copilot]`, not a separate product.

---

## 2. Goals / non-goals

### Goals

| ID | Goal |
|----|------|
| C1 | **Conversational depth** — multi-turn threads that refine constraints, not one-shot prompts |
| C2 | **Structured outcomes** — every serious turn can produce `PlanOption`, reactions, or a **Decision** |
| C3 | **Multi-party** — trip members join the same planning session; co-pilot facilitates |
| C4 | **Preference fusion** — different people can weight hike vs heat vs miles; co-pilot shows conflict |
| C5 | **Commit discipline** — only authorized roles **apply** plan changes; others **propose / vote / react** |
| C6 | **Works with offline co-pilot** — solo offline full; multi-party offline = local draft + sync merge |
| C7 | **Reuse** polls/proposals/chat patterns where they fit; don’t fork three parallel “opinion” systems |

### Non-goals (v1 collaborative)

- Full Google-Docs-style concurrent editing of day rows  
- Voice party line / live audio  
- Anonymous public trip planning  
- Replacing free-form trip chat for social banter  

---

## 3. Vocabulary

| Term | Definition |
|------|------------|
| **Planning session** | A bounded conversation aimed at changing (or locking) plan state for a date range or topic. Not the same as trip chat. |
| **Participant** | Trip member or `copilot` (system participant). |
| **Move** | One conversational act: question, constraint, preference, option, reaction, decision, apply. |
| **Plan option** | Structured alternative (nights, hours, scores) — see co-pilot parent doc. |
| **Stance** | A participant’s position on an open option: support / oppose / neutral + optional weight. |
| **Decision** | Recorded resolution: chosen option id, who decided, when, and resulting draft fingerprint. |
| **Commit** | Applying a Decision to trip days / anchors (soft replan). |
| **Facilitation** | Co-pilot behavior in multi-party: summarize conflict, propose compromise, never silently pick sides without rules. |
| **Floor** | Whose turn / who may Commit (role-gated). |
| **Session scope** | Date range and/or theme: `tonight`, `utah_split`, `until_denver`, `full_remaining`. |

_Avoid:_ “AI chat” (under-specifies structure), “group brainstorm” (no commit path).

---

## 4. Conversational depth (solo or multi)

### 4.1 Conversation is a state machine, not a log

```
                 ┌──────────────┐
                 │   Open       │  problem framed
                 └──────┬───────┘
                        │ constraints + prefs gathered
                        ▼
                 ┌──────────────┐
                 │   Options    │  ≥2 PlanOptions on the table
                 └──────┬───────┘
                        │ stances / debate
                        ▼
                 ┌──────────────┐
                 │   Inclined   │  recommended option clear
                 └──────┬───────┘
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   ┌────────────┐ ┌──────────┐ ┌────────────┐
   │  Decided  │ │  Blocked │ │  Deferred  │
   │  (chosen)  │ │ (conflict│ │ (parked)   │
   └─────┬──────┘ │  needs   │ └────────────┘
         │        │  human)  │
         ▼        └──────────┘
   ┌────────────┐
   │  Committed │  written to plan + optional outbox
   └────────────┘
```

The UI shows **session phase** (chip): Open · Options · Deciding · Committed.

### 4.2 Move types (first-class)

Every message is stored as free text **plus** a typed move when parseable:

| Move type | Example | Structured payload |
|-----------|---------|-------------------|
| `frame` | “Camp tonight from the Bay” | `{ scope: "tonight", origin: "bay" }` |
| `constraint` | “Must be in Denver by the 26th” | `{ type: "arrive_by", date, place }` |
| `preference` | “I care more about the hike” | `{ axis: "hike", weight: high, userId }` |
| `service_need` | “Need laundry + fuel” | `{ services: ["laundry","fuel"] }` |
| `ask_options` | “2 Zion or 2 Bryce?” | `{ topic: "utah_nights" }` |
| `option_set` | Co-pilot publishes cards | `{ options: PlanOption[] }` |
| `stance` | “Prefer option A” | `{ optionId, stance, userId }` |
| `question` | “How long is Bryce→Denver?” | → tool result attach |
| `synthesize` | Co-pilot compromise | `{ recommendedId, rationale }` |
| `decide` | “Lock Zion 2 / Bryce day” | `{ optionId, decidedBy }` |
| `commit` | Apply to plan | `{ decisionId, applyJobId }` |
| `defer` | “Decide at Zion gate” | `{ reopenOn: "arrive_zion" }` |
| `object` | “That day is too long for kids” | `{ optionId, reason }` |

**Co-pilot and humans share the same move vocabulary.** The agent is not a separate protocol.

### 4.3 Multi-turn patterns we must support

#### Pattern A — Progressive constraint tightening

1. Frame: camp tonight  
2. Constraint: still reach Yosemite tomorrow by noon  
3. Service: laundry  
4. Options: Tracy TA vs Oakdale vs push to Groveland  
5. Decide + commit  

UI keeps a **Constraint stack** visible (dismissible chips), not only chat bubbles.

#### Pattern B — Preference conflict (multi-party core)

1. Options published  
2. A stances hike-heavy; B stances heat-safe  
3. Co-pilot: “Conflict on heat vs hike — compromise option C (1 Zion full day + early Bryce + GJ)”  
4. Both stance C or organizer decides  

#### Pattern C — Tool-grounded fact check

1. “Can we do Bryce and Denver same day?”  
2. Co-pilot tool: 9.3 h + 1.5 h Zion hop → **no** overnight Bryce  
3. Options rewrite automatically  

#### Pattern D — Reopen after reality

1. Committed plan  
2. Side trip / late leave / full campground  
3. New session scoped `from_today` with reason `behind` / `stayed` (align replan reasons)  

### 4.4 What “good co-pilot speech” does every turn

1. **Restate** the open problem in one line  
2. **List constraints** it is honoring (including other people’s prefs)  
3. **Offer 1 rec + 1 alt** with **costs** (hours, nights, anchor risk)  
4. **Ask at most one** clarifying question if blocked  
5. **Never** invent POIs or miles — cite tools (“from leg table”, “3 camps in pack”)  

### 4.5 Conversation memory layers

| Layer | Lifetime | Content |
|-------|----------|---------|
| **Turn** | Message | Text + move |
| **Session** | Until commit/defer | Constraints, options, stances, phase |
| **Brief** | Trip lifetime | Durable prefs (hike bias), soft goals |
| **Plan** | Trip lifetime | Days, anchors (source of truth) |
| **Journey** | Past | What actually happened (feeds replan) |

Sessions should **summarize into brief** on commit (“Party prefers hike over heat for Utah”) so the next session doesn’t restart from zero.

---

## 5. Collaborative multi-party model

### 5.1 Participants

| Participant | Source |
|-------------|--------|
| Human | `trip_member` (+ workspace role) |
| Co-pilot | Synthetic participant id `copilot` |

Display: avatars for humans; distinct co-pilot badge (not pretending to be a person).

### 5.2 Roles (planning floor)

Map to existing trip/workspace roles; keep simple for road-trip dogfood:

| Role | Can frame / stance / object | Can **Decide** | Can **Commit** (apply replan) |
|------|----------------------------|----------------|------------------------------|
| **Organizer** (owner/admin) | yes | yes | yes |
| **Member** | yes | if session policy allows | no (default) |
| **Viewer** / limited | stance only if invited | no | no |
| **Co-pilot** | propose options, synthesize | no (never self-commit) | no |

**Session policy** (per session):

- `organizer_decides` (default road trip)  
- `majority_stance` (options need ≥50% of active stances)  
- `unanimous` (strict couples trip)  
- `anyone_commits` (solo-like trust; rare)  

### 5.3 Session visibility

| Mode | Who sees | Use |
|------|----------|-----|
| **Party session** | All trip members | Default collaborative planning |
| **Cab session** | Subset (driver + navigator) | Noise reduction on big trips |
| **Private co-pilot** | Only self + copilot | “What if I went Tahoe first?” without spamming the group |

Private sessions can **promote** an option into a party session (“Share with trip”).

### 5.4 Realtime (when online)

- Session events over existing trip realtime channel (same stack as locations/chat):  
  `planning.session.upsert`, `planning.move`, `planning.stance`, `planning.decision`, `planning.committed`  
- Presence: who is in the planning sheet now  
- Idempotent move ids (client UUID) for offline queue  

### 5.5 Offline multi-party (honest limits)

| Situation | Behavior |
|-----------|----------|
| Solo offline | Full co-pilot (local SQLite + rules/SLM); commits queue |
| Multi offline, no mesh | Each device can **private** plan; party session frozen or read-only last snapshot |
| Reconnect | Replay moves by timestamp; detect conflicting **Commits** |

**Conflict on commit:**

1. If two commits touch overlapping dates → second commit becomes **proposal** needing organizer resolve  
2. Show diff of night assignments  
3. Never silent last-write-wins on applied plan without banner  

This matches “no full CRDT” non-goal while staying safe.

### 5.6 Co-pilot as facilitator (multi-party prompts)

When >1 human participant active:

- Address prefs by **name**: “Alex weighted hike; Sam weighted heat.”  
- Prefer **compromise options** when stances split.  
- If stances tied and policy is organizer_decides: “Needs organizer lock.”  
- Don’t shame; don’t fake consensus.  

When solo: same engine, shorter facilitation language.

---

## 6. Relationship to existing Sortie surfaces

| Existing | Relationship |
|----------|----------------|
| **Trip chat** | Social / operational (“running late”). Link: “Discuss in planning” opens session; planning can **post summary** to chat on commit. |
| **Polls** | Pre-trip structured votes. Planning session can **spawn a poll** from option set for async members. |
| **Proposals** | Lodging/flight ideas. Can attach to session as constraints (“booked Ahwahnee 23rd”). |
| **Today Command** | Execution of **committed** day. “Replan…” opens session with reason. |
| **Day plan editor** | Power user grid; sessions write the same day rows. |
| **Journey log** | Actuals; co-pilot reads for “we already stayed late.” |
| **Group mode** | Expenses orthogonal; planning collaboration available whenever `trip_member` count > 1 **or** always with co-pilot. |

**Road trip + group mode** is the full matrix (van family). **Road trip solo** is co-pilot-only party. **Destination group** can use the same session model for “where do we eat tonight” later (v2 scope).

---

## 7. Data model (server + client)

### 7.1 Server (Postgres) — collaborative source of truth when online

```
planning_session
  id, trip_id, workspace_id
  title, scope_json          -- { type, fromDate, toDate, theme }
  phase                      -- open|options|inclined|decided|committed|deferred|blocked
  policy                     -- organizer_decides|majority|unanimous|anyone_commits
  visibility                 -- party|cab|private
  created_by, created_at, updated_at
  committed_at, committed_by
  decision_option_id

planning_participant
  session_id, user_id | 'copilot'
  role_override nullable
  last_seen_at

planning_move
  id (client uuid), session_id
  actor_user_id | 'copilot'
  move_type
  body_text
  payload_json               -- typed per move
  created_at
  parent_move_id nullable    -- thread reply

planning_option
  id, session_id
  option_json                -- PlanOption
  sort_order
  created_by                 -- usually copilot
  created_at

planning_stance
  session_id, option_id, user_id
  stance                     -- support|oppose|neutral
  weight                     -- 1-3
  note
  updated_at
  PRIMARY KEY (session_id, option_id, user_id)
```

### 7.2 Client SQLite additions (extend co-pilot schema doc)

Mirror for offline solo + outbox:

```sql
CREATE TABLE planning_session_local (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  policy TEXT NOT NULL,
  visibility TEXT NOT NULL,
  scope_json TEXT,
  server_synced INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE planning_move_local (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  move_type TEXT NOT NULL,
  body_text TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE planning_option_local (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  option_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE planning_stance_local (
  session_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stance TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, option_id, user_id)
);
```

Link `copilot_apply_queue` to `decision_id` / `session_id`.

### 7.3 PlanOption remains the currency

Collaboration does not invent a second option format. Stances attach to **option ids**. Commit applies **one** option’s night layout via existing replan types.

---

## 8. UX surfaces

### 8.1 Planning session sheet (mobile)

```
┌─────────────────────────────────────────┐
│ Utah nights · Options          Party (3)│
│ Constraints: Denver 26 · max 10h day    │
├─────────────────────────────────────────┤
│ 💬 thread (moves)                       │
│  Alex: hike matters more                │
│  Sam: heat is brutal                    │
│  Sortie: conflict — compromise C …      │
├─────────────────────────────────────────┤
│ [A 2 Zion + Bryce day]  ★ rec   👍2 👎0 │
│ [B 2 Bryce + 1 Zion]            👍1 👎1 │
│ [C 1 Zion + GJ stage]           👍0 👎0 │
├─────────────────────────────────────────┤
│ [Support A]  [Ask Sortie]  [Lock A]     │
└─────────────────────────────────────────┘
```

- **Lock** only if role+policy allow  
- Long-press option → map preview of nights  
- “Open in chat” posts summary card to trip chat  

### 8.2 Today / Drive entry points

- Today: **“Plan with party”** / **“Ask co-pilot”**  
- Drive (stopped): same, plus service chips  
- Notification: “Alex supported option A — 2 of 3”

### 8.3 Web parity

Dense session panel beside day plan; same APIs. Organizer desktop is useful for multi-day commits.

### 8.4 Empty / loading / conflict states

| State | UX |
|-------|-----|
| Alone on trip | Co-pilot only; copy “Just you + Sortie” |
| Offline multi | Banner: “Party planning needs network; private co-pilot still works” |
| Commit conflict | Diff modal, not toast |
| Co-pilot pack missing | Can still debate abstract options; no “camps near me” |

---

## 9. Facilitation algorithms (rules, not vibes)

### 9.1 Stance aggregation

```
score(option) =
  sum(weight_i for support) - sum(weight_i for oppose)
  + organizer_bias if policy requires
```

Recommended option:

1. Highest score among options with `anchorRisk ≤ 1`  
2. Else highest score with warning  
3. If tie → mark session `blocked` / needs organizer  

### 9.2 Preference axes (brief + per-session)

| Axis | Example signals |
|------|-----------------|
| `hike` | “real hike”, Zion, trails |
| `heat` | “don’t melt”, shade, altitude |
| `mileage` | “short day”, max hours |
| `services` | laundry, Costco, dump |
| `scenery` | Bryce rim, overlooks |
| `rest` | recovery day, hotel |

Session moves of type `preference` update a **session preference vector**; co-pilot re-scores options when vector changes.

### 9.3 Compromise generator

When top two options split the party on one axis:

- Build hybrid nights (e.g. cut second Zion night → earlier GJ)  
- Re-run drive tools  
- Publish as new option with `source: "compromise"`  

---

## 10. API sketch

```ts
// Session lifecycle
planning.createSession({ tripId, scope, policy, visibility })
planning.listSessions({ tripId })
planning.getSession({ sessionId })  // moves, options, stances, phase

// Moves
planning.postMove({ sessionId, moveType, bodyText, payload, clientId })
planning.setStance({ sessionId, optionId, stance, weight, note })

// Co-pilot (server or local)
planning.copilotTurn({ sessionId, message, lat?, lng? })
  // runs tools → may append option_set + synthesize moves

// Commit
planning.decide({ sessionId, optionId })
planning.commit({ sessionId })  // → replan apply + phase=committed
```

**Local-first:** mobile calls the same shapes against a local adapter when offline (solo / private).

---

## 11. Conversational quality bar (evaluation)

Use dogfood transcripts as fixtures:

| Scenario | Pass criteria |
|----------|----------------|
| Bay camp tonight | Stages foothills/Tracy; Costco before 120; no Tahoe-first |
| Zion vs Bryce with Denver anchor | Options show hours; no Bryce+Denver overnight lie |
| Two prefs conflict | Compromise option or blocked + organizer |
| Commit | Days updated; chat summary optional; undo path exists |
| Offline solo | Full thread without network |
| Offline then online | No silent overwrite of partner commit |

Manual + later LLM-as-judge on facilitation tone (optional).

---

## 12. Privacy & social safety

- Private sessions never leak to party feed  
- Stance notes visible to session participants only  
- Co-pilot must not invent member statements  
- Minors / family trips: organizer can disable member commit forever  
- iOverlander POIs still workspace-scoped on device packs  

---

## 13. Phased delivery

### P0 — Conversational solo (deep, one human)

- Planning **session** object (even if only self + copilot)  
- Move types + phase chip  
- Constraint stack UI  
- Option cards + stance (self only)  
- Commit → local/server replan  
- Seed SQLite legs/Costco (from schema doc)  

**Exit:** Full dogfood monologue feels like this design thread.

### P1 — Party sessions (online)

- Multi participant + stances  
- Realtime moves  
- Policy + organizer lock  
- Promote private → party  
- Post commit summary to trip chat  

**Exit:** Two phones can argue Zion/Bryce and lock one plan.

### P2 — World model + offline co-pilot

- SQLite packs, nearby camps, Costco along route  
- Local session for solo offline  
- Apply queue  

### P3 — On-device SLM + richer facilitation

- Local narrator  
- Better compromise language  
- Async poll bridge for members not in session  

---

## 14. Success criteria

1. A couple can open **one session**, disagree on heat vs hike, see a **compromise option**, and **lock** without leaving the sheet.  
2. Solo driver offline gets the same session UX with co-pilot only.  
3. “How long is the 26th drive?” answers from **legs**, not chatter.  
4. Commit is **auditable** (who, which option, when) and visible on day plan.  
5. Trip chat remains for banter; planning session remains for **decisions**.  

---

## 15. Open product decisions

| # | Question | Recommendation |
|---|----------|----------------|
| D1 | Default policy for road-trip groups | `organizer_decides` with visible stances |
| D2 | Co-pilot in trip chat vs separate surface | **Separate session sheet**; summaries into chat |
| D3 | Max active party sessions per trip | Soft cap 5 open; archive committed |
| D4 | Kids / multi-family | Organizer-only commit; optional hide stances |
| D5 | Destination-mode “tonight food” | Same session model, later pack types |

---

## 16. Doc graph

```
conversational-collaborative-planning.md  (this doc — talk + multi-party)
        │
        ├── trip-copilot-on-device.md     (agent port, offline SLM, packs)
        ├── trip-copilot-sqlite-schema.md (local world DDL)
        ├── today-command-and-replan.md   (execution + apply pipeline)
        └── OFFLINE_FIRST_DESIGN.md       (outbox / query cache)
```

---

## 17. One-line summary

> **Planning is a multi-move conversation among people and a tool-using co-pilot; options and stances are first-class, commit is role-gated, and the plan is the only source of truth — whether the party is one human offline or a full van online.**

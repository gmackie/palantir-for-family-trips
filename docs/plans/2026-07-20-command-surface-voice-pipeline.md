# Design: Command surface + offline voice → plan pipeline

**Date:** 2026-07-20  
**Status:** Draft — **product reframe** (primary UI + voice stack)  
**Supersedes (priority):** Treating **Trip Chat** as primary product real estate  
**Builds on:** Today Command, trip co-pilot, SQLite world model, conversational sessions  
**Principle:** The thing you *use* is a **live plan command surface**. Voice (and optional text) is how you **steer** it. Chat is an **aside** that can power or record decisions — not the home screen.

---

## 1. Reframe

### 1.1 What we got wrong in earlier drafts

Earlier co-pilot / collab docs leaned toward **“a planning chat (with options).”** That over-indexes on **Trip Chat** and message UI.

What we actually care about — and what the van dogfood conversation produced — is:

| Care about | Not the primary thing |
|------------|------------------------|
| **Where we sleep / drive / hike next** as a living plan | A scrollback of bubbles |
| **Options with costs** (hours, nights, heat, anchors) | Generic “AI chat” |
| **Apply / lock** into the trip | Banter and asides |
| **Works offline in the cab** | Requires cell + server LLM |

**Trip Chat stays.** It is useful for coordination noise and for **powering** (and logging) decisions. It is **not** the main real estate.

### 1.2 Product hierarchy (mobile road trip)

```
┌─────────────────────────────────────────────────────────────┐
│  PRIMARY REAL ESTATE — Command Surface                        │
│  Live plan: nights · legs · anchors · services · options      │
│  Thumb: 🎤 Speak · Apply · Map · Navigate                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ steers / proposes
┌───────────────────────────▼─────────────────────────────────┐
│  INPUT LAYER — Voice (primary) · typed (secondary)            │
│  Offline Whisper → text → co-pilot tools + local world        │
└───────────────────────────┬─────────────────────────────────┘
                            │ may mirror / notify
┌───────────────────────────▼─────────────────────────────────┐
│  ASIDE — Trip Chat · private notes · party feed               │
│  Optional: “Posted decision summary” after Apply              │
└─────────────────────────────────────────────────────────────┘
```

**Today Command** and **Drive** are modes of the **same command surface** (execution vs motion), not competitors to chat.

### 1.3 One-line product

> **Hold the mic: say what changed. The plan updates — options, costs, map, next night — offline.**

---

## 2. What the primary surface looks like

### 2.1 Information architecture (active road trip)

**Default home when trip is `en_route` / `active`:** Command Surface (not trip list, not chat).

#### A. Status rail (always)

- Trip name · run state · connectivity (offline pack / model ready)  
- **Next anchor** (e.g. Denver 26th) + nights remaining  
- GPS-derived mode: **In motion** | **Stopped**

#### B. Plan body (primary canvas — not a chat log)

| Block | Content |
|-------|---------|
| **Tonight** | Place, kind (truck stop / camp / park), services, navigate |
| **Next 2–4 nights** | Compact strip of night cards (date, place, role: stage/play/transit) |
| **Legs** | Hours to next overnight / next anchor (from `local_leg`) |
| **Services near path** | Costco / laundry / dump chips from SQLite |
| **Open options** (when debating) | 1–3 **PlanOption cards** with scores — not buried in bubbles |

When no debate: options collapse; body is pure “what’s locked.”

#### C. Co-pilot strip (bottom, not full-screen chat)

```
┌──────────────────────────────────────────┐
│  “2 Zion or Bryce for the hike?”         │  ← last utterance / status
│  [ 🎤 Hold to talk ]  [Type]  [Apply ★]  │
└──────────────────────────────────────────┘
```

- **Hold-to-talk** is the default input on phone in the van.  
- Tapping the strip expands a **short session pane** (last N moves + options) — still secondary to the plan body.  
- Full **Trip Chat** is a separate tab/sheet for party banter.

#### D. Map (one gesture away)

- Fuel-colored route, POIs, proposed overnight pins from active option  
- Not the permanent home chrome; Command Surface owns the plan narrative

### 2.2 Wireframe — stopped (planning / staging)

```
┌─────────────────────────────────────┐
│ EN ROUTE · OFFLINE PACK OK · 6d→DEN │
├─────────────────────────────────────┤
│ TONIGHT                             │
│ Tracy TA · truck stop · laundry     │
│ [Navigate] [Log stop]               │
├─────────────────────────────────────┤
│ NEXT                                │
│ Tue  Yosemite play                  │
│ Wed  Yosemite play                  │
│ Thu  Zion (arrive)                  │
│ Fri  Zion hike day                  │
│ …                                   │
├─────────────────────────────────────┤
│ OPEN · Utah nights                  │
│ ★ A  2 Zion + Bryce day → GJ        │
│   B  2 Bryce + 1 Zion               │
│   hike↑ heat↓ · 9.3h Bryce→Denver   │
├─────────────────────────────────────┤
│ 🎤  “I care more about the hike”    │
└─────────────────────────────────────┘
```

### 2.3 Wireframe — in motion (Driving Mode)

```
┌─────────────────────────────────────┐
│ IN MOTION · 62 mph · ON PLAN        │
├─────────────────────────────────────┤
│ NEXT STOP · Groveland stage         │
│ 48 mi · ~1h10                       │
│ Fuel: 190 mi range · Costco Tracy ✓ │
├─────────────────────────────────────┤
│ [Map]  [Side trip?]  [Log stop]     │
├─────────────────────────────────────┤
│ 🎤  (disabled / parked-only policy) │  or short voice notes only
└─────────────────────────────────────┘
```

**Policy:** full planning voice **when stopped** (or passenger mode). While moving: glanceable only; optional short voice note queued for when parked (safety).

### 2.4 Multi-party on the command surface

Not “group chat in the middle of the screen.”

| Element | Multi-party behavior |
|---------|----------------------|
| Night strip | Source of truth for everyone |
| Option cards | Show **stance avatars** (Alex 👍, Sam 👎) |
| Co-pilot strip | Facilitates; posts options onto the canvas |
| Trip Chat | Aside: “running 20 late”, memes; **optional** decision broadcast |
| Lock / Apply | Organizer (or policy); big control on canvas |

Party members see the **same plan canvas**; they don’t need to live in a message thread to participate.

### 2.5 What Trip Chat is for

| Use chat | Don’t use chat as primary |
|----------|---------------------------|
| Social / ops coordination | Debating nights without option cards |
| Linking a photo of a campground sign | Only place to see tomorrow’s plan |
| Optional “Decision: locked Utah A” system message | Steering the trip while driving |

**Chat powers the product** when:

1. Utterances (voice→text or typed) enter the **session**, and  
2. Co-pilot writes **options onto the command surface**, and  
3. On Apply, a **summary** can be mirrored to chat for the record.

Chat is a **bus and archive**, not the **UI metaphor**.

---

## 3. End-to-end pipeline (offline)

```
┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐
│  Microphone  │──▶│ Offline STT  │──▶│  Text (transcript)       │
│  hold-to-talk│   │ Whisper*     │   │  + confidence / language │
└──────────────┘   └──────────────┘   └────────────┬─────────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Co-pilot runtime (on-device)                                       │
│  1. Parse move (frame / preference / ask_options / …)              │
│  2. Tools → SQLite world (POI, legs, brief, anchors, days)         │
│  3. Rules → PlanOption[]                                           │
│  4. Optional SLM → narration + recommended option                  │
│  5. Update session + push options onto Command Surface             │
└────────────────────────────┬─────────────────────────────────────┘
                             │ user taps Apply
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Plan commit → local_trip_day / replan draft + apply outbox        │
│  Optional: post summary to Trip Chat                               │
└──────────────────────────────────────────────────────────────────┘
```

**Fully offline** when:

- Whisper model downloaded  
- Co-pilot pack (POIs + legs + brief) downloaded  
- Rules engine present (SLM optional)

---

## 4. Offline speech-to-text (Whisper and friends)

### 4.1 Requirement

| Need | Spec |
|------|------|
| Platforms | **iOS and Android** (Expo dev client / production binary) |
| Network | **None** after model download |
| Latency | Target **&lt; 2–4 s** for a short van utterance on mid-tier phone |
| Privacy | Audio never leaves device for STT |
| Language | v1 **English**; multilingual later |

### 4.2 Recommended approach: **whisper.cpp via React Native**

**Primary candidate: [whisper.rn](https://github.com/mybigday/whisper.rn)** (whisper.cpp bindings)

| Pros | Cons |
|------|------|
| True offline parity iOS + Android | Native module → custom dev client |
| Model choice (tiny / base / small) | Binary + weight download size |
| Community / 2025–26 RN usage | CPU/thermal under load; not magic realtime dictation |
| Private, no OEM language-pack drift | Streaming UX needs careful VAD + chunking |

**Alternative / complement:**

| Stack | When |
|-------|------|
| **react-native-executorch** + Whisper Tiny EN | Expo-friendly path; ~**150 MB** (encoder+decoder+tokenizer); good for English-only dogfood |
| **Apple Speech / SFSpeechRecognizer** | iOS-only offline packs; inconsistent with Android |
| **@react-native-voice/voice** | Often cloud or OS-dependent; **not** our offline bar |

**Recommendation:**  

1. **P0:** ExecuTorch Whisper Tiny **or** whisper.rn **tiny.en / base.en** — ship downloadable weights, not in IPA if possible.  
2. **P1:** whisper.rn **base.en** or **small.en** if WER hurts van noise.  
3. Keep a thin `SpeechToText` port so we can swap runtimes.

### 4.3 Model size guidance (Whisper family)

| Model | Ballpark size (quantized) | Mobile fit |
|-------|---------------------------|------------|
| **tiny / tiny.en** | ~40–75 MB | Fastest; OK for clear cab speech |
| **base / base.en** | ~75–150 MB | **Best default** balance |
| **small** | ~200–500 MB | Better noise; heavier |
| medium+ | usually too heavy for always-on mobile | Skip for v1 |

Road noise, AC, kids: prefer **base.en** after dogfood if tiny fails.

### 4.4 UX for STT

| State | UI |
|-------|-----|
| Model not downloaded | Settings: “Download voice (~120 MB)” before trip |
| Ready | Mic enabled on command strip |
| Listening | Waveform + “Release to send” |
| Transcribing | Spinner on strip; plan body stays visible |
| Low confidence | Show transcript editable before run co-pilot |
| Error | “Couldn’t hear — type instead” |

**Never** block the plan canvas on STT failure — typed input always works.

### 4.5 Audio pipeline notes

- Sample rate / format per whisper.rn or ExecuTorch docs  
- **VAD** (voice activity) to avoid sending pure road noise  
- Max utterance length (e.g. 30–60 s) then force finalize  
- Optional: store last audio **locally only** for “retry transcribe” (user delete)  
- Permissions: mic usage string already in app.config direction  

### 4.6 Safety

- Default: **mic primary only when motion mode = stopped** (or passenger toggle)  
- In motion: mic optional for **short notes** queued until stopped, not full replan  

---

## 5. From transcript to plan (co-pilot)

Unchanged contract from co-pilot design, but **input is usually voice**:

```ts
interface CommandSteerInput {
  transcript: string;          // from Whisper
  source: "voice" | "typed";
  lat?: number;
  lng?: number;
  tripId: string;
  sessionId?: string;          // planning session if multi-party
}

interface CommandSteerResult {
  transcript: string;
  moveType: string;
  reply: string;                 // short; shown in strip
  options: PlanOption[];         // shown on canvas
  recommendedOptionId?: string;
  draft?: DayPlanDraft[];
  sources: Array<"rules" | "slm" | "tools">;
}
```

**Tools** read **SQLite** (POIs, legs, brief, anchors) — this is why the world model pack is mandatory for “generate a plan” offline.

**Generate a plan** means:

1. Produce / update **PlanOption**(s)  
2. Optionally write a **draft** night layout  
3. User **Apply** → days commit  

Not: freeform multi-page essay with no structured nights.

---

## 6. Multi-party without making chat primary

| Action | Where it lives |
|--------|----------------|
| Speak preference | Command strip → session move |
| See disagreement | Stance marks **on option cards** |
| Read long back-and-forth | Expand session pane (aside) |
| Social chatter | **Trip Chat** tab |
| Lock plan | Apply on canvas (role-gated) |

Co-pilot facilitation still uses the collaborative design (stances, policy) but **renders onto the command surface**.

---

## 7. Model download matrix (Settings → Trip intelligence)

| Asset | Size order | Required for |
|-------|------------|--------------|
| Co-pilot **data pack** (POI/legs/brief) | 5–40 MB | Offline place/drive truth |
| **Whisper** tiny/base | ~50–150 MB | Offline voice |
| **SLM** (optional) | ~1–2 GB | Natural language quality |
| Rules engine | in app binary | Always |

Download order on “Prepare trip offline”:

1. Data pack (always)  
2. Whisper (if voice enabled)  
3. SLM (optional toggle)

---

## 8. Phased delivery (reframed)

### P0 — Command surface + typed steer (no voice yet)

- Active trip opens **Command Surface** as primary  
- Tonight + next nights + option cards  
- Typed co-pilot strip → rules → options → Apply  
- Trip Chat demoted to tab  

**Exit:** Can run Tracy / Zion / Bryce / GJ flow without opening chat as home.

### P1 — Offline Whisper

- whisper.rn **or** ExecuTorch Whisper Tiny/Base download  
- Hold-to-talk on strip when stopped  
- Transcript → same steer pipeline  
- Airplane mode dogfood  

**Exit:** Full voice → options → apply offline with data pack.

### P2 — SQLite world pack at scale

- Corridor POI export/ingest (schema doc)  
- Costco / laundry / camps in tools  

### P3 — On-device SLM + multi-party stances on cards

- Better narration  
- Partner stances on options  
- Optional chat mirror of decisions  

---

## 9. Success criteria

1. Cold start active trip → **Command Surface**, not chat.  
2. Hold mic offline → transcript → option cards on canvas with **real** drive hours / POIs from pack.  
3. Apply updates night strip without visiting chat.  
4. Trip Chat still works for asides; decision **may** post a one-liner.  
5. Moving: no forced planning mic; plan remains glanceable.  

---

## 10. Open decisions

| # | Topic | Recommendation |
|---|--------|----------------|
| V1 | whisper.rn vs ExecuTorch first | Spike both on device; pick by WER + Expo friction |
| V2 | Bundle tiny.en in app vs download | **Download** after install / before trip |
| V3 | Streaming partial transcripts | Nice-to-have; batch finalize OK for v1 |
| V4 | Passenger always-on mic | Explicit toggle; default off while moving |

---

## 11. Doc graph (updated)

```
command-surface-voice-pipeline.md   ← YOU ARE HERE (primary UI + STT)
        │
        ├── conversational-collaborative-planning.md  (moves, multi-party — still valid, UI role demoted)
        ├── trip-copilot-on-device.md                  (tools, SLM, packs)
        ├── trip-copilot-sqlite-schema.md              (POI DB)
        └── today-command-and-replan.md                 (execution apply)
```

---

## 12. Summary

| Old framing | New framing |
|-------------|-------------|
| Chat-first co-pilot | **Command surface first** |
| Trip Chat as main product | Trip Chat as **aside / bus** |
| Type to plan | **Voice-first** when stopped, type fallback |
| Cloud STT | **Offline Whisper** (whisper.cpp / ExecuTorch) |
| Model invents itinerary | **SQLite world + legs** generate structured options; model narrates |

> **Primary real estate = the living plan. Mic in, options on the board, Apply to lock — fully offline with Whisper + data pack.**

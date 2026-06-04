# Texted Invites & In-App Chat — Design

**Date:** 2026-06-04
**Status:** Validated (brainstorming), ready for implementation planning
**Driver:** Upcoming Omaha road trip — Phase 1a must ship before then.

## Problem

Two related but distinct jobs:
1. **Onboarding friction** — invites are email-only today (`trips.ts:605` per-person email+token). Family/friends don't check email, so trips stall before everyone's in.
2. **Communication sprawl** — trip chatter lives in WhatsApp/group texts, disconnected from trip context (pins, polls, expenses).

**Decision: phased.** SMS invite now (wedge), in-app chat later (bigger bet).

## Current-state facts (from system map, 2026-06-04)

- **Invites** = email only. Token invite → magic-link → accept at `/invite/[token]`.
- **`@sortey/notifications`** = push only (`registerPushToken`/`unregisterPushToken`). No SMS/RCS/Twilio.
- **`@sortey/realtime`** = an **in-memory event-log stub** (`triggerEvent` into a `Map`). The "Pusher" architecture decision was never implemented. No message/chat table exists.
- Hierarchy: `Workspace ⊃ Trip ⊃ Segment`. Authz via `protectedProcedure → workspaceProcedure → tripProcedure` chain in `packages/api/src/auth/guards.ts`.
- `/join` and `/invite` pages render via runtime SSR (good for OG tags).

---

## Phase 1a — Device-sent texted invite (SHIP BEFORE OMAHA)

### Reality check that shaped this
- **App-sent SMS (Twilio)** requires **A2P 10DLC** brand+campaign registration (days–weeks) + number + per-msg cost.
- **RCS Business Messaging** requires a verified RBM agent (weeks of Google/carrier approval).
- Neither makes the deadline. **Device-sent** (open the inviter's own Messages app) ships in a day, costs nothing, sends from a trusted human, and gets a rich preview card for free via OG tags.

### Data model (zero new tables)
Add three nullable columns to the existing `trip` row:
- `shareInviteToken` (random URL-safe id, nullable)
- `shareInviteCreatedAt`
- `shareInviteEnabled` (boolean, default true)

**Roster is not new data** — it's the existing `tripMembers` list + each member's `joinedAt`. "Who's in" = members; "Bob hasn't joined" = Bob isn't a member yet.

### tRPC procedures (`trips.ts`)
- `getShareLink` (tripProcedure) — returns active token/URL, lazily generating on first call
- `regenerateShareLink` (tripProcedure) — rotates token, old links die
- `setShareLinkEnabled` (tripProcedure) — kill switch
- `joinByShareToken` (**protectedProcedure** — joiner is not yet a member; the token IS the authorization) — validates token + `enabled` + trip not `completed`, adds caller to `tripMembers` (idempotent), returns trip.

> **Authz nuance:** `joinByShareToken` is the single deliberate exception to the `tripProcedure` membership gate. Highest-scrutiny code. High-entropy token, revocable, rate-limited.

### Send UX
- **Mobile (Expo):** native `Share.share({ message, url })` → OS share sheet → inviter picks Messages/WhatsApp/AirDrop. No Twilio.
- **Web:** Copy link + QR code (for showing a phone in the room) + an `sms:?&body=` anchor.
- **Prefilled message:** "You're invited to our Omaha trip on Sortey 🚗 Tap to join: https://sortey.app/join/<token>"

### Free "RCS-looking" rich card
`/join/[token]` SSR page gets Open Graph + iMessage meta tags:
- `og:title`, `og:description` (dates + who's going)
- dynamic `og:image` — branded card with trip name, date range, tiny **Static Maps** route image (uses the browser Maps key)

iMessage/RCS/WhatsApp auto-expand it into a rich preview. No RCS Business Messaging needed.

### Join flow (`/join/[token]`)
1. Public SSR page (token-only, not behind trip guard) renders OG card + CTA.
2. Signed out → auth (magic-link/social) with `callbackURL=/join/[token]`.
3. Signed in → `joinByShareToken` → added to `tripMembers`.
4. Redirect into trip.

### Edge cases
- **Already a member** → idempotent, redirect in, no error.
- **Disabled/regenerated token** → "This invite link is no longer active."
- **Completed trip** → block with clear message.
- **Workspace boundary** → joiner is **auto-added to the parent Workspace as `member`** (no guest role in v1; revisit if guest isolation is needed). Touches `Workspace ⊃ Trip` authz — review carefully.
- **Abuse** → rate-limit `joinByShareToken`.

### YAGNI cuts (1a)
No phone-number capture, no contact picker, no batch send (share sheet handles multi-recipient).

---

## Phase 1b — Twilio app-sent (AFTER Omaha)

Start **A2P 10DLC registration now** — it's the long pole.

- Add an SMS channel to `@sortey/notifications` (Twilio).
- Reuse 1a's link; add a *server* send path + **per-recipient tracked invite rows** (the model not chosen for 1a) to support "remind Bob who hasn't joined."
- 1a's reusable link and 1b's tracked invites **coexist**: link for humans, tracked rows for automation. Nothing in 1a blocks this.

---

## Phase 2 — In-app group chat (THE BIG BET)

- **Blocker:** `@sortey/realtime` is a stub. Step 1 = make realtime real. Candidates: Pusher (per the old decision), Ably, or **Cloudflare Durable Objects** (attractive — already all-in on Workers).
- `messages` table scoped to `tripId`/`segmentId`; `chat.ts` router; web + Expo chat UI; push via existing `registerPushToken` plumbing.
- **Wedge that beats WhatsApp:** **context-linked messages** — reply to a Pin / Poll / Expense inline (e.g. "settle up?" threads off the expense). That's the reason to pull chat out of the group text.

---

## Recommended sequence

1. **Phase 1a** (device-sent invite) — before Omaha.
2. **A2P 10DLC paperwork** — start in parallel now.
3. **Phase 1b** (Twilio automated invites/reminders).
4. **Phase 2** (realtime + context-linked chat).

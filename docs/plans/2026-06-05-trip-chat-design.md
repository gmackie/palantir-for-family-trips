# Phase 2 — In-App Group Chat — Design

**Date:** 2026-06-05
**Status:** Validated (brainstorming), ready for implementation planning
**Design source / context:** `docs/plans/2026-06-04-texted-invites-and-chat-design.md` (the Phase 2 sketch)

## Decisions locked (brainstorm)

1. **Transport: Cloudflare Durable Objects + WebSockets.** Native to Workers, no vendor, no monthly fee, lowest latency. One `TripRoom` DO per trip, using **hibernatable WebSockets** (idle rooms cost nothing).
2. **Channel granularity: one room per trip** (`#general`). Granularity later comes from context-linking a message to a pin/poll/expense, not separate rooms.
3. **v1 scope: foundation realtime chat + presence/typing.** Context-linking (attach a Pin/Poll/Expense) is the **v1.5 fast-follow** — the schema already includes nullable hooks so v1.5 needs no migration.

## Core principle

**The DO is only a fan-out + presence hub — NOT the source of truth. Postgres is.** Persist first, broadcast second. This keeps message durability in the normal, testable tRPC/Postgres path and makes the DO trivial and crash-safe.

## Data flow

**Send (client → everyone):**
1. Client calls tRPC `chat.send({ tripId, body })` (HTTP, behind `tripProcedure` → membership enforced).
2. Mutation inserts into `tripMessages` (Postgres), then calls the trip's DO `POST /broadcast` with the persisted row.
3. DO broadcasts to every live WebSocket for that trip.
4. Mutation fires existing Expo push (`sendPushToTripMembers`, excluding sender) → offline reach, deep-link `{ tripId, screen: "chat" }`.

**Receive (live):** client opens a WS to `/api/chat/<tripId>/ws`. Worker validates the better-auth session cookie + trip membership, then forwards the Upgrade to the trip's DO, which registers the socket (hibernation) and streams new messages + presence/typing.

**History:** `chat.history({ tripId, before?, limit })` tRPC query, paginated newest-first from Postgres. Used on open + scroll-up + every reconnect. The WS carries only *new* events.

**Presence/typing:** ephemeral, DO-only, never persisted. Client sends `typing`/`heartbeat` frames; DO tracks connected userIds and broadcasts the roster + typing dots.

> Postgres = durable truth · tRPC = send/history · DO = live fan-out + presence · push = offline reach.

## Data model

New table in `packages/db/src/schema.ts` (mirrors `tripMembers` style):

```ts
export const tripMessages = pgTable("trip_message", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  tripId: t.uuid().notNull().references(() => trips.id, { onDelete: "cascade" }),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  body: t.varchar({ length: 4000 }).notNull(),
  // v1.5 context-linking hooks — nullable now, unused until then:
  contextType: t.text().$type<"pin" | "poll" | "expense" | "segment">(),
  contextId: t.uuid(),
  createdAt: t.timestamp({ mode: "date", withTimezone: true }).defaultNow().notNull(),
  editedAt: t.timestamp({ mode: "date", withTimezone: true }),
  deletedAt: t.timestamp({ mode: "date", withTimezone: true }), // soft delete
}), (table) => [
  index("trip_message_trip_created_idx").on(table.tripId, table.createdAt),
]);
```

- `tripId` not `segmentId` (one room per trip). `contextType`/`contextId` are nullable v1.5 hooks → **no migration for v1.5**.
- Soft delete (`deletedAt`) so deletions render + broadcast without losing the row.
- `(tripId, createdAt)` index drives paginated history.
- `body` capped 4000 chars (validated in tRPC input too).
- DO persists **nothing durable** — only in-memory (hibernation-restorable) `Map<WebSocket, {userId,name}>` for presence.

## Transport & API surface

**1. WS route (worker-level, before vinext)** in `apps/nextjs/worker/index.ts`:
```
if (pathname.startsWith("/api/chat/") && pathname.endsWith("/ws")) {
  // 1. validate better-auth session cookie -> userId (401)
  // 2. verify trip membership (403)
  // 3. forward Upgrade to env.TRIP_ROOM.get(idFromName(tripId))
}
```
Everything else falls through to the existing vinext handler untouched.

**2. `TripRoom` DO** (`apps/nextjs/worker/trip-room.ts`):
- `fetch()` → WS upgrade via hibernatable `state.acceptWebSocket(ws)`, tag socket with userId.
- `webSocketMessage()` → handle `typing`/`heartbeat` only (clients never send chat over WS).
- internal `POST /broadcast` → fan a persisted message to all live sockets (called by the tRPC mutation).
- `webSocketClose()` → update presence, broadcast roster.
- `wrangler.jsonc` → `durable_objects` binding `TRIP_ROOM` + `new_sqlite_classes` migration.

**3. tRPC `chat` router** (`packages/api/src/router/chat.ts`, store-abstraction pattern per Phase 1a's override note):
- `send({ tripId, body })` — `tripProcedure`; insert → DO `/broadcast` → offline push; returns the row.
- `history({ tripId, before?, limit })` — `tripProcedure`; paginated newest-first.
- `delete({ messageId })` — soft-delete (author or organizer), broadcasts delete event.

**Auth seam:** the WS upgrade re-validates session + membership at the worker before reaching the DO. DOs aren't directly reachable; the DO trusts the worker.

## Client UI + push

**Shared hook** (rewrite the dead `@sortey/realtime` stub): `useTripChat(tripId)` →
- opens WS, auto-reconnect w/ backoff, backfills via `chat.history` on every (re)connect (no message lost on blips);
- exposes `{ messages, send, presence, typing, sendTyping }`; `send` calls the tRPC mutation, the new row returns via WS broadcast (optimistic-append, reconcile by id);
- merges history + live by `id` (dedupe), sorted by `createdAt`.

**Web:** `apps/nextjs/src/app/trips/[tripId]/chat/` — `page.tsx` + `_components/chat-panel.tsx` (message list, composer, presence avatars, typing dots; Palantir aesthetic, monospace timestamps). Add "Chat" to the trip nav.

**Mobile:** `apps/expo/src/app/trip/[tripId]/chat.tsx` — RN `WebSocket` via the same hook; inverted FlatList + composer + keyboard handling.

**Push:** v1 keeps it simple — `chat.send` pushes everyone but the sender, deep-link `screen: "chat"`. (Optimization later: DO returns connected-userIds so we only push the truly offline.)

## Edge cases

- **DO/Postgres divergence:** never — persist first, broadcast best-effort. Failed broadcast still shows on next history/reconnect.
- **Reconnect/dropped frames:** client backfills via `history` keyed by last-seen id.
- **Auth expiry mid-session:** DO drops sockets past session TTL; client re-handshakes (re-validates cookie).
- **Non-member/revoked:** worker rejects upgrade (403); removed member dropped on next heartbeat.
- **Abuse:** body length cap + per-user rate-limit (`// TODO(ratelimit)` like Phase 1a); soft-delete for moderation.
- **Empty/edited:** trim + reject empty; `editedAt` broadcasts an edit event.

## Testing

- tRPC `chat.send`/`history`/`delete` → store-pattern unit tests with in-memory store (no DB), per Phase 1a.
- `TripRoom` DO → `@cloudflare/vitest-pool-workers`: two sockets, broadcast, assert both receive; presence add/remove; hibernation wake.
- Client hook → backfill-merge dedupe logic unit-tested.

## Out of v1 scope

Context-linking (v1.5 — columns already present), per-segment channels, reactions/threads/read-receipts, image/file messages, search, edit UI (delete only).

## Build dependency note

This requires the first **Durable Object** in the codebase (`wrangler.jsonc` migration + `@cloudflare/vitest-pool-workers` for DO tests). The `@sortey/realtime` package (currently a dead in-memory stub) gets repurposed as the client `useTripChat` hook home.

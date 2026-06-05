# Phase 2 — In-App Group Chat — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Realtime per-trip group chat (one room per trip) over Cloudflare Durable Objects + WebSockets, with Postgres as the source of truth, presence/typing, and push for offline members.

**Architecture:** The DO (`TripRoom`, one per trip) is a fan-out + presence hub only — **Postgres is the source of truth**. Send = tRPC mutation (persist → DO broadcast → offline push). Receive = WebSocket from the DO. History = paginated tRPC query. See `docs/plans/2026-06-05-trip-chat-design.md`.

**Tech Stack:** Cloudflare Durable Objects (hibernatable WebSockets), Workers (vinext custom entry at `apps/nextjs/worker/index.ts`), Drizzle, tRPC v11, better-auth (cookie session), Next.js + Expo, Vitest + `@cloudflare/vitest-pool-workers` for DO tests.

**Before starting:** isolated worktree per `superpowers:using-git-worktrees` (preferred `~/.config/superpowers/worktrees/sortey/`), branch `feat/trip-chat`. Copy the gitignored `.env` from the main checkout into the worktree, then `pnpm install`.

**Conventions to match (read first):**
- Store-abstraction pattern for the tRPC router — see the **"⚠️ IMPLEMENTATION PATTERN"** note in `docs/plans/2026-06-04-phase1a-texted-invites.md` (extend `TripStore`-style interface + drizzle factory + standalone logic fn + thin procedure + in-memory test). The `chat` router uses the same shape.
- Schema style: `packages/db/src/schema.ts` (`tripMembers` L218, `tripMessages` goes near it).
- Worker entry: `apps/nextjs/worker/index.ts` — `instrumentedFetch` ends with `return handler.fetch(request, env, ctx)`; the default export is `{ scheduled, fetch: instrumentedFetch }`. The DO class must be **exported from this module** and the WS branch added before the final `handler.fetch`.
- Server session: `apps/nextjs/src/auth/server.ts` (`getSession`/`auth.api`).
- Push: `sendPushToTripMembers` in `packages/api/src/notifications/send.ts`.
- Trip nav: `apps/nextjs/src/app/trips/[tripId]/_components/nav-rail.tsx`.

---

## Task 1: Schema — `tripMessages` table

**Files:** Modify `packages/db/src/schema.ts` (after `tripInvites`, ~L322).

**Step 1:** Add (import `index` from drizzle pg-core if not already imported):
```ts
export const tripMessages = pgTable("trip_message", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  tripId: t.uuid().notNull().references(() => trips.id, { onDelete: "cascade" }),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  body: t.varchar({ length: 4000 }).notNull(),
  contextType: t.text().$type<"pin" | "poll" | "expense" | "segment">(),
  contextId: t.uuid(),
  createdAt: t.timestamp({ mode: "date", withTimezone: true }).defaultNow().notNull(),
  editedAt: t.timestamp({ mode: "date", withTimezone: true }),
  deletedAt: t.timestamp({ mode: "date", withTimezone: true }),
}), (table) => [
  index("trip_message_trip_created_idx").on(table.tripId, table.createdAt),
]);
```
**Step 2:** `pnpm -F @sortey/db build && pnpm -F @sortey/db typecheck` → clean. (DB `push` is a **deploy-time** step — do NOT push to the live DB during dev; the table is additive. Note it for the deploy checklist.)
**Step 3:** Commit `feat(db): add trip_message table for group chat`.

---

## Task 2: tRPC `chat` router — `send` / `history` / `delete`

Store-abstraction pattern. The DO broadcast + push are **side effects in the thin procedure**, so the logic fns stay DB/IO-free and unit-testable.

**Files:** Create `packages/api/src/router/chat.ts`; register it in `packages/api/src/root.ts`; test `packages/api/src/router/__tests__/chat.test.ts`.

**Store interface** (drizzle factory + in-memory mock):
- `insertMessage({ tripId, userId, body }) → MessageRow`
- `listMessages({ tripId, before?, limit }) → MessageRow[]` (newest-first, `deletedAt IS NULL` returns body; deleted rows return a tombstone)
- `softDeleteMessage({ messageId, userId, isOrganizer }) → MessageRow | null` (author or organizer only)

**Logic fns (exported, DB/IO-free):** `sendMessage(store, {...})` (validate body: trim, 1..4000), `getHistory(store, {...})`, `deleteMessage(store, {...})`.

**Procedures (thin):**
- `send` — `tripProcedure`, input `{ workspaceId, tripId, body }`. Calls `sendMessage(...)`, then `broadcastToTripRoom(ctx, tripId, msg)` (a helper that does the DO fetch — see Task 4 for the env access; in tests this is not exercised), then `sendPushToTripMembers(ctx.db, { tripId, excludeUserId, title: senderName, body: preview, data: { tripId, screen: "chat" } })`. `// TODO(ratelimit)`.
- `history` — `tripProcedure`, input `{ workspaceId, tripId, before?, limit (max 50) }`.
- `delete` — `tripProcedure`, input `{ workspaceId, tripId, messageId }` → soft delete + broadcast a `{ type: "delete", id }` event.

**TDD** (`chat.test.ts`, in-memory store): send persists + returns row; body trimmed; empty/4001-char rejected; history paginates newest-first with `before`; delete by author works, by non-author/non-organizer rejected, deleted message returns tombstone in history.

**Verify:** `pnpm -F @sortey/api test chat`, `pnpm -F @sortey/api typecheck`. Commit `feat(api): chat router (send/history/delete)`.

---

## Task 3: `TripRoom` Durable Object + wrangler config + DO tests

**THE NOVEL/RISKY PART — do this before the worker route so the DO is proven deployable in isolation.**

**Files:** Create `apps/nextjs/worker/trip-room.ts`; modify `apps/nextjs/worker/index.ts` (export the class); modify `apps/nextjs/wrangler.jsonc`; test `apps/nextjs/worker/__tests__/trip-room.test.ts`; add `@cloudflare/vitest-pool-workers` dev config.

**`TripRoom` DO:**
```ts
export class TripRoom {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/broadcast") { /* POST: parse msg, broadcast to all sockets, 200 */ }
    // else: WS upgrade
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const userId = req.headers.get("x-user-id")!;       // trusted: set by the worker after auth
    const name = req.headers.get("x-user-name") ?? "";
    this.state.acceptWebSocket(server, [userId]);         // hibernation; tag = userId
    server.serializeAttachment({ userId, name });
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, raw) { /* JSON: {type:"typing"} | {type:"heartbeat"} -> presence/typing broadcast. Ignore anything else. */ }
  webSocketClose(ws) { this.broadcastPresence(); }
  // broadcast(msg): for (const ws of this.state.getWebSockets()) ws.send(JSON.stringify(msg))
  // broadcastPresence(): collect distinct userIds from getWebSockets() attachments, send {type:"presence", users}
}
```
Use the **hibernation API** (`acceptWebSocket`/`getWebSockets`/`webSocketMessage` handlers), not `addEventListener`.

**`worker/index.ts`:** add `export { TripRoom } from "./trip-room";`.

**`wrangler.jsonc`:** add
```jsonc
"durable_objects": { "bindings": [{ "name": "TRIP_ROOM", "class_name": "TripRoom" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["TripRoom"] }]
```
Add `TRIP_ROOM: DurableObjectNamespace` to the worker `Env` interface.

**DO tests** (`@cloudflare/vitest-pool-workers`): open two WS to one DO instance, POST `/broadcast`, assert both receive the message; open/close updates presence; a `typing` frame fans out. (Add the pool-workers vitest config per its docs; this is the first DO test in the repo.)

**Verify:** DO tests pass; `pnpm -F @sortey/nextjs typecheck` clean. Commit `feat(worker): TripRoom durable object + wrangler binding`.

> If `@cloudflare/vitest-pool-workers` setup proves heavy, fall back to testing the DO's pure helpers (presence dedupe, message serialization) as plain unit tests and cover the socket lifecycle in the Task 8 manual/integration pass — but PREFER the real DO harness.

---

## Task 4: Worker WebSocket route (auth + membership → DO)

**Files:** Modify `apps/nextjs/worker/index.ts` (branch inside `instrumentedFetch`, before `return handler.fetch(...)`).

```ts
const url = new URL(request.url);
if (url.pathname.startsWith("/api/chat/") && url.pathname.endsWith("/ws")) {
  const tripId = url.pathname.split("/")[3];
  if (request.headers.get("Upgrade") !== "websocket") return new Response("expected ws", { status: 426 });
  // 1. validate session from the cookie -> userId (use auth.api.getSession with request headers). 401 if none.
  // 2. verify trip membership: a lightweight query (trip_member where trip_id=? and user_id=?). 403 if not a member.
  // 3. forward to the DO, attaching identity headers it can trust:
  const id = env.TRIP_ROOM.idFromName(tripId);
  const stub = env.TRIP_ROOM.get(id);
  const fwd = new Request(request, { headers: { ...request.headers, "x-user-id": userId, "x-user-name": name } });
  return stub.fetch(fwd);
}
```
Notes: session validation in the Workers runtime must use the request cookies (better-auth `auth.api.getSession({ headers: request.headers })`). The membership check needs a DB handle — reuse the same Hyperdrive/`runWithDatabaseRuntime` path the app already uses (see top of `worker/index.ts`). Keep the query tiny.

**Also add `broadcastToTripRoom`** (used by Task 2's `send`/`delete`): a helper that does `env.TRIP_ROOM.get(idFromName(tripId)).fetch("https://do/broadcast", { method: "POST", body: JSON.stringify(msg) })`. The tRPC context needs access to `env` — wire the DO namespace into the tRPC context (`createTRPCContext`) or pass via a server-only binding accessor. Document how `env` reaches the mutation (this is the one integration seam to get right).

**Verify:** typecheck clean; can't fully e2e without deploy — covered in Task 8. Commit `feat(worker): authenticated chat WS route -> TripRoom`.

---

## Task 5: `useTripChat` hook (repurpose `@sortey/realtime`)

**Files:** Replace `packages/realtime/src/index.ts` stub with the client hook + a pure `mergeMessages` util; test `packages/realtime/src/__tests__/merge.test.ts`.

- `mergeMessages(history, live)` — dedupe by `id`, sort by `createdAt`, apply tombstones. **Pure → unit-tested.**
- `useTripChat(tripId)` — opens `new WebSocket(\`${wsBase}/api/chat/${tripId}/ws\`)`, reconnect w/ exponential backoff, on (re)connect call `chat.history` (via the passed tRPC client) and merge; exposes `{ messages, send, presence, typing, sendTyping }`. `send` calls the `chat.send` mutation (optimistic append; reconcile when the broadcast echoes back by id).

**TDD:** `merge.test.ts` covers dedupe, ordering, tombstone, and history+live overlap. (The socket lifecycle is integration-tested in Task 8.)

**Verify:** `pnpm -F @sortey/realtime test`, typecheck. Commit `feat(realtime): useTripChat hook + message merge`.

---

## Task 6: Web chat UI

**Files:** Create `apps/nextjs/src/app/trips/[tripId]/chat/page.tsx` + `_components/chat-panel.tsx`; modify `apps/nextjs/src/app/trips/[tripId]/_components/nav-rail.tsx` (add "Chat").

- `chat-panel.tsx` (client): `useTripChat(tripId)` → message list (sender, monospace timestamp, body; tombstone for deleted), composer (Enter to send, Shift+Enter newline), presence avatars ("N online"), typing dots. Palantir/dashboard aesthetic; reuse `@sortey/ui`.
- `page.tsx`: server shell that renders `<ChatPanel workspaceId tripId currentUserId />`.
- Add a "Chat" item to `nav-rail.tsx` matching the existing nav entries.

**Verify:** `pnpm -F @sortey/nextjs typecheck` + `lint` clean. (Runtime/browser verification in Task 8.) Commit `feat(web): trip chat panel + nav entry`.

---

## Task 7: Mobile chat screen

**Files:** Create `apps/expo/src/app/trip/[tripId]/chat.tsx`; add a nav/route entry where the other trip screens are linked.

- RN `WebSocket` via the same `useTripChat` pattern (the hook should be RN-compatible — both use the global `WebSocket`; isolate any web-only bits). Inverted `FlatList`, composer, `KeyboardAvoidingView`. Match existing expo screen style (see `apps/expo/src/app/trip/[tripId]/members.tsx`).

**Verify:** `pnpm -F @sortey/expo typecheck` clean. (No simulator runtime check — note it.) Commit `feat(mobile): trip chat screen`.

---

## Task 8: Integration, final review, deploy checklist

**Step 1:** Aggregate — `pnpm -F @sortey/api test`, `pnpm -F @sortey/realtime test`, DO tests; typecheck api/db/nextjs/expo/realtime; lint.
**Step 2:** Final code review (security: WS auth + membership at the worker, the DO trusts only worker-set `x-user-id`; abuse/ratelimit; soft-delete authz).
**Step 3:** Finish via `superpowers:finishing-a-development-branch` (merge → push).
**Step 4 — DEPLOY CHECKLIST (the new infra):**
- `pnpm db:push` (or surgical `CREATE TABLE`) for `trip_message` on the live DB **before** deploy.
- Deploy with `pnpm deploy:cloudflare:production` — the wrangler `migrations` block creates the DO on first deploy. **Verify the DO migration applies** (wrangler output names `TRIP_ROOM`).
- Smoke: open chat in two browsers on the same trip, confirm live delivery; confirm offline push; confirm history backfill on reload.

---

## Out of v1 scope (do NOT build)
Context-linking (v1.5 — `contextType`/`contextId` columns already exist), per-segment channels, reactions/threads/read-receipts, image/file messages, search, edit UI (delete only).

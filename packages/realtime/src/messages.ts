// Pure, dependency-free message-merge logic for the trip-chat hook.
//
// The `useTripChat` hook keeps a single ordered list of messages assembled from
// two sources that can overlap arbitrarily:
//   - history backfill (paginated `chat.history` tRPC query, re-run on every
//     (re)connect so a dropped socket never loses a message), and
//   - live WebSocket frames broadcast by the `TripRoom` Durable Object.
//
// Both can deliver the same message id (e.g. an optimistic local send, the
// history backfill, and the live `{type:"message"}` echo are all the same row).
// They can also deliver a delete tombstone (`{type:"delete", id}`) for a message
// we may or may not have seen yet. `mergeMessages` reconciles all of this into a
// single deduped, time-ordered list, and is written so the hook can call it
// incrementally — `mergeMessages(existing, [oneNewThing])` — on every frame.

/**
 * A chat message as seen by the client. Mirrors the server `MessageRow` shape
 * (`packages/api/src/router/chat.ts`) but with `createdAt` typed as
 * `string | number | Date`: over the WebSocket / JSON wire a `Date` arrives as
 * an ISO string, while the in-process tRPC client may hand back a real `Date`.
 * Comparison is done on the parsed time so all three are handled.
 */
export interface ChatMessage {
  id: string;
  tripId: string;
  userId: string;
  body: string;
  createdAt: string | number | Date;
  editedAt?: string | number | Date | null;
  deletedAt?: string | number | Date | null;
}

/** A delete tombstone broadcast by the DO when a message is soft-deleted. */
export interface DeleteTombstone {
  type: "delete";
  id: string;
}

/** An item that can be merged in: either a full message or a delete tombstone. */
export type MergeItem = ChatMessage | DeleteTombstone;

function isTombstone(item: MergeItem): item is DeleteTombstone {
  return (item as DeleteTombstone).type === "delete";
}

/**
 * Coerce any of the accepted `createdAt` representations to epoch millis for a
 * deterministic ordering. Unparseable values sort as `0` (oldest) so a single
 * malformed timestamp can never throw or reorder the rest unpredictably.
 */
function toTime(value: string | number | Date | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Apply a delete tombstone to a known message: mark it deleted and blank the
 * body (the server already blanks deleted bodies, but a live `delete` frame
 * carries only the id, so we blank locally too so the UI renders a placeholder).
 * Returns a new object — never mutates the input.
 */
function applyTombstone(message: ChatMessage): ChatMessage {
  return { ...message, body: "", deletedAt: message.deletedAt ?? Date.now() };
}

/**
 * Merge `history` and `live` into one deduped, ascending-by-`createdAt` list.
 *
 * Semantics:
 *  - **Dedupe by `id`.** When the same id appears more than once, later items
 *    win (so a live echo or a fresher backfill supersedes an earlier/optimistic
 *    copy). Within a single call, items are processed `history` first then
 *    `live`, so `live` wins ties — matching the hook's "reconcile by id when the
 *    broadcast echoes back" requirement.
 *  - **Tombstones.** A `{type:"delete", id}` marks that id deleted: if the
 *    message is already known it is blanked in place; if it arrives before the
 *    message, the deletion is remembered and applied when the message shows up.
 *    A message that is itself already a tombstone (`deletedAt` set, blank body)
 *    is treated the same way.
 *  - **Ordering.** Ascending by parsed `createdAt`; ties are broken by `id` for
 *    a stable, deterministic order regardless of input order.
 *
 * Pure and deterministic: the inputs are never mutated and the output depends
 * only on the arguments. Designed for incremental use:
 * `mergeMessages(existing, [newMsgOrTombstone])`.
 */
export function mergeMessages(
  history: readonly MergeItem[],
  live: readonly MergeItem[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const deleted = new Set<string>();

  for (const item of [...history, ...live]) {
    if (isTombstone(item)) {
      deleted.add(item.id);
      const existing = byId.get(item.id);
      if (existing) byId.set(item.id, applyTombstone(existing));
      continue;
    }

    // A full message. If it's already flagged deleted (by an earlier tombstone),
    // or carries its own deletion, store the tombstoned form.
    const isDeleted = deleted.has(item.id) || item.deletedAt != null;
    byId.set(item.id, isDeleted ? applyTombstone(item) : { ...item });
  }

  return [...byId.values()].sort((a, b) => {
    const dt = toTime(a.createdAt) - toTime(b.createdAt);
    return dt !== 0 ? dt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

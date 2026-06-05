import { describe, expect, it } from "vitest";
import type { ChatStore, MessageRow } from "../chat";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { sendMessage, getHistory, deleteMessage } = await import("../chat");

// In-memory ChatStore mock — mirrors the trips-share-link harness: an object
// literal whose methods read/write a `state.messages` array. No real DB.
function createMemoryChatStore(input?: { messages?: MessageRow[] }) {
  const state = {
    messages: [...(input?.messages ?? [])],
  };
  let seq = state.messages.length;

  const store: ChatStore = {
    insertMessage: async ({ tripId, userId, body }) => {
      seq += 1;
      const row: MessageRow = {
        id: `msg_${seq}`,
        tripId,
        userId,
        body,
        // Deterministic, strictly-increasing timestamps so newest-first
        // ordering is stable in assertions.
        createdAt: new Date(2026, 5, 5, 0, 0, seq),
        editedAt: null,
        deletedAt: null,
      };
      state.messages.push(row);
      return row;
    },
    listMessages: async ({ tripId, before, limit }) => {
      const rows = state.messages
        .filter((m) => m.tripId === tripId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const filtered = before
        ? rows.filter((m) => m.createdAt.getTime() < before.getTime())
        : rows;
      // Soft-deleted rows are returned as tombstones (body blanked, deletedAt set).
      return filtered
        .slice(0, limit)
        .map((m) => (m.deletedAt ? { ...m, body: "" } : m));
    },
    softDeleteMessage: async ({ messageId, userId, isOrganizer }) => {
      const index = state.messages.findIndex((m) => m.id === messageId);
      if (index === -1) return null;
      const row = state.messages[index]!;
      if (row.userId !== userId && !isOrganizer) return null;
      const deleted: MessageRow = { ...row, deletedAt: new Date() };
      state.messages[index] = deleted;
      return deleted;
    },
  };

  return { state, store };
}

describe("sendMessage", () => {
  it("persists and returns the inserted row", async () => {
    const { state, store } = createMemoryChatStore();

    const row = await sendMessage(store, {
      tripId: "trip_1",
      userId: "user_1",
      body: "hello world",
    });

    expect(row.id).toBeTruthy();
    expect(row.tripId).toBe("trip_1");
    expect(row.userId).toBe("user_1");
    expect(row.body).toBe("hello world");
    expect(state.messages).toHaveLength(1);
  });

  it("trims surrounding whitespace before persisting", async () => {
    const { store } = createMemoryChatStore();

    const row = await sendMessage(store, {
      tripId: "trip_1",
      userId: "user_1",
      body: "   padded message   ",
    });

    expect(row.body).toBe("padded message");
  });

  it("rejects an empty (whitespace-only) body with BAD_REQUEST", async () => {
    const { store } = createMemoryChatStore();

    await expect(
      sendMessage(store, {
        tripId: "trip_1",
        userId: "user_1",
        body: "    ",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a body longer than 4000 chars with BAD_REQUEST", async () => {
    const { store } = createMemoryChatStore();

    await expect(
      sendMessage(store, {
        tripId: "trip_1",
        userId: "user_1",
        body: "x".repeat(4001),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts a body of exactly 4000 chars", async () => {
    const { store } = createMemoryChatStore();

    const row = await sendMessage(store, {
      tripId: "trip_1",
      userId: "user_1",
      body: "x".repeat(4000),
    });

    expect(row.body).toHaveLength(4000);
  });
});

describe("getHistory", () => {
  it("returns messages newest-first", async () => {
    const { store } = createMemoryChatStore();
    await sendMessage(store, { tripId: "trip_1", userId: "u", body: "first" });
    await sendMessage(store, { tripId: "trip_1", userId: "u", body: "second" });
    await sendMessage(store, { tripId: "trip_1", userId: "u", body: "third" });

    const history = await getHistory(store, { tripId: "trip_1", limit: 50 });

    expect(history.map((m) => m.body)).toEqual(["third", "second", "first"]);
  });

  it("paginates with `before` (returns only rows older than the cursor)", async () => {
    const { store } = createMemoryChatStore();
    const a = await sendMessage(store, {
      tripId: "trip_1",
      userId: "u",
      body: "a",
    });
    await sendMessage(store, { tripId: "trip_1", userId: "u", body: "b" });
    const c = await sendMessage(store, {
      tripId: "trip_1",
      userId: "u",
      body: "c",
    });

    // Everything strictly older than the newest message `c`.
    const page = await getHistory(store, {
      tripId: "trip_1",
      before: c.createdAt,
      limit: 50,
    });

    expect(page.map((m) => m.body)).toEqual(["b", "a"]);
    expect(page.some((m) => m.id === a.id)).toBe(true);
    expect(page.some((m) => m.id === c.id)).toBe(false);
  });

  it("clamps the limit to a maximum of 50", async () => {
    const { store } = createMemoryChatStore();
    for (let i = 0; i < 60; i += 1) {
      await sendMessage(store, {
        tripId: "trip_1",
        userId: "u",
        body: `m${i}`,
      });
    }

    const history = await getHistory(store, { tripId: "trip_1", limit: 1000 });

    expect(history).toHaveLength(50);
  });
});

describe("deleteMessage", () => {
  it("lets the author soft-delete their own message", async () => {
    const { store } = createMemoryChatStore();
    const row = await sendMessage(store, {
      tripId: "trip_1",
      userId: "author_1",
      body: "to be deleted",
    });

    const deleted = await deleteMessage(store, {
      messageId: row.id,
      userId: "author_1",
      isOrganizer: false,
      tripId: "trip_1",
    });

    expect(deleted.id).toBe(row.id);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it("lets an organizer soft-delete another member's message", async () => {
    const { store } = createMemoryChatStore();
    const row = await sendMessage(store, {
      tripId: "trip_1",
      userId: "author_1",
      body: "moderated",
    });

    const deleted = await deleteMessage(store, {
      messageId: row.id,
      userId: "organizer_1",
      isOrganizer: true,
      tripId: "trip_1",
    });

    expect(deleted.id).toBe(row.id);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it("rejects a non-author, non-organizer with FORBIDDEN", async () => {
    const { store } = createMemoryChatStore();
    const row = await sendMessage(store, {
      tripId: "trip_1",
      userId: "author_1",
      body: "not yours",
    });

    await expect(
      deleteMessage(store, {
        messageId: row.id,
        userId: "stranger_1",
        isOrganizer: false,
        tripId: "trip_1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND for a missing message", async () => {
    const { store } = createMemoryChatStore();

    await expect(
      deleteMessage(store, {
        messageId: "missing",
        userId: "author_1",
        isOrganizer: true,
        tripId: "trip_1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("surfaces a deleted message as a tombstone in history", async () => {
    const { store } = createMemoryChatStore();
    const keep = await sendMessage(store, {
      tripId: "trip_1",
      userId: "u",
      body: "still here",
    });
    const gone = await sendMessage(store, {
      tripId: "trip_1",
      userId: "u",
      body: "secret content",
    });

    await deleteMessage(store, {
      messageId: gone.id,
      userId: "u",
      isOrganizer: false,
      tripId: "trip_1",
    });

    const history = await getHistory(store, { tripId: "trip_1", limit: 50 });

    const tombstone = history.find((m) => m.id === gone.id);
    expect(tombstone).toBeDefined();
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);
    // The original body must NOT leak through the tombstone.
    expect(tombstone?.body).not.toBe("secret content");
    // The surviving message is unaffected.
    expect(history.find((m) => m.id === keep.id)?.body).toBe("still here");
  });
});

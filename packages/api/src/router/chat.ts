import { and, desc, eq, lt } from "@sortey/db";
import { tripMessages } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { sendPushToTripMembers } from "../notifications/send";
import { assertRateLimit } from "../rate-limit";

const MAX_BODY_LENGTH = 4000;
const MAX_HISTORY_LIMIT = 50;
const PUSH_PREVIEW_LENGTH = 80;

export type MessageRow = {
  id: string;
  tripId: string;
  userId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

export interface ChatStore {
  insertMessage(input: {
    tripId: string;
    userId: string;
    body: string;
  }): Promise<MessageRow>;
  // Newest-first. Includes soft-deleted rows, but returned as tombstones
  // (body blanked) so the original content never leaves the database.
  listMessages(input: {
    tripId: string;
    before?: Date;
    limit: number;
  }): Promise<MessageRow[]>;
  // Author or organizer only. Scoped to `tripId` so a caller can never act on a
  // message belonging to another trip. Returns a discriminated result so the
  // logic fn can map precisely to NOT_FOUND / FORBIDDEN without a second query.
  softDeleteMessage(input: {
    messageId: string;
    tripId: string;
    userId: string;
    isOrganizer: boolean;
  }): Promise<
    | { ok: true; row: MessageRow }
    | { ok: false; reason: "not_found" | "forbidden" }
  >;
}

const messageColumns = {
  id: tripMessages.id,
  tripId: tripMessages.tripId,
  userId: tripMessages.userId,
  body: tripMessages.body,
  createdAt: tripMessages.createdAt,
  editedAt: tripMessages.editedAt,
  deletedAt: tripMessages.deletedAt,
} as const;

// A deleted row is returned as a tombstone: the body is blanked so the original
// content is never sent to clients, but `deletedAt` is preserved so the UI can
// render a "message deleted" placeholder.
function toTombstone(row: MessageRow): MessageRow {
  return row.deletedAt ? { ...row, body: "" } : row;
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type is complex
export function createChatStore(db: any): ChatStore {
  return {
    insertMessage: async ({ tripId, userId, body }) => {
      const [created] = (await db
        .insert(tripMessages)
        .values({ tripId, userId, body })
        .returning(messageColumns)) as MessageRow[];

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send message.",
        });
      }

      return created;
    },
    listMessages: async ({ tripId, before, limit }) => {
      const conditions = [eq(tripMessages.tripId, tripId)];
      if (before) {
        conditions.push(lt(tripMessages.createdAt, before));
      }

      const rows = (await db
        .select(messageColumns)
        .from(tripMessages)
        .where(and(...conditions))
        .orderBy(desc(tripMessages.createdAt))
        .limit(limit)) as MessageRow[];

      return rows.map(toTombstone);
    },
    softDeleteMessage: async ({ messageId, tripId, userId, isOrganizer }) => {
      const [existing] = (await db
        .select(messageColumns)
        .from(tripMessages)
        .where(
          and(eq(tripMessages.id, messageId), eq(tripMessages.tripId, tripId)),
        )
        .limit(1)) as MessageRow[];

      if (!existing) {
        return { ok: false, reason: "not_found" };
      }

      // Only the author or a trip organizer may delete a message.
      if (existing.userId !== userId && !isOrganizer) {
        return { ok: false, reason: "forbidden" };
      }

      const [deleted] = (await db
        .update(tripMessages)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(tripMessages.id, messageId), eq(tripMessages.tripId, tripId)),
        )
        .returning(messageColumns)) as MessageRow[];

      if (!deleted) {
        return { ok: false, reason: "not_found" };
      }

      return { ok: true, row: toTombstone(deleted) };
    },
  };
}

// Standalone, DB/IO-free logic. Side effects (DO broadcast, push) live in the
// thin procedure so these stay unit-testable against an in-memory store.
export async function sendMessage(
  store: ChatStore,
  input: {
    tripId: string;
    userId: string;
    body: string;
  },
): Promise<MessageRow> {
  const body = input.body.trim();

  if (body.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Message cannot be empty.",
    });
  }

  if (body.length > MAX_BODY_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Message cannot exceed ${MAX_BODY_LENGTH} characters.`,
    });
  }

  return store.insertMessage({
    tripId: input.tripId,
    userId: input.userId,
    body,
  });
}

export async function getHistory(
  store: ChatStore,
  input: {
    tripId: string;
    before?: Date;
    limit: number;
  },
): Promise<MessageRow[]> {
  const limit = Math.min(Math.max(1, input.limit), MAX_HISTORY_LIMIT);

  return store.listMessages({
    tripId: input.tripId,
    before: input.before,
    limit,
  });
}

export async function deleteMessage(
  store: ChatStore,
  input: {
    messageId: string;
    userId: string;
    isOrganizer: boolean;
    tripId: string;
  },
): Promise<MessageRow> {
  const result = await store.softDeleteMessage({
    messageId: input.messageId,
    tripId: input.tripId,
    userId: input.userId,
    isOrganizer: input.isOrganizer,
  });

  if (!result.ok) {
    if (result.reason === "forbidden") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only delete your own messages.",
      });
    }

    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Message not found.",
    });
  }

  return result.row;
}

export const chatRouter = {
  send: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        body: z.string().min(1).max(MAX_BODY_LENGTH),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRateLimit({
        key: `chat:send:${ctx.session.user.id}:${ctx.tripId}`,
        limit: 30,
        windowMs: 60_000,
        message: "You're sending messages too quickly. Wait a moment.",
      });
      const message = await sendMessage(createChatStore(ctx.db), {
        tripId: ctx.tripId,
        userId: ctx.session.user.id,
        body: input.body,
      });

      // Fan the persisted message out to connected WebSocket clients via the
      // TripRoom Durable Object. `ctx.realtime` is populated by the worker entry
      // (Workers runtime) and is `undefined`/`null` in unit tests, where this is
      // a no-op. Best-effort: a broadcast failure must never roll back or block
      // the already-persisted message (the impl wraps in try/catch + void).
      ctx.realtime?.broadcast(ctx.tripId, { type: "message", message });

      // Notify offline members. Fire-and-forget so a push failure never blocks
      // (or rolls back) the already-persisted message.
      void sendPushToTripMembers(ctx.db, {
        tripId: ctx.tripId,
        excludeUserId: ctx.session.user.id,
        title: ctx.session.user.name ?? "New message",
        body: message.body.slice(0, PUSH_PREVIEW_LENGTH),
        data: { tripId: ctx.tripId, screen: "chat" },
      });

      return message;
    }),

  history: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        before: z.date().optional(),
        limit: z.number().int().positive().default(MAX_HISTORY_LIMIT),
      }),
    )
    .query(({ ctx, input }) =>
      getHistory(createChatStore(ctx.db), {
        tripId: ctx.tripId,
        before: input.before,
        limit: input.limit,
      }),
    ),

  delete: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        messageId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deleted = await deleteMessage(createChatStore(ctx.db), {
        messageId: input.messageId,
        userId: ctx.session.user.id,
        isOrganizer: ctx.tripRole === "organizer",
        tripId: ctx.tripId,
      });

      // Tell connected clients to render the tombstone. No-op in unit tests
      // (no realtime runtime); best-effort in the Workers runtime.
      ctx.realtime?.broadcast(ctx.tripId, { type: "delete", id: deleted.id });

      return deleted;
    }),
} satisfies TRPCRouterRecord;

import { and, eq, inArray, ne } from "@gmacko/db";
import { db as dbType } from "@gmacko/db/client";
import { pushTokens, tripMembers } from "@gmacko/db/schema";

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: "default";
}

export async function sendPushToTripMembers(
  db: typeof dbType,
  opts: {
    tripId: string;
    excludeUserId?: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  },
) {
  const conditions = [eq(tripMembers.tripId, opts.tripId)];
  if (opts.excludeUserId) {
    conditions.push(ne(tripMembers.userId, opts.excludeUserId));
  }

  const members = await db
    .select({ userId: tripMembers.userId })
    .from(tripMembers)
    .where(and(...conditions));

  const userIds = members.map((m) => m.userId);
  if (userIds.length === 0) return;

  const tokenRows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(inArray(pushTokens.userId, userIds));

  if (tokenRows.length === 0) return;

  const messages: PushMessage[] = tokenRows.map((r) => ({
    to: r.token,
    title: opts.title,
    body: opts.body,
    data: opts.data,
    sound: "default" as const,
  }));

  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    }).catch(() => {});
  }
}

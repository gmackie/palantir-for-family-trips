import { and, eq } from "@sortey/db";
import { db } from "@sortey/db/client";
import { getR2Bucket } from "@sortey/db/runtime";
import { castEpisodes, tripMembers } from "@sortey/db/schema";
import { type NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";

export const runtime = "nodejs";

interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

/**
 * GET /api/cast/<episodeId>/audio — the episode MP3 for the in-app player and
 * the Download MP3 button (the P0 offline guarantee: save to the Files app,
 * play in airplane mode).
 *
 * Auth: better-auth session + trip membership on the episode's trip. The
 * final artifact lives in the app R2 bucket under cast/; there are no public
 * URLs.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { episodeId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      episodeId,
    )
  ) {
    return NextResponse.json({ error: "Invalid episode id" }, { status: 400 });
  }

  const [episode] = (await db
    .select({
      id: castEpisodes.id,
      tripId: castEpisodes.tripId,
      r2Key: castEpisodes.r2Key,
      title: castEpisodes.title,
      targetDate: castEpisodes.targetDate,
      sizeBytes: castEpisodes.sizeBytes,
    })
    .from(castEpisodes)
    .where(eq(castEpisodes.id, episodeId))
    .limit(1)) as Array<{
    id: string;
    tripId: string;
    r2Key: string;
    title: string;
    targetDate: string;
    sizeBytes: number;
  }>;
  if (!episode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [membership] = (await db
    .select({ userId: tripMembers.userId })
    .from(tripMembers)
    .where(
      and(
        eq(tripMembers.tripId, episode.tripId),
        eq(tripMembers.userId, session.user.id),
      ),
    )
    .limit(1)) as Array<{ userId: string }>;
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const r2 = getR2Bucket() as R2Bucket | null;
  if (!r2) {
    return NextResponse.json(
      { error: "Audio storage unavailable" },
      { status: 503 },
    );
  }

  const object = await r2.get(episode.r2Key);
  if (!object) {
    return NextResponse.json({ error: "Audio missing" }, { status: 404 });
  }

  const bytes = await object.arrayBuffer();
  const filename = `corridor-cast-${episode.targetDate}.mp3`;
  return new Response(bytes, {
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

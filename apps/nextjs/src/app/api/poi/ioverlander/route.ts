import { appRouter, createTRPCContext } from "@sortey/api";
import { type NextRequest, NextResponse } from "next/server";

import { auth, getSession } from "~/auth/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// A full-US iOverlander export is a few MB; cap generously to reject garbage.
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * POST /api/poi/ioverlander
 *
 * Multipart form with:
 * - `file`: the user's iOverlander CSV export (required)
 * - `workspaceId`: string (required)
 * - `tripId`: string (required)
 *
 * LICENSING: iOverlander data can't be redistributed, so each user uploads
 * their OWN export. We read the CSV server-side and hand the text to the
 * `corridor.importIoverlander` mutation in-process (no HTTP body limit), which
 * enforces workspace membership and scopes every row to `workspaceId`.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cast around the @types/node web-globals vs `dom` lib FormData conflict
  // (the global FormData type resolves without `.get`; it exists at runtime).
  const formData = (await request.formData()) as unknown as {
    get(name: string): File | string | null;
  };
  const file = formData.get("file");
  const workspaceId = formData.get("workspaceId");
  const tripId = formData.get("tripId");

  if (
    !(file instanceof File) ||
    typeof workspaceId !== "string" ||
    typeof tripId !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid form fields" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
      { status: 400 },
    );
  }

  const csv = await file.text();

  const caller = appRouter.createCaller(
    await createTRPCContext({
      headers: new Headers(request.headers),
      authApi: auth.api,
    }),
  );

  try {
    const result = await caller.corridor.importIoverlander({
      workspaceId,
      tripId,
      csv,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import CSV",
      },
      { status: 400 },
    );
  }
}

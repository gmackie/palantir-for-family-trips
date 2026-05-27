import { extractAndReconcileReceipt } from "@gmacko/api/ocr";
import { eq } from "@gmacko/db";
import { db } from "@gmacko/db/client";
import { getR2Bucket } from "@gmacko/db/runtime";
import { session as sessionTable, user as userTable } from "@gmacko/db/schema";
import { type NextRequest, NextResponse } from "next/server";

import { auth, getSession } from "~/auth/server";
import { storeReceiptImage } from "~/lib/receipt-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

async function getSessionWithFallback(request: NextRequest) {
  const session = await getSession();
  if (session?.user) return session;

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const prefix = "__Secure-better-auth.session_token=";
  const prefixAlt = "better-auth.session_token=";
  const tokens: string[] = [];

  for (const p of [prefix, prefixAlt]) {
    let searchFrom = 0;
    while (true) {
      const idx = cookieHeader.indexOf(p, searchFrom);
      if (idx === -1) break;
      const start = idx + p.length;
      const end = cookieHeader.indexOf(";", start);
      let value = cookieHeader
        .slice(start, end === -1 ? undefined : end)
        .trim();
      try {
        if (value.includes("%")) value = decodeURIComponent(value);
      } catch {}
      const dotPos = value.lastIndexOf(".");
      const token = dotPos > 0 ? value.substring(0, dotPos) : value;
      if (token) tokens.push(token);
      searchFrom = start;
    }
  }

  for (const token of tokens) {
    const [row] = await db
      .select()
      .from(sessionTable)
      .where(eq(sessionTable.token, token))
      .limit(1);
    if (!row || row.expiresAt < new Date()) continue;

    const [u] = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, row.userId))
      .limit(1);
    if (!u) continue;

    return { user: u, session: row };
  }

  return null;
}

/**
 * POST /api/receipts/scan
 *
 * Lightweight receipt upload + OCR. No expense ID required.
 * Used by the Expo mobile app's "new expense" flow where the
 * expense doesn't exist yet at capture time.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionWithFallback(request);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const mimeType = file.type;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported mime type: ${mimeType}` },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const r2 = getR2Bucket() as Parameters<typeof storeReceiptImage>[0]["r2"];
  let stored;
  try {
    stored = await storeReceiptImage({ bytes, mimeType, r2: r2 ?? undefined });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to store receipt",
      },
      { status: 400 },
    );
  }

  let ocr;
  try {
    const result = await extractAndReconcileReceipt({
      imageBytes: bytes,
      mimeType: mimeType as
        | "image/jpeg"
        | "image/png"
        | "image/webp"
        | "image/gif",
    });
    ocr = {
      ...result.sanitized,
      confidence: result.confidence,
      warnings: result.warnings,
    };
  } catch (error) {
    return NextResponse.json({
      storageKey: stored.storageKey,
      sizeBytes: stored.sizeBytes,
      mimeType: stored.mimeType,
      ocr: null,
      ocrError:
        error instanceof Error ? error.message : "OCR extraction failed",
    });
  }

  return NextResponse.json({
    storageKey: stored.storageKey,
    sizeBytes: stored.sizeBytes,
    mimeType: stored.mimeType,
    ocr,
  });
}

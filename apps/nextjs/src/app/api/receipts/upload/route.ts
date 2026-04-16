import { appRouter, createTRPCContext } from "@gmacko/api";
import { extractAndReconcileReceipt } from "@gmacko/api/ocr";
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

/**
 * POST /api/receipts/upload
 *
 * Multipart form with:
 * - `file`: image blob (required)
 * - `workspaceId`: string (required)
 * - `tripId`: string (required)
 * - `expenseId`: string (required — attach to this draft expense)
 *
 * Stores the image via local disk (DEV_MODE=local) or UploadThing,
 * runs OCR via the configured provider, reconciles, and attaches
 * the image + returns the OCR draft to the client.
 *
 * The client is expected to have already created a draft expense
 * via `trpc.expenses.create()` and passes its ID here.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const workspaceId = formData.get("workspaceId");
  const tripId = formData.get("tripId");
  const expenseId = formData.get("expenseId");

  if (
    !(file instanceof File) ||
    typeof workspaceId !== "string" ||
    typeof tripId !== "string" ||
    typeof expenseId !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing or invalid form fields" },
      { status: 400 },
    );
  }

  const mimeType = file.type;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported mime type ${mimeType}` },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Store the image first so we can persist its key even if OCR fails
  let stored;
  try {
    stored = await storeReceiptImage({ bytes, mimeType });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to store receipt",
      },
      { status: 400 },
    );
  }

  // Attach the storage key via the tRPC mutation (enforces trip membership)
  const caller = appRouter.createCaller(
    await createTRPCContext({
      headers: new Headers(request.headers),
      authApi: auth.api,
    }),
  );

  try {
    await caller.expenses.attachReceiptImage({
      workspaceId,
      tripId,
      expenseId,
      storageKey: stored.storageKey,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to attach receipt",
      },
      { status: 400 },
    );
  }

  // Run OCR and reconciliation. If this fails, we still return the storage
  // key — the user can edit the draft manually.
  let ocr;
  try {
    ocr = await extractAndReconcileReceipt({
      imageBytes: bytes,
      mimeType: mimeType as
        | "image/jpeg"
        | "image/png"
        | "image/webp"
        | "image/gif",
    });
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

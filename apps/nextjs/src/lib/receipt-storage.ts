import { createHash, randomBytes } from "node:crypto";

/**
 * Minimal Cloudflare R2 types — avoids pulling in @cloudflare/workers-types
 * just for the receipt storage module. Matches the subset of the R2 API we use.
 */
interface R2PutOptions {
  httpMetadata?: { contentType?: string };
}

interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob,
    options?: R2PutOptions,
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

/**
 * Receipt image storage.
 *
 * Production: Cloudflare R2 via the "R2" binding (wrangler.jsonc).
 * Development: Local disk fallback to `.data/receipts/`.
 *
 * Callers pass an optional `r2` bucket handle. When present, images are
 * stored in R2 under `receipts/<hash>-<suffix>.<ext>`. When absent
 * (DEV_MODE=local, or Node.js dev server without bindings), images fall
 * back to the local filesystem.
 */

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ReceiptStorageResult {
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

function generateStorageKey(bytes: Buffer, mimeType: string): string {
  const contentHash = createHash("sha256")
    .update(bytes)
    .digest("hex")
    .slice(0, 16);
  const suffix = randomBytes(4).toString("hex");
  return `receipts/${contentHash}-${suffix}.${extensionFor(mimeType)}`;
}

function validateInput(bytes: Buffer, mimeType: string): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported receipt image mime type: ${mimeType}`);
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(
      `Receipt image is ${bytes.byteLength} bytes, exceeds ${MAX_BYTES} byte limit.`,
    );
  }
}

export async function storeReceiptImage(input: {
  bytes: Buffer;
  mimeType: string;
  r2?: R2Bucket;
}): Promise<ReceiptStorageResult> {
  validateInput(input.bytes, input.mimeType);
  const storageKey = generateStorageKey(input.bytes, input.mimeType);

  if (input.r2) {
    await input.r2.put(storageKey, input.bytes, {
      httpMetadata: { contentType: input.mimeType },
    });
  } else {
    // Local disk fallback for development
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), ".data", "receipts");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, storageKey.replace("receipts/", "")),
      input.bytes,
    );
  }

  return {
    storageKey,
    sizeBytes: input.bytes.byteLength,
    mimeType: input.mimeType,
  };
}

export async function readReceiptImage(
  storageKey: string,
  r2?: R2Bucket,
): Promise<Buffer> {
  if (storageKey.includes("..")) {
    throw new Error("Invalid receipt storage key");
  }

  if (r2) {
    const object = await r2.get(storageKey);
    if (!object) throw new Error(`Receipt not found: ${storageKey}`);
    return Buffer.from(await object.arrayBuffer());
  }

  // Local disk fallback
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const localKey = storageKey.replace("receipts/", "");
  return readFile(join(process.cwd(), ".data", "receipts", localKey));
}

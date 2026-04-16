import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Local disk storage for receipt images during development.
 *
 * Writes bytes to `.data/receipts/` under a content-hash-derived key
 * and returns a storage key that can be passed back to `read()`.
 *
 * DEV_MODE=local uses this. Production receipt storage will route
 * through @gmacko/storage (UploadThing or S3) in a later phase.
 */

const RECEIPT_DIR = join(process.cwd(), ".data", "receipts");

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

export async function storeReceiptImage(input: {
  bytes: Buffer;
  mimeType: string;
}): Promise<ReceiptStorageResult> {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new Error(
      `Unsupported receipt image mime type: ${input.mimeType}. Allowed: ${Array.from(ALLOWED_MIME_TYPES).join(", ")}`,
    );
  }
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new Error(
      `Receipt image is ${input.bytes.byteLength} bytes, exceeds ${MAX_BYTES} byte limit.`,
    );
  }

  await mkdir(RECEIPT_DIR, { recursive: true });

  // storage key: content-hash prefix + random suffix + extension
  const contentHash = createHash("sha256").update(input.bytes).digest("hex").slice(0, 16);
  const suffix = randomBytes(4).toString("hex");
  const storageKey = `${contentHash}-${suffix}.${extensionFor(input.mimeType)}`;

  await writeFile(join(RECEIPT_DIR, storageKey), input.bytes);

  return {
    storageKey,
    sizeBytes: input.bytes.byteLength,
    mimeType: input.mimeType,
  };
}

export async function readReceiptImage(storageKey: string): Promise<Buffer> {
  // Defense in depth: reject any key that tries to path-traverse
  if (storageKey.includes("..") || storageKey.includes("/") || storageKey.includes("\\")) {
    throw new Error("Invalid receipt storage key");
  }
  return readFile(join(RECEIPT_DIR, storageKey));
}

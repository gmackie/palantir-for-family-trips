import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type FerryBooking,
  ferryBookingSchema,
  type ReceiptExtraction,
  receiptExtractionSchema,
} from "./schema";

interface LoadedFixtures {
  receipts: Map<string, ReceiptExtraction>;
  receiptDefault: ReceiptExtraction | null;
  ferries: Map<string, FerryBooking>;
  ferryDefault: FerryBooking | null;
}

/**
 * MockOCRProvider — for DEV_MODE=local and tests.
 *
 * Reads canned JSON responses from `packages/api/src/ocr/__fixtures__/*.json`
 * keyed by SHA-256 hash of the image bytes. Falls back to `default.json`
 * (receipts) or any single ferry fixture if no hash match is found.
 *
 * Receipt fixture shape:
 * ```json
 * {
 *   "hash": "a1b2c3...",        // optional — matches image hash
 *   "name": "restaurant-split", // human-readable label
 *   "extraction": { ... }       // matches ReceiptExtraction shape
 * }
 * ```
 *
 * Ferry fixture shape (discriminated by `"kind": "ferry"`):
 * ```json
 * {
 *   "kind": "ferry",
 *   "hash": "a1b2c3...",        // optional — matches image hash
 *   "name": "wsf-edmonds-kingston",
 *   "booking": { ... }          // matches FerryBooking shape
 * }
 * ```
 *
 * Test-only. The real OCR pipeline uses `claude-extractor.ts`.
 */
export class MockOCRProvider {
  private fixtureCache: LoadedFixtures | null = null;

  constructor(private fixturesDir?: string) {}

  async extract(imageBytes: Buffer): Promise<ReceiptExtraction> {
    const fixtures = await this.loadFixtures();
    const hash = createHash("sha256").update(imageBytes).digest("hex");

    const matched = fixtures.receipts.get(hash);
    if (matched) return matched;

    if (fixtures.receiptDefault) return fixtures.receiptDefault;

    throw new Error(
      `No receipt fixture found for image hash ${hash.slice(0, 12)}... and no default.json in ${this.fixturesDir ?? "__fixtures__"}`,
    );
  }

  async extractFerry(imageBytes: Buffer): Promise<FerryBooking> {
    const fixtures = await this.loadFixtures();
    const hash = createHash("sha256").update(imageBytes).digest("hex");

    const matched = fixtures.ferries.get(hash);
    if (matched) return matched;

    if (fixtures.ferryDefault) return fixtures.ferryDefault;

    throw new Error(
      `No ferry fixture found for image hash ${hash.slice(0, 12)}... and no ferry fixture in ${this.fixturesDir ?? "__fixtures__"}`,
    );
  }

  private async loadFixtures(): Promise<LoadedFixtures> {
    if (this.fixtureCache) return this.fixtureCache;

    const dir =
      this.fixturesDir ??
      join(
        new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
        "__fixtures__",
      );

    const loaded: LoadedFixtures = {
      receipts: new Map(),
      receiptDefault: null,
      ferries: new Map(),
      ferryDefault: null,
    };

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      this.fixtureCache = loaded;
      return loaded;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const parsed = JSON.parse(raw);

        if (parsed.kind === "ferry") {
          const booking = ferryBookingSchema.parse(parsed.booking);
          // The single canned ferry fixture also serves as the default so a
          // fixture-mode extraction works without a hash match.
          loaded.ferryDefault = booking;
          if (typeof parsed.hash === "string") {
            loaded.ferries.set(parsed.hash, booking);
          }
          continue;
        }

        const extraction = receiptExtractionSchema.parse(parsed.extraction);
        if (file === "default.json") {
          loaded.receiptDefault = extraction;
        }
        if (typeof parsed.hash === "string") {
          loaded.receipts.set(parsed.hash, extraction);
        }
      } catch {
        // Skip malformed fixtures silently — they'll fail the test that uses them
      }
    }

    this.fixtureCache = loaded;
    return loaded;
  }
}

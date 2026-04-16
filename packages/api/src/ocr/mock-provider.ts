import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { receiptExtractionSchema, type ReceiptExtraction } from "./schema";

/**
 * MockOCRProvider — for DEV_MODE=local and tests.
 *
 * Reads canned JSON responses from `packages/api/src/ocr/__fixtures__/*.json`
 * keyed by SHA-256 hash of the image bytes. Falls back to `default.json`
 * if no hash match is found.
 *
 * Fixture shape:
 * ```json
 * {
 *   "hash": "a1b2c3...",        // optional — matches image hash
 *   "name": "restaurant-split", // human-readable label
 *   "extraction": { ... }       // matches ReceiptExtraction shape
 * }
 * ```
 *
 * Test-only. The real OCR pipeline uses `claude-extractor.ts`.
 */
export class MockOCRProvider {
  private fixtureCache: Map<string, ReceiptExtraction> | null = null;
  private defaultFixture: ReceiptExtraction | null = null;

  constructor(private fixturesDir?: string) {}

  async extract(imageBytes: Buffer): Promise<ReceiptExtraction> {
    const fixtures = await this.loadFixtures();
    const hash = createHash("sha256").update(imageBytes).digest("hex");

    const matched = fixtures.get(hash);
    if (matched) return matched;

    if (this.defaultFixture) return this.defaultFixture;

    throw new Error(
      `No fixture found for image hash ${hash.slice(0, 12)}... and no default.json in ${this.fixturesDir ?? "__fixtures__"}`,
    );
  }

  private async loadFixtures(): Promise<Map<string, ReceiptExtraction>> {
    if (this.fixtureCache) return this.fixtureCache;

    const dir =
      this.fixturesDir ??
      join(
        new URL(".", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
        "__fixtures__",
      );

    const cache = new Map<string, ReceiptExtraction>();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      this.fixtureCache = cache;
      return cache;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const parsed = JSON.parse(raw);
        const extraction = receiptExtractionSchema.parse(parsed.extraction);

        if (file === "default.json") {
          this.defaultFixture = extraction;
        }
        if (typeof parsed.hash === "string") {
          cache.set(parsed.hash, extraction);
        }
      } catch (error) {
        // Skip malformed fixtures silently — they'll fail the test that uses them
      }
    }

    this.fixtureCache = cache;
    return cache;
  }
}

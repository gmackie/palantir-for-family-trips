import { GoogleGenerativeAI } from "@google/generative-ai";

import { type ReceiptExtraction, receiptExtractionSchema } from "./schema";

/**
 * Gemini Flash-Lite receipt extractor.
 *
 * Uses Gemini's structured JSON output mode to extract receipt data.
 * Cheaper and faster than Claude for this narrow, well-structured task.
 *
 * Default model: gemini-2.5-flash-lite. Override via the `model` option.
 * Requires GOOGLE_AI_API_KEY in the environment (or passed explicitly).
 */

const RECEIPT_EXTRACTION_PROMPT = `You are a receipt extraction system. Given an image of a receipt, produce a structured JSON object.

Rules:
- Read every visible line item in order
- Use minor currency units (cents for USD)
- Detect currency from symbols ($ = USD, € = EUR, £ = GBP)
- Use printed tax, tip, subtotal exactly
- tipCents: 0 if not visible
- lineItems: only purchased goods, no tax/tip/subtotal/total
- lineTotalCents = quantity × unitPriceCents
- occurredAt: ISO 8601 from receipt date/time, 12:00:00 if time missing
- Do not invent items. "[unreadable]" for illegible items
- No PII (card numbers, loyalty numbers)

Return JSON with these fields:
{
  "merchant": string,
  "occurredAt": string (ISO 8601),
  "currency": string (ISO 4217, 3 chars),
  "subtotalCents": number,
  "taxCents": number,
  "tipCents": number,
  "totalCents": number,
  "lineItems": [{ "name": string, "quantity": number, "unitPriceCents": number, "lineTotalCents": number }]
}`;

export class GeminiReceiptExtractor {
  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey)
      throw new Error("GOOGLE_AI_API_KEY is required for Gemini OCR");
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = options.model ?? "gemini-2.5-flash-lite";
  }

  async extract(input: {
    imageBytes: Buffer;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  }): Promise<ReceiptExtraction> {
    const model = this.client.getGenerativeModel({ model: this.modelName });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: input.mimeType,
                data: input.imageBytes.toString("base64"),
              },
            },
            { text: RECEIPT_EXTRACTION_PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const text = result.response.text();
    const parsed = JSON.parse(text);
    return receiptExtractionSchema.parse(parsed);
  }
}

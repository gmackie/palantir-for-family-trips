"use client";

import { Button } from "@sortey/ui/button";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@sortey/ui/field";
import { Input } from "@sortey/ui/input";
import {
  ReceiptUpload,
  type ReceiptUploadExtracted,
  type ReceiptUploadStatus,
} from "@sortey/ui/receipt-upload";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

const CATEGORIES = [
  { value: "meal", label: "Meal" },
  { value: "transit", label: "Transit" },
  { value: "lodging", label: "Lodging" },
  { value: "activity", label: "Activity" },
  { value: "drinks", label: "Drinks" },
  { value: "tickets", label: "Tickets" },
  { value: "general", label: "General" },
] as const;

type ExpenseCategory = (typeof CATEGORIES)[number]["value"];

// Image MIME types `expenses.extractFromReceipt` accepts. Kept in sync with
// `receiptExtractInputSchema` server-side; narrowing here lets us drop a
// non-image file early with a clear message instead of round-tripping a reject.
const RECEIPT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
type ReceiptImageMime = (typeof RECEIPT_IMAGE_MIME_TYPES)[number];

function isReceiptImageMime(value: string): value is ReceiptImageMime {
  return (RECEIPT_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

type ScannedLineItem = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

type OcrProvenance = {
  ocrConfidence: number;
  ocrWarnings: string[];
  ocrProvider: "claude" | "gemini" | "fixture";
  ocrStatus: "success" | "failed";
};

function dollarsToCents(value: string): number {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return 0;
  return Math.round(num * 100);
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Read a `File` as base64 and strip the `data:<mime>;base64,` prefix so the API
 * receives the bare base64 payload its `imageBase64` input expects.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected file read result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export default function NewExpensePage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const trpc = useTRPC();

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Controlled prefillable fields so a receipt scan can populate them for the
  // user to review/edit before submit. Defaults preserve the manual-entry path.
  const today = new Date().toISOString().split("T")[0] ?? "";
  const [merchant, setMerchant] = useState("");
  const [occurredAt, setOccurredAt] = useState(today);
  const [category, setCategory] = useState<ExpenseCategory>("general");
  const [subtotal, setSubtotal] = useState("");
  const [tax, setTax] = useState("");
  const [tip, setTip] = useState("");
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("USD");

  // Scan state. Line items + OCR provenance are stashed here and applied after
  // the draft is created (create form has no inline line-item editor).
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedLineItems, setScannedLineItems] = useState<ScannedLineItem[]>(
    [],
  );
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [ocrProvenance, setOcrProvenance] = useState<OcrProvenance | null>(
    null,
  );
  const [extractedPreview, setExtractedPreview] =
    useState<ReceiptUploadExtracted | null>(null);

  // Fetch workspace context to get workspaceId
  const workspaceQuery = useQuery(
    trpc.settings.getWorkspaceContext.queryOptions(),
  );
  const workspaceId = workspaceQuery.data?.workspace?.id;

  // Fetch segments for the dropdown
  const segmentsQuery = useQuery(
    trpc.trips.listSegments.queryOptions(
      { workspaceId: workspaceId!, tripId },
      { enabled: !!workspaceId },
    ),
  );

  const createExpense = useMutation(trpc.expenses.create.mutationOptions());
  const addLineItems = useMutation(
    trpc.expenses.addLineItems.mutationOptions(),
  );
  const extractReceipt = useMutation(
    trpc.expenses.extractFromReceipt.mutationOptions(),
  );

  function clearScan() {
    setReceiptFile(null);
    setScannedLineItems([]);
    setScanNote(null);
    setScanError(null);
    setOcrProvenance(null);
    setExtractedPreview(null);
  }

  async function handleScan(file: File) {
    if (!workspaceId) return;
    if (!isReceiptImageMime(file.type)) {
      setScanError("Couldn't read the receipt — enter manually");
      toast.error("Couldn't read the receipt — enter manually");
      return;
    }
    const mimeType = file.type;
    setReceiptFile(file);
    setScanning(true);
    setScanNote(null);
    setScanError(null);
    setExtractedPreview(null);
    setOcrProvenance(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const result = await extractReceipt.mutateAsync({
        workspaceId,
        tripId,
        imageBase64,
        mimeType,
      });
      if (!result.ok) {
        setScanError("Couldn't read the receipt — enter manually");
        toast.error("Couldn't read the receipt — enter manually");
        return;
      }
      const { receipt } = result;
      // Pre-fill the form for review. The user can edit anything before submit.
      if (receipt.merchant) setMerchant(receipt.merchant);
      const datePart = receipt.occurredAt.split("T")[0];
      if (datePart) setOccurredAt(datePart);
      if (receipt.currency) setCurrency(receipt.currency.toUpperCase());
      setSubtotal(centsToDollars(receipt.subtotalCents));
      setTax(centsToDollars(receipt.taxCents));
      setTip(centsToDollars(receipt.tipCents));
      setTotal(centsToDollars(receipt.totalCents));
      setScannedLineItems(receipt.lineItems);
      setOcrProvenance({
        ocrConfidence: receipt.ocrConfidence,
        ocrWarnings: receipt.ocrWarnings,
        ocrProvider: receipt.ocrProvider,
        ocrStatus: receipt.ocrStatus,
      });
      setExtractedPreview({
        merchant: receipt.merchant,
        currency: receipt.currency,
        subtotalCents: receipt.subtotalCents,
        taxCents: receipt.taxCents,
        tipCents: receipt.tipCents,
        totalCents: receipt.totalCents,
        needsReview: receipt.needsReview,
        warnings: receipt.ocrWarnings,
        lineItems: receipt.lineItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          lineTotalCents: item.lineTotalCents,
        })),
      });
      setScanNote(
        receipt.needsReview
          ? "Scanned — low confidence, please double-check the amounts."
          : `Scanned ${receipt.lineItems.length} item${
              receipt.lineItems.length === 1 ? "" : "s"
            } — review and submit.`,
      );
      toast.success("Receipt scanned");
    } catch (err) {
      const message =
        err instanceof Error && /too many/i.test(err.message)
          ? err.message
          : "Couldn't read the receipt — enter manually";
      setScanError(message);
      toast.error(message);
    } finally {
      setScanning(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!workspaceId) return;

    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const segmentId = form.get("segmentId") as string;

    const subtotalCents = dollarsToCents(subtotal);
    const taxCents = dollarsToCents(tax);
    const tipCents = dollarsToCents(tip);
    const totalCents = dollarsToCents(total);

    try {
      const expense = await createExpense.mutateAsync({
        workspaceId,
        tripId,
        segmentId,
        merchant,
        occurredAt: new Date(occurredAt).toISOString(),
        category,
        currency: currency.toUpperCase(),
        subtotalCents,
        taxCents,
        tipCents,
        totalCents,
      });

      // Attach line items captured from a receipt scan (the create form has no
      // inline line-item editor). Best-effort — failure doesn't block navigation.
      if (scannedLineItems.length > 0 && expense.id) {
        try {
          await addLineItems.mutateAsync({
            workspaceId,
            tripId,
            expenseId: expense.id,
            items: scannedLineItems.map((item, i) => ({
              name: item.name,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              lineTotalCents: item.lineTotalCents,
              sortOrder: i,
            })),
          });
        } catch {
          // Line items are optional; don't block navigation.
        }
      }

      // Store the receipt image. If we already OCR'd on scan, skip a second
      // OCR pass and just attach storage + provenance.
      if (receiptFile && expense.id) {
        try {
          const uploadForm = new FormData();
          uploadForm.append("file", receiptFile);
          uploadForm.append("workspaceId", workspaceId);
          uploadForm.append("tripId", tripId);
          uploadForm.append("expenseId", expense.id);

          const alreadyScanned = ocrProvenance != null;
          if (alreadyScanned) {
            uploadForm.append("skipOcr", "true");
            uploadForm.append(
              "ocrConfidence",
              String(ocrProvenance.ocrConfidence),
            );
            uploadForm.append(
              "ocrWarnings",
              JSON.stringify(ocrProvenance.ocrWarnings),
            );
            uploadForm.append("ocrProvider", ocrProvenance.ocrProvider);
            uploadForm.append("ocrStatus", ocrProvenance.ocrStatus);
          }

          const uploadRes = await fetch("/api/receipts/upload", {
            method: "POST",
            body: uploadForm,
          });

          // Only apply OCR-derived line items/totals when we did NOT already
          // scan — otherwise we'd double-insert line items and overwrite edits.
          if (uploadRes.ok && !alreadyScanned) {
            const uploadData = (await uploadRes.json()) as {
              ocr?: {
                merchant: string;
                subtotalCents: number;
                taxCents: number;
                tipCents: number;
                totalCents: number;
                lineItems: Array<{
                  name: string;
                  quantity: number;
                  unitPriceCents: number;
                  lineTotalCents: number;
                }>;
                confidence: number;
              } | null;
            };

            if (uploadData.ocr?.lineItems.length) {
              const ocr = uploadData.ocr;
              await addLineItems.mutateAsync({
                workspaceId,
                tripId,
                expenseId: expense.id,
                items: ocr.lineItems.map((item, i) => ({
                  name: item.name,
                  quantity: item.quantity,
                  unitPriceCents: item.unitPriceCents,
                  lineTotalCents: item.lineTotalCents,
                  sortOrder: i,
                })),
              });
            }
          }
        } catch {
          // Receipt upload/OCR is optional; don't block navigation
        }
      }

      router.push(`/trips/${tripId}/expenses/${expense.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create expense");
      setSubmitting(false);
    }
  }

  const segments = segmentsQuery.data ?? [];
  const isLoading = workspaceQuery.isLoading || segmentsQuery.isLoading;

  const uploadStatus: ReceiptUploadStatus = scanning
    ? "loading"
    : scanError
      ? "error"
      : extractedPreview
        ? "success"
        : receiptFile
          ? "idle"
          : "empty";

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
          New Expense
        </p>
        <h1 className="text-4xl font-black tracking-tight">Add an expense</h1>
        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
          Record what was spent. Scan a receipt to pre-fill merchant, line
          items, tax, and tip — or enter them manually. You can edit anything
          before creating.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-[4px] border border-[#F85149]/30 bg-[#F85149]/10 p-3 text-sm text-[#F85149]">
          {error}
        </div>
      )}

      <div className="mt-8">
        <ReceiptUpload
          file={receiptFile}
          status={uploadStatus}
          scanning={scanning}
          error={scanError}
          statusNote={scanNote}
          extracted={extractedPreview}
          disabled={isLoading || submitting}
          onFileSelect={(file) => {
            void handleScan(file);
          }}
          onClear={clearScan}
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-card mt-6 rounded-3xl border p-6"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="merchant">Merchant</FieldLabel>
            <FieldContent>
              <Input
                id="merchant"
                name="merchant"
                placeholder="Restaurant name, store, etc."
                required
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
              />
            </FieldContent>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="occurredAt">Date</FieldLabel>
              <FieldContent>
                <Input
                  id="occurredAt"
                  name="occurredAt"
                  type="date"
                  required
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <FieldContent>
                <select
                  id="category"
                  name="category"
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as ExpenseCategory)
                  }
                  className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </FieldContent>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="segmentId">Trip segment</FieldLabel>
            <FieldContent>
              {isLoading ? (
                <p className="text-muted-foreground text-sm">
                  Loading segments...
                </p>
              ) : (
                <select
                  id="segmentId"
                  name="segmentId"
                  required
                  className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm"
                >
                  {segments.map((seg) => (
                    <option key={seg.id} value={seg.id}>
                      {seg.name}
                    </option>
                  ))}
                </select>
              )}
            </FieldContent>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="subtotal">Subtotal ($)</FieldLabel>
              <FieldContent>
                <Input
                  id="subtotal"
                  name="subtotal"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="tabular-nums"
                  value={subtotal}
                  onChange={(e) => setSubtotal(e.target.value)}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="tax">Tax ($)</FieldLabel>
              <FieldContent>
                <Input
                  id="tax"
                  name="tax"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="tabular-nums"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="tip">Tip ($)</FieldLabel>
              <FieldContent>
                <Input
                  id="tip"
                  name="tip"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="tabular-nums"
                  value={tip}
                  onChange={(e) => setTip(e.target.value)}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="total">Total ($)</FieldLabel>
              <FieldContent>
                <Input
                  id="total"
                  name="total"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  required
                  className="tabular-nums"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                />
              </FieldContent>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="currency">Currency</FieldLabel>
            <FieldContent>
              <Input
                id="currency"
                name="currency"
                maxLength={3}
                className="uppercase tabular-nums"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </FieldContent>
          </Field>

          {currency.toUpperCase() !== "USD" && (
            <div className="rounded-[4px] border border-[#D29922]/40 bg-[#D29922]/10 p-3 text-sm text-[#D29922]">
              This expense is in {currency.toUpperCase()}. Settlement only works
              within a single currency.
            </div>
          )}
        </FieldGroup>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/trips/${tripId}/expenses`)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || isLoading}>
            {submitting ? "Creating..." : "Create expense"}
          </Button>
        </div>
      </form>
    </main>
  );
}

"use client";

import { OCR_REVIEW_CONFIDENCE_THRESHOLD } from "@sortey/api/ocr/review";
import { Button } from "@sortey/ui/button";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@sortey/ui/field";
import { Input } from "@sortey/ui/input";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";

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

  // Scan state. Line items from the scan are stashed here and attached after the
  // draft is created (the create form has no inline line-item editor).
  const [scanning, setScanning] = useState(false);
  const [scannedLineItems, setScannedLineItems] = useState<ScannedLineItem[]>(
    [],
  );
  const [scanNote, setScanNote] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

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
  const updateExpense = useMutation(
    trpc.expenses.updateDraft.mutationOptions(),
  );
  const extractReceipt = useMutation(
    trpc.expenses.extractFromReceipt.mutationOptions(),
  );

  async function handleScan(file: File) {
    if (!workspaceId) return;
    if (!isReceiptImageMime(file.type)) {
      toast.error("Couldn't read the receipt — enter manually");
      return;
    }
    const mimeType = file.type;
    setScanning(true);
    setScanNote(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const result = await extractReceipt.mutateAsync({
        workspaceId,
        tripId,
        imageBase64,
        mimeType,
      });
      if (!result.ok) {
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
      setScanNote(
        receipt.needsReview
          ? "Scanned — low confidence, please double-check the amounts."
          : `Scanned ${receipt.lineItems.length} item${
              receipt.lineItems.length === 1 ? "" : "s"
            } — review and submit.`,
      );
      toast.success("Receipt scanned");
    } catch {
      toast.error("Couldn't read the receipt — enter manually");
    } finally {
      setScanning(false);
      // Allow re-selecting the same file to re-scan.
      if (scanInputRef.current) scanInputRef.current.value = "";
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

      if (receiptFile && expense.id) {
        try {
          const uploadForm = new FormData();
          uploadForm.append("file", receiptFile);
          uploadForm.append("workspaceId", workspaceId);
          uploadForm.append("tripId", tripId);
          uploadForm.append("expenseId", expense.id);

          const uploadRes = await fetch("/api/receipts/upload", {
            method: "POST",
            body: uploadForm,
          });

          if (uploadRes.ok) {
            const uploadData = (await uploadRes.json()) as {
              ocr?: {
                sanitized: {
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
                };
                confidence: number;
                warnings: string[];
              } | null;
              ocrError?: string;
            };

            if (uploadData.ocr?.sanitized.lineItems.length) {
              const ocr = uploadData.ocr.sanitized;
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

              if (
                uploadData.ocr.confidence >= OCR_REVIEW_CONFIDENCE_THRESHOLD
              ) {
                await updateExpense.mutateAsync({
                  workspaceId,
                  tripId,
                  expenseId: expense.id,
                  subtotalCents: ocr.subtotalCents,
                  taxCents: ocr.taxCents,
                  tipCents: ocr.tipCents,
                  totalCents: ocr.totalCents,
                });
              }
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

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
          New Expense
        </p>
        <h1 className="text-4xl font-black tracking-tight">Add an expense</h1>
        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
          Record what was spent. Scan a receipt to pre-fill the fields, or enter
          them manually. You can add line items and finalize after creating.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-[4px] border border-[#F85149]/30 bg-[#F85149]/10 p-3 text-sm text-[#F85149]">
          {error}
        </div>
      )}

      {/* Scan-to-prefill: reads a receipt image and populates the form below for
          review before submit. Independent of the manual-entry path. */}
      <div className="mt-8 rounded-[4px] border border-[#58A6FF]/30 bg-[#58A6FF]/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Scan receipt
            </p>
            <p className="text-muted-foreground text-xs">
              {scanNote ??
                "Snap or upload a receipt to auto-fill merchant, amounts, and items."}
            </p>
          </div>
          <input
            ref={scanInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleScan(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={scanning || isLoading}
            onClick={() => scanInputRef.current?.click()}
          >
            {scanning ? "Scanning..." : "Scan receipt"}
          </Button>
        </div>
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

          {scannedLineItems.length > 0 && (
            <div className="rounded-[4px] border border-[#21262D] bg-[#0D1117] p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
                Scanned items ({scannedLineItems.length})
              </p>
              <ul className="mt-2 space-y-1">
                {scannedLineItems.map((item, i) => (
                  <li
                    key={`${item.name}-${i}`}
                    className="flex justify-between text-xs text-[#C9D1D9]"
                  >
                    <span className="truncate pr-2">
                      {item.quantity > 1 ? `${item.quantity}× ` : ""}
                      {item.name}
                    </span>
                    <span className="tabular-nums text-[#8B949E]">
                      ${centsToDollars(item.lineTotalCents)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-[11px]">
                Items are attached to the expense after you create it.
              </p>
            </div>
          )}

          <Field>
            <FieldLabel htmlFor="receipt">Receipt image (optional)</FieldLabel>
            <FieldContent>
              <Input
                id="receipt"
                name="receipt"
                type="file"
                accept="image/*"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              />
            </FieldContent>
          </Field>
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

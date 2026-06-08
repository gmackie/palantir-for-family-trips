"use client";

import { Button } from "@sortey/ui/button";
import { Field, FieldContent, FieldGroup, FieldLabel } from "@sortey/ui/field";
import { Input } from "@sortey/ui/input";
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

function dollarsToCents(value: string): number {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return 0;
  return Math.round(num * 100);
}

export default function NewExpensePage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const trpc = useTRPC();

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!workspaceId) return;

    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    const merchant = form.get("merchant") as string;
    const occurredAt = form.get("occurredAt") as string;
    const category = form.get("category") as string;
    const segmentId = form.get("segmentId") as string;
    const subtotalCents = dollarsToCents(form.get("subtotal") as string);
    const taxCents = dollarsToCents(form.get("tax") as string);
    const tipCents = dollarsToCents(form.get("tip") as string);
    const totalCents = dollarsToCents(form.get("total") as string);

    try {
      const expense = await createExpense.mutateAsync({
        workspaceId,
        tripId,
        segmentId,
        merchant,
        occurredAt: new Date(occurredAt).toISOString(),
        category: category as
          | "meal"
          | "transit"
          | "lodging"
          | "activity"
          | "drinks"
          | "tickets"
          | "general",
        subtotalCents,
        taxCents,
        tipCents,
        totalCents,
      });

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

              if (uploadData.ocr.confidence >= 0.8) {
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
          Record what was spent. You can add line items and finalize after
          creating.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-[4px] border border-[#F85149]/30 bg-[#F85149]/10 p-3 text-sm text-[#F85149]">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-card mt-8 rounded-3xl border p-6 shadow-sm"
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
                  defaultValue={new Date().toISOString().split("T")[0]}
                  required
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <FieldContent>
                <select
                  id="category"
                  name="category"
                  defaultValue="general"
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
                />
              </FieldContent>
            </Field>
          </div>

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

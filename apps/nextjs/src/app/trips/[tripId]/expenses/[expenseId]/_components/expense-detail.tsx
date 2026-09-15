"use client";

import type { AppRouter } from "@sortey/api";
import { needsOcrReview } from "@sortey/api/ocr/review";
import { Button } from "@sortey/ui/button";
import { ExpenseSharesPanel } from "@sortey/ui/expense-shares-panel";
import { Input } from "@sortey/ui/input";
import { LineItemRow } from "@sortey/ui/line-item-row";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { useState } from "react";

import { StatusPill } from "~/app/trips/_components/command-panel";
import { useExpenseRealtime } from "~/lib/use-expense-realtime";
import { useTRPC } from "~/trpc/react";

type ExpenseGetOutput = inferRouterOutputs<AppRouter>["expenses"]["get"];

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

export function ExpenseDetail(props: {
  tripId: string;
  workspaceId: string;
  expenseId: string;
  currentUserId: string;
  claimMode: "tap" | "organizer";
  initialData: ExpenseGetOutput;
}) {
  const { tripId, workspaceId, expenseId, currentUserId, claimMode } = props;
  const trpc = useTRPC();

  useExpenseRealtime({ expenseId, workspaceId, tripId });

  const { data } = useQuery({
    ...trpc.expenses.get.queryOptions({ workspaceId, tripId, expenseId }),
    initialData: props.initialData,
  });

  const { data: members = [] } = useQuery(
    trpc.trips.listMembers.queryOptions({ workspaceId, tripId }),
  );

  const expense = data.expense;
  const lineItems = data.lineItems;
  const shares = data.shares;
  const isDraft = expense.status === "draft";
  const isOrganizer =
    members.find((m) => m.userId === currentUserId)?.role === "organizer";

  const ocrWarnings = expense.ocrWarnings ?? [];
  const ocrNeedsReview = needsOcrReview({
    ocrConfidence: expense.ocrConfidence,
    ocrStatus: expense.ocrStatus,
  });
  const showOcrNotice = ocrNeedsReview || ocrWarnings.length > 0;

  const [editingDraft, setEditingDraft] = useState(false);
  const [draftMerchant, setDraftMerchant] = useState(expense.merchant);
  const [draftSubtotal, setDraftSubtotal] = useState(
    (expense.subtotalCents / 100).toFixed(2),
  );
  const [draftTax, setDraftTax] = useState((expense.taxCents / 100).toFixed(2));
  const [draftTip, setDraftTip] = useState((expense.tipCents / 100).toFixed(2));
  const [draftTotal, setDraftTotal] = useState(
    (expense.totalCents / 100).toFixed(2),
  );

  const [addingLineItem, setAddingLineItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  const updateDraft = useMutation(trpc.expenses.updateDraft.mutationOptions());
  const finalize = useMutation(trpc.expenses.finalize.mutationOptions());
  const addLineItem = useMutation(trpc.expenses.addLineItem.mutationOptions());
  const removeLineItem = useMutation(
    trpc.expenses.removeLineItem.mutationOptions(),
  );
  const claimLineItem = useMutation(
    trpc.expenses.claimLineItem.mutationOptions(),
  );
  const unclaimLineItem = useMutation(
    trpc.expenses.unclaimLineItem.mutationOptions(),
  );
  const assignLineItem = useMutation(
    trpc.expenses.assignLineItem.mutationOptions(),
  );

  const claimPending =
    claimLineItem.isPending ||
    unclaimLineItem.isPending ||
    assignLineItem.isPending;

  async function handleSaveDraft() {
    await updateDraft.mutateAsync({
      workspaceId,
      tripId,
      expenseId,
      merchant: draftMerchant,
      subtotalCents: Math.round(parseFloat(draftSubtotal) * 100),
      taxCents: Math.round(parseFloat(draftTax) * 100),
      tipCents: Math.round(parseFloat(draftTip) * 100),
      totalCents: Math.round(parseFloat(draftTotal) * 100),
    });
    setEditingDraft(false);
  }

  async function handleFinalize() {
    await finalize.mutateAsync({ workspaceId, tripId, expenseId });
  }

  async function handleAddLineItem() {
    const priceCents = Math.round(parseFloat(newItemPrice) * 100);
    if (!newItemName || Number.isNaN(priceCents)) return;

    await addLineItem.mutateAsync({
      workspaceId,
      tripId,
      expenseId,
      name: newItemName,
      quantity: 1,
      unitPriceCents: priceCents,
      lineTotalCents: priceCents,
      sortOrder: lineItems.length,
    });
    setNewItemName("");
    setNewItemPrice("");
    setAddingLineItem(false);
  }

  async function handleRemoveLineItem(lineItemId: string) {
    await removeLineItem.mutateAsync({
      workspaceId,
      tripId,
      expenseId,
      lineItemId,
    });
  }

  async function handleToggleClaim(
    lineItemId: string,
    currentlyClaimed: boolean,
  ) {
    if (currentlyClaimed) {
      await unclaimLineItem.mutateAsync({
        workspaceId,
        tripId,
        expenseId,
        lineItemId,
      });
    } else {
      await claimLineItem.mutateAsync({
        workspaceId,
        tripId,
        expenseId,
        lineItemId,
      });
    }
  }

  async function handleAssign(lineItemId: string, userIds: string[]) {
    await assignLineItem.mutateAsync({
      workspaceId,
      tripId,
      expenseId,
      lineItemId,
      userIds,
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
            Expense Detail
          </p>
          <h1 className="text-4xl font-black tracking-tight">
            {expense.merchant}
          </h1>
          <div className="text-muted-foreground flex flex-wrap gap-4 text-sm">
            <span className="capitalize">{expense.category}</span>
            <span>{formatDate(expense.occurredAt)}</span>
            <span>{expense.currency}</span>
            <StatusPill tone={isDraft ? "warning" : "success"}>
              {expense.status}
            </StatusPill>
            {!isDraft && (
              <span className="capitalize">
                {claimMode === "tap" ? "Tap to claim" : "Organizer assigns"}
              </span>
            )}
          </div>
        </div>

        <Button asChild variant="outline">
          <Link href={`/trips/${tripId}/expenses`}>Back to expenses</Link>
        </Button>
      </div>

      {showOcrNotice && (
        <section
          className={`rounded-3xl border p-5 ${
            ocrNeedsReview
              ? "border-[#D29922]/30 bg-[#D29922]/10"
              : "border-[#58A6FF]/30 bg-[#58A6FF]/10"
          }`}
        >
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-lg leading-none">
              {ocrNeedsReview ? "⚠" : "ℹ"}
            </span>
            <div className="space-y-2">
              <p
                className={`font-semibold ${
                  ocrNeedsReview ? "text-[#D29922]" : "text-[#58A6FF]"
                }`}
              >
                {expense.ocrStatus === "failed"
                  ? "Receipt scan failed — verify these details manually"
                  : ocrNeedsReview
                    ? "Low-confidence receipt scan — please review the amounts"
                    : "Scanned from receipt"}
              </p>
              {(expense.ocrConfidence != null || expense.ocrProvider) && (
                <p className="text-muted-foreground text-sm">
                  {expense.ocrConfidence != null && (
                    <span className="font-mono tabular-nums">
                      {Math.round(expense.ocrConfidence * 100)}% confidence
                    </span>
                  )}
                  {expense.ocrConfidence != null &&
                    expense.ocrProvider &&
                    " · "}
                  {expense.ocrProvider && (
                    <>scanned via {expense.ocrProvider}</>
                  )}
                </p>
              )}
              {ocrWarnings.length > 0 && (
                <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
                  {ocrWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="bg-card rounded-3xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Totals</h2>
          {isDraft && !editingDraft && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingDraft(true)}
            >
              Edit
            </Button>
          )}
        </div>

        {editingDraft ? (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-muted-foreground mb-1 block text-xs">
                Merchant
              </label>
              <Input
                value={draftMerchant}
                onChange={(e) => setDraftMerchant(e.target.value)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Subtotal ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={draftSubtotal}
                  onChange={(e) => setDraftSubtotal(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Tax ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={draftTax}
                  onChange={(e) => setDraftTax(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Tip ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={draftTip}
                  onChange={(e) => setDraftTip(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">
                  Total ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={draftTotal}
                  onChange={(e) => setDraftTotal(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSaveDraft}
                disabled={updateDraft.isPending}
              >
                {updateDraft.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingDraft(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-muted-foreground text-xs">Subtotal</dt>
                <dd className="text-lg font-bold font-mono tabular-nums">
                  {formatCents(expense.subtotalCents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Tax</dt>
                <dd className="text-lg font-bold font-mono tabular-nums">
                  {formatCents(expense.taxCents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Tip</dt>
                <dd className="text-lg font-bold font-mono tabular-nums">
                  {formatCents(expense.tipCents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Total</dt>
                <dd className="text-lg font-bold font-mono tabular-nums">
                  {formatCents(expense.totalCents)}
                </dd>
              </div>
            </dl>
            {!isDraft && (expense.taxCents > 0 || expense.tipCents > 0) && (
              <p className="text-muted-foreground mt-3 text-xs">
                Tax and tip are split automatically based on each member&apos;s
                share of the subtotal.
              </p>
            )}
          </>
        )}

        {isDraft && (
          <div className="mt-6">
            <Button onClick={handleFinalize} disabled={finalize.isPending}>
              {finalize.isPending ? "Finalizing..." : "Finalize expense"}
            </Button>
          </div>
        )}
      </section>

      <section className="bg-card rounded-3xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Line items ({lineItems.length})
          </h2>
          {isDraft && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingLineItem(true)}
            >
              Add item
            </Button>
          )}
        </div>

        {addingLineItem && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="text-muted-foreground mb-1 block text-xs">
                Name
              </label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Item name"
              />
            </div>
            <div className="w-32">
              <label className="text-muted-foreground mb-1 block text-xs">
                Price ($)
              </label>
              <Input
                type="number"
                step="0.01"
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddLineItem}
                disabled={addLineItem.isPending}
              >
                Add
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingLineItem(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {lineItems.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No line items yet.{" "}
            {isDraft
              ? "Add items to enable per-item claiming."
              : "This expense has no itemized breakdown — the total splits equally among trip members."}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {lineItems.map((item) => (
              <LineItemRow
                key={item.id}
                item={item}
                members={members}
                claimMode={claimMode}
                currentUserId={currentUserId}
                isOrganizer={isOrganizer}
                isDraft={isDraft}
                currency={expense.currency}
                pending={claimPending || removeLineItem.isPending}
                onToggleClaim={
                  !isDraft && claimMode === "tap"
                    ? handleToggleClaim
                    : undefined
                }
                onAssign={
                  !isDraft && claimMode === "organizer" && isOrganizer
                    ? handleAssign
                    : undefined
                }
                onRemove={isDraft ? handleRemoveLineItem : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <ExpenseSharesPanel
        shares={shares.shares}
        warnings={shares.warnings}
        payerUserId={expense.payerUserId}
        payerRoundingAbsorptionCents={shares.payerRoundingAbsorptionCents}
        members={members}
        currentUserId={currentUserId}
        currency={expense.currency}
      />
    </div>
  );
}

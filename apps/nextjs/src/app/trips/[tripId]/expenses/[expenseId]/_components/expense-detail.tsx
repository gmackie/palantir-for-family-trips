"use client";

import type { AppRouter } from "@gmacko/api";
import { Button } from "@gmacko/ui/button";
import { Input } from "@gmacko/ui/input";
import { Separator } from "@gmacko/ui/separator";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { useState } from "react";

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
  initialData: ExpenseGetOutput;
}) {
  const { tripId, workspaceId, expenseId, currentUserId } = props;
  const trpc = useTRPC();

  // Live data with realtime updates
  useExpenseRealtime({ expenseId, workspaceId, tripId });

  const { data } = useQuery({
    ...trpc.expenses.get.queryOptions({ workspaceId, tripId, expenseId }),
    initialData: props.initialData,
  });

  const expense = data.expense;
  const lineItems = data.lineItems;
  const shares = data.shares;
  const isDraft = expense.status === "draft";

  // Draft editing state
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftMerchant, setDraftMerchant] = useState(expense.merchant);
  const [draftSubtotal, setDraftSubtotal] = useState(
    (expense.subtotalCents / 100).toFixed(2),
  );
  const [draftTax, setDraftTax] = useState(
    (expense.taxCents / 100).toFixed(2),
  );
  const [draftTip, setDraftTip] = useState(
    (expense.tipCents / 100).toFixed(2),
  );
  const [draftTotal, setDraftTotal] = useState(
    (expense.totalCents / 100).toFixed(2),
  );

  // Line item adding state
  const [addingLineItem, setAddingLineItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  const updateDraft = useMutation(
    trpc.expenses.updateDraft.mutationOptions(),
  );
  const finalize = useMutation(
    trpc.expenses.finalize.mutationOptions(),
  );
  const addLineItem = useMutation(
    trpc.expenses.addLineItem.mutationOptions(),
  );
  const removeLineItem = useMutation(
    trpc.expenses.removeLineItem.mutationOptions(),
  );
  const claimLineItem = useMutation(
    trpc.expenses.claimLineItem.mutationOptions(),
  );
  const unclaimLineItem = useMutation(
    trpc.expenses.unclaimLineItem.mutationOptions(),
  );

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
    if (!newItemName || isNaN(priceCents)) return;

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

  return (
    <div className="space-y-8">
      {/* Header */}
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
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isDraft
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {expense.status}
            </span>
          </div>
        </div>

        <Button asChild variant="outline">
          <Link href={`/trips/${tripId}/expenses`}>Back to expenses</Link>
        </Button>
      </div>

      {/* Totals card */}
      <section className="bg-card rounded-3xl border p-6 shadow-sm">
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
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-xs">Subtotal</dt>
              <dd className="text-lg font-bold tabular-nums">
                {formatCents(expense.subtotalCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Tax</dt>
              <dd className="text-lg font-bold tabular-nums">
                {formatCents(expense.taxCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Tip</dt>
              <dd className="text-lg font-bold tabular-nums">
                {formatCents(expense.tipCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Total</dt>
              <dd className="text-lg font-bold tabular-nums">
                {formatCents(expense.totalCents)}
              </dd>
            </div>
          </dl>
        )}

        {isDraft && (
          <div className="mt-6">
            <Button
              onClick={handleFinalize}
              disabled={finalize.isPending}
            >
              {finalize.isPending ? "Finalizing..." : "Finalize expense"}
            </Button>
          </div>
        )}
      </section>

      {/* Line items */}
      <section className="bg-card rounded-3xl border p-6 shadow-sm">
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
              : "This expense has no itemized breakdown."}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {lineItems.map((item) => {
              const isClaimed = item.claimantUserIds.includes(currentUserId);
              const claimCount = item.claimantUserIds.length;

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {formatCents(item.lineTotalCents)}
                      {Number(item.quantity) > 1 &&
                        ` (x${item.quantity} @ ${formatCents(item.unitPriceCents)})`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {claimCount > 0 && (
                      <span className="text-muted-foreground text-xs">
                        {claimCount} claimed
                      </span>
                    )}

                    {!isDraft && (
                      <Button
                        variant={isClaimed ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleToggleClaim(item.id, isClaimed)}
                        disabled={
                          claimLineItem.isPending || unclaimLineItem.isPending
                        }
                      >
                        {isClaimed ? "Claimed" : "Claim"}
                      </Button>
                    )}

                    {isDraft && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveLineItem(item.id)}
                        disabled={removeLineItem.isPending}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Shares summary */}
      <section className="bg-card rounded-3xl border p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Shares</h2>

        {shares.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {shares.warnings.map((warning, i) => (
              <p
                key={i}
                className="text-xs text-amber-600 dark:text-amber-400"
              >
                {warning}
              </p>
            ))}
          </div>
        )}

        {shares.shares.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No shares computed yet.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {shares.shares.map((share) => (
              <div
                key={share.userId}
                className="flex items-center justify-between rounded-xl border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {share.userId === currentUserId
                      ? "You"
                      : share.userId.slice(0, 8)}
                    {share.userId === expense.payerUserId && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        (payer)
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    Sub {formatCents(share.subtotalCents)} + Tax{" "}
                    {formatCents(share.taxCents)} + Tip{" "}
                    {formatCents(share.tipCents)}
                  </p>
                </div>
                <p className="text-base font-bold tabular-nums">
                  {formatCents(share.totalCents)}
                </p>
              </div>
            ))}

            {shares.payerRoundingAbsorptionCents !== 0 && (
              <>
                <Separator />
                <p className="text-muted-foreground text-xs tabular-nums">
                  Payer absorbs{" "}
                  {formatCents(shares.payerRoundingAbsorptionCents)} in rounding
                </p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

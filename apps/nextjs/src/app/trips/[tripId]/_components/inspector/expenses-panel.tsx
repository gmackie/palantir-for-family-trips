"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

const STATUS_PILL: Record<string, string> = {
  draft: "bg-[#D29922]/20 text-[#D29922]",
  finalized: "bg-[#3FB950]/20 text-[#3FB950]",
};

export function ExpensesPanel(props: {
  tripId: string;
  workspaceId: string;
  currentUserId: string;
}) {
  const { tripId, workspaceId } = props;
  const trpc = useTRPC();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: expenses, isLoading } = useQuery(
    trpc.expenses.list.queryOptions({ workspaceId, tripId }),
  );

  const totalCents = expenses?.reduce((s, e) => s + (e.totalCents ?? 0), 0) ?? 0;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Expenses
        </h3>
        <Link
          href={`/trips/${tripId}/expenses/new`}
          className="rounded-[2px] bg-[#58A6FF]/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#58A6FF] hover:bg-[#58A6FF]/25 transition-colors"
        >
          + New
        </Link>
      </div>

      {/* Total bar */}
      <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
          Total Recorded
        </p>
        <p className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">
          {formatCents(totalCents)}
        </p>
        <p className="text-[10px] text-[#484F58]">
          {expenses?.length ?? 0} expense{(expenses?.length ?? 0) !== 1 ? "s" : ""}
        </p>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-xs text-[#484F58]">
          Loading expenses...
        </div>
      )}

      {!isLoading && expenses?.length === 0 && (
        <div className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-6 text-center">
          <p className="text-xs text-[#484F58]">No expenses recorded yet.</p>
        </div>
      )}

      {/* Expense cards */}
      {expenses?.map((expense) => {
        const isExpanded = expandedId === expense.id;

        return (
          <div key={expense.id} className="rounded-[4px] border border-[#21262D] bg-[#161B22]">
            <button
              onClick={() => setExpandedId(isExpanded ? null : expense.id)}
              className="flex w-full items-center justify-between p-3 text-left hover:bg-[#1C2128] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">
                    {expense.merchant}
                  </span>
                  <span
                    className={`shrink-0 rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_PILL[expense.status] ?? "bg-[#8B949E]/20 text-[#8B949E]"}`}
                  >
                    {expense.status}
                  </span>
                </div>
                <div className="mt-0.5 flex gap-3 text-[10px] text-[#484F58]">
                  <span className="capitalize">{expense.category}</span>
                  <span>{formatDate(expense.occurredAt)}</span>
                </div>
              </div>
              <span className="ml-3 shrink-0 font-mono text-base font-bold text-white tabular-nums">
                {formatCents(expense.totalCents)}
              </span>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-[#21262D] p-3">
                <Link
                  href={`/trips/${tripId}/expenses/${expense.id}`}
                  className="text-xs text-[#58A6FF] hover:underline"
                >
                  View full detail
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

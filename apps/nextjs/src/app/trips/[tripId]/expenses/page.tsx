import { Button } from "@gmacko/ui/button";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(date));
}

export default async function ExpensesListPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  try {
    const [trip, expenses] = await Promise.all([
      caller.trips.get({ workspaceId: workspace.id, tripId }),
      caller.expenses.list({ workspaceId: workspace.id, tripId }),
    ]);

    return (
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Expenses
            </p>
            <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              {expenses.length} expense{expenses.length !== 1 ? "s" : ""}{" "}
              recorded
            </p>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/trips/${tripId}`}>Back to trip</Link>
            </Button>
            <Button asChild>
              <Link href={`/trips/${tripId}/expenses/new`}>New expense</Link>
            </Button>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="bg-card mt-8 rounded-3xl border p-10 text-center shadow-sm">
            <p className="text-muted-foreground text-sm">
              No expenses yet. Add your first expense to start tracking.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4">
            {expenses.map((expense) => (
              <Link
                key={expense.id}
                href={`/trips/${tripId}/expenses/${expense.id}`}
                className="bg-card hover:bg-accent/50 flex items-center justify-between rounded-2xl border p-5 shadow-sm transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-3">
                    <h2 className="truncate text-base font-semibold">
                      {expense.merchant}
                    </h2>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        expense.status === "finalized"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {expense.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex gap-4 text-xs">
                    <span className="capitalize">{expense.category}</span>
                    <span>{formatDate(expense.occurredAt)}</span>
                  </div>
                </div>

                <p className="ml-4 shrink-0 text-lg font-bold tabular-nums">
                  {formatCents(expense.totalCents)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  }
}

"use client";

import type { AppRouter } from "@gmacko/api";
import { Button } from "@gmacko/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";

import { useTRPC } from "~/trpc/react";

type SummaryOutput = inferRouterOutputs<AppRouter>["settlements"]["summary"];
type HistoryOutput = inferRouterOutputs<AppRouter>["settlements"]["history"];

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(date));
}

function getMemberName(
  userId: string,
  members: SummaryOutput["members"],
): string {
  const member = members.find((m) => m.userId === userId);
  return member?.displayName ?? userId.slice(0, 8);
}

function getVenmoHandle(
  userId: string,
  members: SummaryOutput["members"],
): string | null {
  const member = members.find((m) => m.userId === userId);
  return member?.venmoHandle ?? null;
}

export function SettlementView(props: {
  tripId: string;
  tripName: string;
  workspaceId: string;
  currentUserId: string;
  initialSummary: SummaryOutput;
  initialHistory: HistoryOutput;
}) {
  const { tripId, tripName, workspaceId } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: summary } = useQuery({
    ...trpc.settlements.summary.queryOptions({ workspaceId, tripId }),
    initialData: props.initialSummary,
  });

  const { data: history } = useQuery({
    ...trpc.settlements.history.queryOptions({ workspaceId, tripId }),
    initialData: props.initialHistory,
  });

  const recordMutation = useMutation({
    ...trpc.settlements.record.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: trpc.settlements.summary.queryOptions({ workspaceId, tripId })
          .queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.settlements.history.queryOptions({ workspaceId, tripId })
          .queryKey,
      });
    },
  });

  const undoMutation = useMutation({
    ...trpc.settlements.undo.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: trpc.settlements.summary.queryOptions({ workspaceId, tripId })
          .queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.settlements.history.queryOptions({ workspaceId, tripId })
          .queryKey,
      });
    },
  });

  const { balances, suggestedTransactions, allSettled, members } = summary;

  function handleMarkPaid(tx: {
    fromUserId: string;
    toUserId: string;
    amountCents: number;
  }) {
    const fromName = getMemberName(tx.fromUserId, members);
    const toName = getMemberName(tx.toUserId, members);
    recordMutation.mutate({
      workspaceId,
      tripId,
      fromUserId: tx.fromUserId,
      toUserId: tx.toUserId,
      amountCents: tx.amountCents,
      idempotencyKey: crypto.randomUUID(),
      note: `${fromName} paid ${toName} ${formatCents(tx.amountCents)}`,
    });
  }

  function handleUndo(settlementId: string) {
    undoMutation.mutate({ workspaceId, tripId, settlementId });
  }

  function buildVenmoLink(
    handle: string,
    amountCents: number,
    note: string,
  ): string {
    const dollars = (amountCents / 100).toFixed(2);
    return `venmo://paycharge?txn=pay&recipients=${handle}&amount=${dollars}&note=${encodeURIComponent(note)}`;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
            Settle Up
          </p>
          <h1 className="text-4xl font-black tracking-tight">{tripName}</h1>
        </div>
        <Button asChild variant="outline">
          <Link href={`/trips/${tripId}`}>Back to trip</Link>
        </Button>
      </div>

      {/* All settled celebration */}
      {allSettled && (
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-10 text-center shadow-sm">
          <p className="text-3xl font-black">Everyone&apos;s square!</p>
          <p className="text-muted-foreground mt-2 text-sm">
            All debts have been settled. No outstanding balances.
          </p>
        </div>
      )}

      {/* Balance cards */}
      {!allSettled && balances.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Balances
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <div
                key={b.userId}
                className={`rounded-2xl border p-4 shadow-sm ${
                  b.amountCents > 0
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <p className="text-sm font-medium">
                  {getMemberName(b.userId, members)}
                </p>
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    b.amountCents > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {b.amountCents > 0 ? "+" : ""}
                  {formatCents(b.amountCents)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {b.amountCents > 0 ? "is owed" : "owes"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Suggested transactions */}
      {!allSettled && suggestedTransactions.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Suggested Payments
          </h2>
          <div className="space-y-3">
            {suggestedTransactions.map((tx, i) => {
              const venmoHandle = getVenmoHandle(tx.toUserId, members);
              const fromName = getMemberName(tx.fromUserId, members);
              const toName = getMemberName(tx.toUserId, members);
              return (
                <div
                  key={`${tx.fromUserId}-${tx.toUserId}-${i}`}
                  className="bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      <span className="font-semibold">{fromName}</span>
                      {" pays "}
                      <span className="font-semibold">{toName}</span>
                    </p>
                    <p className="text-xl font-bold tabular-nums">
                      {formatCents(tx.amountCents)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {venmoHandle && (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={buildVenmoLink(
                            venmoHandle,
                            tx.amountCents,
                            `${fromName} -> ${toName} (trip settle)`,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Venmo
                        </a>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={recordMutation.isPending}
                      onClick={() => handleMarkPaid(tx)}
                    >
                      {recordMutation.isPending ? "Recording..." : "Mark paid"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Settlement history */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          Settlement History
        </h2>
        {history.length === 0 ? (
          <div className="bg-card rounded-2xl border p-6 text-center shadow-sm">
            <p className="text-muted-foreground text-sm">
              No settlements recorded yet.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((s) => {
              const isUndone = s.undoneAt !== null;
              const hoursSinceSettled =
                (Date.now() - new Date(s.settledAt).getTime()) /
                (1000 * 60 * 60);
              const canUndo = !isUndone && hoursSinceSettled <= 24;

              return (
                <div
                  key={s.id}
                  className={`bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
                    isUndone ? "opacity-50" : ""
                  }`}
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      <span className="font-semibold">
                        {getMemberName(s.fromUserId, members)}
                      </span>
                      {" paid "}
                      <span className="font-semibold">
                        {getMemberName(s.toUserId, members)}
                      </span>
                      {" "}
                      <span className="font-bold tabular-nums">
                        {formatCents(s.amountCents)}
                      </span>
                    </p>
                    <div className="text-muted-foreground flex gap-3 text-xs">
                      <span>{formatDate(s.settledAt)}</span>
                      {s.note && <span>{s.note}</span>}
                      {isUndone && (
                        <span className="text-amber-600 dark:text-amber-400">
                          Undone
                        </span>
                      )}
                    </div>
                  </div>
                  {canUndo && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={undoMutation.isPending}
                      onClick={() => handleUndo(s.id)}
                    >
                      Undo
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

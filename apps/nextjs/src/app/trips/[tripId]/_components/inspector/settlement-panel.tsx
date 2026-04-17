"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getMemberName(
  userId: string,
  members: Array<{ userId: string; displayName: string | null }>,
): string {
  const member = members.find((m) => m.userId === userId);
  return member?.displayName ?? userId.slice(0, 8);
}

function getVenmoHandle(
  userId: string,
  members: Array<{ userId: string; venmoHandle: string | null }>,
): string | null {
  const member = members.find((m) => m.userId === userId);
  return member?.venmoHandle ?? null;
}

function buildVenmoLink(handle: string, amountCents: number, note: string): string {
  const dollars = (amountCents / 100).toFixed(2);
  return `venmo://paycharge?txn=pay&recipients=${handle}&amount=${dollars}&note=${encodeURIComponent(note)}`;
}

export function SettlementPanel(props: {
  tripId: string;
  workspaceId: string;
  currentUserId: string;
}) {
  const { tripId, workspaceId } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: summary, isLoading } = useQuery(
    trpc.settlements.summary.queryOptions({ workspaceId, tripId }),
  );

  const recordMutation = useMutation({
    ...trpc.settlements.record.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: trpc.settlements.summary.queryOptions({ workspaceId, tripId }).queryKey,
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4">
        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Settlement
        </h3>
        <p className="mt-4 text-xs text-[#484F58]">Loading...</p>
      </div>
    );
  }

  if (!summary) return null;

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

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
        Settlement
      </h3>

      {/* All settled celebration */}
      {allSettled && (
        <div className="rounded-[4px] border border-[#3FB950]/30 bg-[#3FB950]/10 p-4 text-center">
          <p className="text-sm font-bold text-[#3FB950]">
            Everyone&apos;s square!
          </p>
          <p className="mt-1 text-[10px] text-[#8B949E]">
            No outstanding balances.
          </p>
        </div>
      )}

      {/* Balance cards */}
      {!allSettled && balances.length > 0 && (
        <div>
          <h4 className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
            Balances
          </h4>
          <div className="space-y-1.5">
            {balances.map((b) => (
              <div
                key={b.userId}
                className={`flex items-center justify-between rounded-[4px] border p-3 ${
                  b.amountCents > 0
                    ? "border-[#3FB950]/20 bg-[#3FB950]/5"
                    : "border-[#F85149]/20 bg-[#F85149]/5"
                }`}
              >
                <span className="text-xs text-[#C9D1D9]">
                  {getMemberName(b.userId, members)}
                </span>
                <span
                  className={`font-mono text-sm font-bold tabular-nums ${
                    b.amountCents > 0 ? "text-[#3FB950]" : "text-[#F85149]"
                  }`}
                >
                  {b.amountCents > 0 ? "+" : ""}
                  {formatCents(b.amountCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested transactions */}
      {!allSettled && suggestedTransactions.length > 0 && (
        <div>
          <h4 className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-[#8B949E]">
            Suggested Payments
          </h4>
          <div className="space-y-2">
            {suggestedTransactions.map((tx, i) => {
              const fromName = getMemberName(tx.fromUserId, members);
              const toName = getMemberName(tx.toUserId, members);
              const venmoHandle = getVenmoHandle(tx.toUserId, members);

              return (
                <div
                  key={`${tx.fromUserId}-${tx.toUserId}-${i}`}
                  className="rounded-[4px] border border-[#21262D] bg-[#161B22] p-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-[#C9D1D9]">
                        <span className="font-medium">{fromName}</span>
                        <span className="text-[#484F58]"> pays </span>
                        <span className="font-medium">{toName}</span>
                      </p>
                      <p className="mt-0.5 font-mono text-base font-bold text-white tabular-nums">
                        {formatCents(tx.amountCents)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {venmoHandle && (
                      <a
                        href={buildVenmoLink(
                          venmoHandle,
                          tx.amountCents,
                          `${fromName} -> ${toName} (trip settle)`,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-[2px] border border-[#21262D] bg-[#0D1117] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#58A6FF] hover:bg-[#161B22] transition-colors"
                      >
                        Venmo
                      </a>
                    )}
                    <button
                      disabled={recordMutation.isPending}
                      onClick={() => handleMarkPaid(tx)}
                      className="rounded-[2px] bg-[#58A6FF]/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[#58A6FF] hover:bg-[#58A6FF]/25 transition-colors disabled:opacity-50"
                    >
                      {recordMutation.isPending ? "Recording..." : "Paid"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

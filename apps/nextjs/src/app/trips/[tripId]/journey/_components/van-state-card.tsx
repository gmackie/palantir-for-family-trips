"use client";

import { Button } from "@sortey/ui/button";
import { Input } from "@sortey/ui/input";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

// Resource → label + which way it moves (waste fills, supply drains).
const RESOURCES: { key: string; label: string; kind: "waste" | "supply" }[] = [
  { key: "grey", label: "Grey", kind: "waste" },
  { key: "black", label: "Black", kind: "waste" },
  { key: "fresh", label: "Fresh", kind: "supply" },
  { key: "propane", label: "Propane", kind: "supply" },
  { key: "fuel", label: "Fuel", kind: "supply" },
];

/**
 * Log van resource levels (grey/black/fresh/propane/fuel). The latest reading
 * per resource is the current level; the history teaches predictive service
 * alerts this van's real drain/fill rate — so alerts need no manual levels.
 */
export function VanStateCard({
  workspaceId,
  tripId,
}: {
  workspaceId: string;
  tripId: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const stateQuery = useQuery(
    trpc.daymap.vanState.queryOptions({ workspaceId, tripId }),
  );

  const record = useMutation(
    trpc.daymap.recordReading.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: trpc.daymap.vanState.queryKey({ workspaceId, tripId }),
        });
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const levels = stateQuery.data?.levels ?? {};
  const rates = stateQuery.data?.rates ?? {};

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
        Van state
      </div>
      <p className="text-sm text-[#8B949E]">
        Log tank &amp; supply levels. We learn your van&apos;s real drain rate
        so service alerts warn you before grey/black/fresh/propane run out.
      </p>

      <div className="flex flex-col gap-2">
        {RESOURCES.map((r) => (
          <ResourceRow
            key={r.key}
            label={r.label}
            kind={r.kind}
            level={(levels as Record<string, number>)[r.key]}
            rate={rates[r.key]}
            pending={record.isPending && record.variables?.resource === r.key}
            onLog={(pct) =>
              record.mutate({
                workspaceId,
                tripId,
                resource: r.key as "grey",
                levelPct: pct,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function ResourceRow({
  label,
  kind,
  level,
  rate,
  pending,
  onLog,
}: {
  label: string;
  kind: "waste" | "supply";
  level: number | undefined;
  rate: number | undefined;
  pending: boolean;
  onLog: (pct: number) => void;
}) {
  const [val, setVal] = useState("");

  // Waste (grey/black) is bad when high; supply (fresh/propane) bad when low.
  const warn =
    level != null && (kind === "waste" ? level >= 80 : level <= 20)
      ? "text-[#F85149]"
      : "text-[#3FB950]";

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 text-sm text-[#C9D1D9]">{label}</div>
      <div className={`w-24 font-mono text-xs ${warn}`}>
        {level != null ? `${level}%` : "—"}
        {rate != null ? (
          <span className="text-[#8B949E]"> · {rate}/d</span>
        ) : null}
      </div>
      <Input
        type="number"
        min={0}
        max={100}
        inputMode="numeric"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="0–100"
        className="w-24"
      />
      <Button
        type="button"
        variant="outline"
        disabled={pending || val.trim() === ""}
        onClick={() => {
          const pct = Number(val);
          if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            return;
          }
          onLog(pct);
          setVal("");
        }}
      >
        {pending ? "…" : "Log"}
      </Button>
    </div>
  );
}

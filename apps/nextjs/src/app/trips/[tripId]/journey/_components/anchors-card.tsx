"use client";

import { Button } from "@sortey/ui/button";
import { Input } from "@sortey/ui/input";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

const KINDS = ["event", "reservation", "lodging", "must_see"] as const;

/**
 * Fixed commitments (a conference, a booking, a family visit). The day-map
 * counts down to the next anchor and warns when you're too far to make it at
 * your current pace.
 */
export function AnchorsCard({
  workspaceId,
  tripId,
}: {
  workspaceId: string;
  tripId: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const listQuery = useQuery(
    trpc.anchors.list.queryOptions({ workspaceId, tripId }),
  );
  const nextQuery = useQuery(
    trpc.anchors.next.queryOptions({ workspaceId, tripId }),
  );

  function invalidate() {
    void qc.invalidateQueries({
      queryKey: trpc.anchors.list.queryKey({ workspaceId, tripId }),
    });
    void qc.invalidateQueries({
      queryKey: trpc.anchors.next.queryKey({ workspaceId, tripId }),
    });
  }

  const create = useMutation(
    trpc.anchors.create.mutationOptions({
      onSuccess: () => {
        toast.success("Anchor added");
        invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const del = useMutation(
    trpc.anchors.delete.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(e.message),
    }),
  );

  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("event");

  const anchors = listQuery.data ?? [];
  const next = nextQuery.data;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
        Anchors &amp; reservations
      </div>

      {next && (
        <div
          className={`rounded-md border p-2 text-sm ${
            next.behind
              ? "border-[#F85149] text-[#F85149]"
              : "border-[#21262D] text-[#C9D1D9]"
          }`}
        >
          📌 <b>{next.anchor.title}</b>{" "}
          {next.daysUntil <= 0 ? "today" : `in ${next.daysUntil}d`}
          {next.milesAway != null ? ` · ${next.milesAway} mi away` : ""}
          {next.behind ? ` — need ~${next.milesPerDay} mi/day` : ""}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {anchors.map((a) => (
          <div
            key={a.id as string}
            className="flex items-center justify-between gap-2 rounded-md border border-[#21262D] p-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm text-[#C9D1D9]">
                {a.title as string}
              </div>
              <div className="font-mono text-xs text-[#8B949E]">
                {a.startDate as string}
                {a.endDate ? `–${a.endDate as string}` : ""}
                {a.placeName ? ` · ${a.placeName as string}` : ""} ·{" "}
                {a.kind as string}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                del.mutate({
                  workspaceId,
                  tripId,
                  anchorId: a.id as string,
                })
              }
              className="shrink-0 text-xs text-[#8B949E] hover:text-[#F85149]"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-[#21262D] pt-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Open Sauce)"
        />
        <div className="flex flex-wrap gap-2">
          <Input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Place (optional)"
            className="min-w-[160px] flex-1"
          />
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-[170px]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                kind === k
                  ? "border-[#58A6FF] bg-[#58A6FF]/15 text-[#58A6FF]"
                  : "border-[#21262D] text-[#C9D1D9] hover:border-[#484F58]"
              }`}
            >
              {k.replace("_", " ")}
            </button>
          ))}
        </div>
        <Button
          type="button"
          disabled={create.isPending || !title.trim() || !date}
          onClick={() =>
            create.mutate({
              workspaceId,
              tripId,
              title: title.trim(),
              kind,
              placeName: place.trim() || null,
              startDate: date,
            })
          }
        >
          {create.isPending ? "Adding…" : "Add anchor"}
        </Button>
      </div>
    </div>
  );
}

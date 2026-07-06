"use client";

import { Button } from "@sortey/ui/button";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

/**
 * Publish a read-only public journal link for the trip. The shared page shows
 * only the traveled route/recap — never expenses, members, or private POIs.
 */
export function ShareCard({
  workspaceId,
  tripId,
}: {
  workspaceId: string;
  tripId: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  if (typeof window !== "undefined" && origin === "") {
    setOrigin(window.location.origin);
  }

  const shareQuery = useQuery(
    trpc.share.get.queryOptions({ workspaceId, tripId }),
  );

  function invalidate() {
    void qc.invalidateQueries({
      queryKey: trpc.share.get.queryKey({ workspaceId, tripId }),
    });
  }

  const enable = useMutation(
    trpc.share.enable.mutationOptions({
      onSuccess: () => {
        toast.success("Sharing on");
        invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const disable = useMutation(
    trpc.share.disable.mutationOptions({
      onSuccess: () => {
        toast.success("Sharing off");
        invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const share = shareQuery.data;
  const url =
    share && share.enabled && origin ? `${origin}/share/${share.token}` : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
        Share journal
      </div>
      <p className="text-sm text-[#8B949E]">
        A public read-only recap of the route so far — no expenses, members, or
        private POIs. Anyone with the link can view it.
      </p>

      {url ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              className="min-w-0 flex-1 rounded-md border border-[#21262D] bg-[#161B22] px-3 py-2 font-mono text-xs text-[#C9D1D9]"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                toast.success("Link copied");
              }}
            >
              Copy
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#58A6FF] hover:underline"
            >
              Open ↗
            </a>
            <button
              type="button"
              onClick={() => disable.mutate({ workspaceId, tripId })}
              disabled={disable.isPending}
              className="text-xs text-[#8B949E] hover:text-[#F85149]"
            >
              Turn off sharing
            </button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => enable.mutate({ workspaceId, tripId })}
            disabled={enable.isPending}
          >
            {enable.isPending ? "Enabling…" : "Create public link"}
          </Button>
        </div>
      )}
    </div>
  );
}

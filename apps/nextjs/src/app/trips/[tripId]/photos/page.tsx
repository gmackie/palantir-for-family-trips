import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import { requireTripsWorkspace } from "../../_lib/server";

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const REACTION_EMOJI: Record<string, string> = {
  heart: "❤️",
  fire: "🔥",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
};

export default async function PhotosPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace } = await requireTripsWorkspace();

  let photos;
  try {
    photos = await caller.photos.list({ workspaceId: workspace.id, tripId });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-4xl">📸</p>
        <h2 className="mt-4 text-lg font-bold text-[#C9D1D9]">No photos yet</h2>
        <p className="mt-2 max-w-xs text-sm text-[#8B949E]">
          Photos shared from the mobile app will appear here. Open Sortey on
          your phone to upload.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#C9D1D9]">Photos</h1>
        <span className="text-xs text-[#484F58]">
          {photos.length} photo{photos.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Grid view */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo) => {
          const reactionEntries = Object.entries(
            photo.reactions as Record<string, number>,
          ).filter(([, count]) => count > 0);

          return (
            <div
              key={photo.id}
              className="group relative overflow-hidden rounded-[4px] border border-[#21262D] bg-[#161B22]"
            >
              <img
                src={`/api/storage/${photo.storageKey}`}
                alt={photo.caption ?? "Trip photo"}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />

              {/* Hover overlay */}
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-transparent to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                <p className="text-xs font-semibold text-white">
                  {photo.displayName}
                </p>
                {photo.caption && (
                  <p className="mt-0.5 truncate text-xs text-white/80">
                    {photo.caption}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-white/50">
                  {formatTimeAgo(photo.takenAt ?? photo.uploadedAt)}
                </p>
                {reactionEntries.length > 0 && (
                  <div className="mt-1 flex gap-1">
                    {reactionEntries.map(([key, count]) => (
                      <span
                        key={key}
                        className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]"
                      >
                        {REACTION_EMOJI[key] ?? key} {count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

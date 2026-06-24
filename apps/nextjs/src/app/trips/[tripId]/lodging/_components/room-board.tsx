"use client";

import { Button } from "@sortey/ui/button";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useTRPC } from "~/trpc/react";

interface Member {
  userId: string;
  displayName: string | null;
  colorHex: string | null;
}

interface RoomBoardProps {
  workspaceId: string;
  tripId: string;
  lodgingId: string;
  members: Member[];
}

/**
 * Sleeping-arrangement board for a single lodging: named rooms, each with
 * occupant chips, plus an "unassigned" view. Interactive (assign/remove), so
 * it's a client island inside the server-rendered lodging page.
 */
export function RoomBoard({
  workspaceId,
  tripId,
  lodgingId,
  members,
}: RoomBoardProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newRoomLabel, setNewRoomLabel] = useState("");

  const base = { workspaceId, tripId };

  const roomsQuery = useQuery(
    trpc.rooms.listForLodging.queryOptions({ ...base, lodgingId }),
  );

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.rooms.pathFilter());

  const createRoom = useMutation(
    trpc.rooms.createRoom.mutationOptions({
      onSuccess: () => {
        setNewRoomLabel("");
        void invalidate();
      },
      onError: () => toast.error("Couldn't add room"),
    }),
  );
  const deleteRoom = useMutation(
    trpc.rooms.deleteRoom.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: () => toast.error("Couldn't remove room"),
    }),
  );
  const assignOccupant = useMutation(
    trpc.rooms.assignOccupant.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: () => toast.error("Couldn't assign"),
    }),
  );
  const removeOccupant = useMutation(
    trpc.rooms.removeOccupant.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: () => toast.error("Couldn't remove"),
    }),
  );

  const rooms = roomsQuery.data ?? [];

  const nameFor = useMemo(() => {
    const map = new Map(members.map((m) => [m.userId, m]));
    return (userId: string) => map.get(userId);
  }, [members]);

  const assignedUserIds = useMemo(() => {
    const s = new Set<string>();
    for (const room of rooms) {
      for (const o of room.occupants) s.add(o.userId);
    }
    return s;
  }, [rooms]);

  const unassigned = members.filter((m) => !assignedUserIds.has(m.userId));

  return (
    <div className="mt-3 border-t border-[#21262D] pt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B949E]">
          Rooms
        </p>
        <span className="font-mono text-[10px] tabular-nums text-[#8B949E]">
          {rooms.length} room{rooms.length !== 1 ? "s" : ""} ·{" "}
          {members.length - unassigned.length}/{members.length} placed
        </span>
      </div>

      {rooms.length === 0 && (
        <p className="text-xs text-[#8B949E]">No rooms yet.</p>
      )}

      <div className="space-y-2">
        {rooms.map((room) => {
          const occupantIds = new Set(room.occupants.map((o) => o.userId));
          const addable = members.filter((m) => !occupantIds.has(m.userId));
          return (
            <div
              key={room.id}
              className="rounded-[2px] border border-[#21262D] bg-[#0D1117] p-2"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#C9D1D9]">
                  {room.roomLabel}
                </p>
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wider text-[#8B949E] hover:text-[#F85149]"
                  onClick={() =>
                    deleteRoom.mutate({ ...base, roomId: room.id })
                  }
                >
                  Remove
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {room.occupants.length === 0 && (
                  <span className="text-[11px] text-[#8B949E]">Empty</span>
                )}
                {room.occupants.map((o) => {
                  const m = nameFor(o.userId);
                  return (
                    <span
                      key={o.userId}
                      className="inline-flex items-center gap-1 rounded-[2px] bg-[#21262D] px-1.5 py-0.5 text-[11px] text-[#C9D1D9]"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: m?.colorHex ?? "#58A6FF" }}
                      />
                      {m?.displayName ?? "Member"}
                      <button
                        type="button"
                        aria-label="Remove from room"
                        className="text-[#8B949E] hover:text-[#F85149]"
                        onClick={() =>
                          removeOccupant.mutate({
                            ...base,
                            roomId: room.id,
                            userId: o.userId,
                          })
                        }
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {addable.length > 0 && (
                  <select
                    aria-label="Assign member to room"
                    className="rounded-[2px] border border-[#21262D] bg-[#161B22] px-1 py-0.5 text-[11px] text-[#8B949E]"
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      assignOccupant.mutate({
                        ...base,
                        roomId: room.id,
                        userId: e.target.value,
                      });
                    }}
                  >
                    <option value="">+ assign…</option>
                    {addable.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName ?? "Member"}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unassigned.length > 0 && rooms.length > 0 && (
        <p className="mt-2 text-[11px] text-[#D29922]">
          Unassigned:{" "}
          {unassigned.map((m) => m.displayName ?? "Member").join(", ")}
        </p>
      )}

      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const label = newRoomLabel.trim();
          if (!label) return;
          createRoom.mutate({ ...base, lodgingId, roomLabel: label });
        }}
      >
        <input
          value={newRoomLabel}
          onChange={(e) => setNewRoomLabel(e.target.value)}
          placeholder="Room name (e.g. Master)"
          className="min-w-0 flex-1 rounded-[2px] border border-[#21262D] bg-[#161B22] px-2 py-1 text-xs text-[#C9D1D9] placeholder:text-[#8B949E]"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={createRoom.isPending || !newRoomLabel.trim()}
        >
          Add room
        </Button>
      </form>
    </div>
  );
}

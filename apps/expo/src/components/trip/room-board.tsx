import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";

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
 * Sleeping arrangements for one lodging: named rooms + occupant chips.
 * Mirrors the web RoomBoard against `rooms.*` tRPC procedures.
 */
export function RoomBoard({
  workspaceId,
  tripId,
  lodgingId,
  members,
}: RoomBoardProps) {
  const queryClient = useQueryClient();
  const [newRoomLabel, setNewRoomLabel] = useState("");
  const base = { workspaceId, tripId };

  const roomsQuery = useQuery({
    ...trpc.rooms.listForLodging.queryOptions({ ...base, lodgingId }),
    retry: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.rooms.pathFilter());

  const createRoom = useMutation(
    trpc.rooms.createRoom.mutationOptions({
      onSuccess: () => {
        setNewRoomLabel("");
        void invalidate();
      },
      onError: (err) => Alert.alert("Couldn't add room", err.message),
    }),
  );
  const deleteRoom = useMutation(
    trpc.rooms.deleteRoom.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (err) => Alert.alert("Couldn't remove room", err.message),
    }),
  );
  const assignOccupant = useMutation(
    trpc.rooms.assignOccupant.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (err) => Alert.alert("Couldn't assign", err.message),
    }),
  );
  const removeOccupant = useMutation(
    trpc.rooms.removeOccupant.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (err) => Alert.alert("Couldn't remove", err.message),
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

  const pickMemberToAssign = (roomId: string, addable: Member[]) => {
    if (addable.length === 0) return;
    Alert.alert(
      "Assign to room",
      "Who sleeps here?",
      [
        ...addable.map((m) => ({
          text: m.displayName ?? "Member",
          onPress: () =>
            assignOccupant.mutate({ ...base, roomId, userId: m.userId }),
        })),
        { text: "Cancel", style: "cancel" as const },
      ],
      { cancelable: true },
    );
  };

  return (
    <View
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: C.border,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            color: C.muted,
            fontSize: 10,
            fontWeight: "700",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          Rooms
        </Text>
        <Text style={{ color: C.muted, fontSize: 10, fontFamily: mono }}>
          {rooms.length} room{rooms.length !== 1 ? "s" : ""} ·{" "}
          {members.length - unassigned.length}/{members.length} placed
        </Text>
      </View>

      {roomsQuery.isLoading && (
        <ActivityIndicator size="small" color={C.muted} />
      )}

      {!roomsQuery.isLoading && rooms.length === 0 && (
        <Text style={{ color: C.muted, fontSize: 12 }}>No rooms yet.</Text>
      )}

      {rooms.map((room) => {
        const occupantIds = new Set(room.occupants.map((o) => o.userId));
        const addable = members.filter((m) => !occupantIds.has(m.userId));
        return (
          <View
            key={room.id}
            style={{
              backgroundColor: C.bg,
              borderRadius: R.sm,
              borderWidth: 1,
              borderColor: C.border,
              padding: 10,
              gap: 8,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: C.fg, fontSize: 13, fontWeight: "600" }}>
                {room.roomLabel}
              </Text>
              <Pressable
                onPress={() =>
                  Alert.alert("Remove room?", room.roomLabel, [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () =>
                        deleteRoom.mutate({ ...base, roomId: room.id }),
                    },
                  ])
                }
                hitSlop={8}
              >
                <Text
                  style={{
                    color: C.muted,
                    fontSize: 10,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Remove
                </Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {room.occupants.length === 0 && (
                <Text style={{ color: C.muted, fontSize: 12 }}>Empty</Text>
              )}
              {room.occupants.map((o) => {
                const m = nameFor(o.userId);
                return (
                  <Pressable
                    key={o.userId}
                    onPress={() =>
                      removeOccupant.mutate({
                        ...base,
                        roomId: room.id,
                        userId: o.userId,
                      })
                    }
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: C.surface,
                      borderRadius: R.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      minHeight: 32,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: m?.colorHex ?? C.info,
                      }}
                    />
                    <Text style={{ color: C.fg, fontSize: 12 }}>
                      {m?.displayName ?? "Member"}
                    </Text>
                    <Ionicons name="close" size={12} color={C.muted} />
                  </Pressable>
                );
              })}
              {addable.length > 0 && (
                <Pressable
                  onPress={() => pickMemberToAssign(room.id, addable)}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    borderRadius: R.sm,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    minHeight: 32,
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: C.muted, fontSize: 12 }}>
                    + assign…
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}

      {unassigned.length > 0 && rooms.length > 0 && (
        <Text style={{ color: C.warning, fontSize: 12 }}>
          Unassigned:{" "}
          {unassigned.map((m) => m.displayName ?? "Member").join(", ")}
        </Text>
      )}

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput
          value={newRoomLabel}
          onChangeText={setNewRoomLabel}
          placeholder="Room name (e.g. Master)"
          placeholderTextColor={C.muted}
          style={{
            flex: 1,
            minHeight: 44,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: R.sm,
            backgroundColor: C.bg,
            color: C.fg,
            paddingHorizontal: 10,
            fontSize: 13,
          }}
          onSubmitEditing={() => {
            const label = newRoomLabel.trim();
            if (!label || createRoom.isPending) return;
            createRoom.mutate({ ...base, lodgingId, roomLabel: label });
          }}
          returnKeyType="done"
        />
        <Pressable
          disabled={createRoom.isPending || !newRoomLabel.trim()}
          onPress={() => {
            const label = newRoomLabel.trim();
            if (!label) return;
            createRoom.mutate({ ...base, lodgingId, roomLabel: label });
          }}
          style={{
            minHeight: 44,
            paddingHorizontal: 14,
            borderRadius: R.sm,
            borderWidth: 1,
            borderColor: C.info,
            backgroundColor: C.infoBg,
            alignItems: "center",
            justifyContent: "center",
            opacity: createRoom.isPending || !newRoomLabel.trim() ? 0.5 : 1,
          }}
        >
          <Text style={{ color: C.info, fontSize: 13, fontWeight: "600" }}>
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

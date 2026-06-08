import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const REACTIONS = [
  { key: "heart" as const, emoji: "❤️" },
  { key: "fire" as const, emoji: "🔥" },
  { key: "laugh" as const, emoji: "😂" },
  { key: "wow" as const, emoji: "😮" },
];

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type PhotoItem = {
  id: string;
  userId: string;
  storageKey: string;
  caption: string | null;
  takenAt: Date | null;
  uploadedAt: Date;
  displayName: string | null;
  colorHex: string | null;
  reactions: Record<string, number>;
  myReaction: string | null;
};

interface UploadJob {
  uri: string;
  status: "pending" | "uploading" | "done" | "error";
}

function FullScreenViewer({
  photos,
  initialIndex,
  onClose,
}: {
  photos: PhotoItem[];
  initialIndex: number;
  onClose: () => void;
}) {
  const flatListRef = useRef<FlatList>(null);

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <FlatList
          ref={flatListRef}
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={{
                width: SCREEN_WIDTH,
                height: SCREEN_HEIGHT,
                justifyContent: "center",
              }}
            >
              <Image
                source={{
                  uri: `${getBaseUrl()}/api/storage/${item.storageKey}`,
                }}
                style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.7 }}
                resizeMode="contain"
              />
              <View
                style={{
                  position: "absolute",
                  bottom: 80,
                  left: 16,
                  right: 16,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: "600",
                  }}
                >
                  {item.displayName}
                </Text>
                {item.caption && (
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.8)",
                      fontSize: 14,
                      marginTop: 4,
                    }}
                  >
                    {item.caption}
                  </Text>
                )}
                <Text
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {item.takenAt
                    ? new Date(item.takenAt).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : ""}
                </Text>
              </View>
            </View>
          )}
        />

        {/* Top bar */}
        <View
          style={{
            position: "absolute",
            top: 60,
            left: 16,
            right: 16,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Pressable
            onPress={onClose}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: "rgba(0,0,0,0.5)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => Alert.alert("Saved", "Photo saved to camera roll.")}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: "rgba(0,0,0,0.5)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="download-outline" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function PhotosScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();
  const [uploadQueue, setUploadQueue] = useState<UploadJob[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"feed" | "grid">("feed");
  const uploadingRef = useRef(false);

  const { data: photos, isLoading } = useQuery(
    trpc.photos.list.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const uploadMutation = useMutation(
    trpc.photos.upload.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.photos.list.queryFilter());
      },
    }),
  );

  const reactMutation = useMutation(
    trpc.photos.react.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.photos.list.queryFilter());
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.photos.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.photos.list.queryFilter());
      },
    }),
  );

  const processQueue = useCallback(
    async (jobs: UploadJob[]) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;
      const cookies = authClient.getCookie();

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i]!;
        if (job.status !== "pending") continue;

        setUploadQueue((prev) =>
          prev.map((j, idx) => (idx === i ? { ...j, status: "uploading" } : j)),
        );

        try {
          const response = await new Promise<{ ok: boolean; text: string }>(
            (resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open("POST", `${getBaseUrl()}/api/receipts/upload`);
              if (cookies) xhr.setRequestHeader("Cookie", cookies);
              xhr.onload = () =>
                resolve({
                  ok: xhr.status >= 200 && xhr.status < 300,
                  text: xhr.responseText,
                });
              xhr.onerror = () => reject(new Error("Upload failed"));

              const formData = new FormData();
              formData.append("file", {
                uri: job.uri,
                name: "photo.jpg",
                type: "image/jpeg",
              } as unknown as Blob);
              xhr.send(formData);
            },
          );

          if (response.ok) {
            const data = JSON.parse(response.text) as {
              storageKey?: string;
            };
            if (data.storageKey) {
              await uploadMutation.mutateAsync({
                workspaceId,
                tripId: tripId ?? "",
                storageKey: data.storageKey,
              });
            }
          }

          setUploadQueue((prev) =>
            prev.map((j, idx) => (idx === i ? { ...j, status: "done" } : j)),
          );
        } catch {
          setUploadQueue((prev) =>
            prev.map((j, idx) => (idx === i ? { ...j, status: "error" } : j)),
          );
        }
      }

      uploadingRef.current = false;
      setTimeout(() => setUploadQueue([]), 2000);
    },
    [workspaceId, tripId, uploadMutation],
  );

  const handlePickPhotos = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 20,
      exif: false,
    });

    if (result.canceled || result.assets.length === 0) return;

    const jobs: UploadJob[] = result.assets.map((a) => ({
      uri: a.uri,
      status: "pending" as const,
    }));

    setUploadQueue(jobs);
    void processQueue(jobs);
  }, [processQueue]);

  const activeUploads = uploadQueue.filter(
    (j) => j.status === "pending" || j.status === "uploading",
  );
  const doneUploads = uploadQueue.filter((j) => j.status === "done");

  const GRID_GAP = 2;
  const GRID_COLS = 3;
  const GRID_SIZE =
    (SCREEN_WIDTH - 32 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Photos",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
          headerRight: () => (
            <Pressable
              onPress={() => setViewMode(viewMode === "feed" ? "grid" : "feed")}
              style={{ marginRight: 8, padding: 4 }}
            >
              <Ionicons
                name={viewMode === "feed" ? "grid-outline" : "list-outline"}
                size={22}
                color={C.fg}
              />
            </Pressable>
          ),
        }}
      />

      {/* Upload progress bar */}
      {uploadQueue.length > 0 && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
            backgroundColor: C.surface,
          }}
        >
          {activeUploads.length > 0 ? (
            <>
              <ActivityIndicator size="small" color={C.info} />
              <Text style={{ color: C.fg, fontSize: 13, flex: 1 }}>
                Uploading {doneUploads.length + 1} of {uploadQueue.length}...
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color={C.success} />
              <Text style={{ color: C.success, fontSize: 13, flex: 1 }}>
                {uploadQueue.length} photo
                {uploadQueue.length !== 1 ? "s" : ""} uploaded
              </Text>
            </>
          )}

          {/* Thumbnail strip */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {uploadQueue.map((job, i) => (
              <View key={i} style={{ marginLeft: i > 0 ? 4 : 0 }}>
                <Image
                  source={{ uri: job.uri }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 4,
                    opacity: job.status === "done" ? 1 : 0.5,
                  }}
                />
                {job.status === "uploading" && (
                  <View
                    style={{
                      position: "absolute",
                      inset: 0,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ActivityIndicator size="small" color={C.white} />
                  </View>
                )}
                {job.status === "done" && (
                  <View
                    style={{
                      position: "absolute",
                      bottom: -2,
                      right: -2,
                    }}
                  >
                    <Ionicons
                      name="checkmark-circle"
                      size={14}
                      color={C.success}
                    />
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" color={C.muted} />
        </View>
      ) : !photos || photos.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
            gap: 12,
          }}
        >
          <Ionicons name="images-outline" size={48} color={C.muted} />
          <Text style={{ color: C.fg, fontSize: 18, fontWeight: "600" }}>
            Share trip photos
          </Text>
          <Text
            style={{
              color: C.muted,
              fontSize: 14,
              textAlign: "center",
              lineHeight: 20,
            }}
          >
            Upload full-quality photos from your camera roll. They will be
            automatically organized by when they were taken.
          </Text>
        </View>
      ) : viewMode === "grid" ? (
        <FlatList
          data={photos}
          numColumns={GRID_COLS}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          columnWrapperStyle={{ gap: GRID_GAP }}
          ItemSeparatorComponent={() => <View style={{ height: GRID_GAP }} />}
          renderItem={({ item, index }) => (
            <Pressable onPress={() => setViewerIndex(index)}>
              <Image
                source={{
                  uri: `${getBaseUrl()}/api/storage/${item.storageKey}`,
                }}
                style={{
                  width: GRID_SIZE,
                  height: GRID_SIZE,
                  borderRadius: 2,
                }}
                resizeMode="cover"
              />
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          renderItem={({ item, index }) => {
            const color = item.colorHex ?? C.info;

            return (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.surface,
                  borderRadius: R.md,
                  overflow: "hidden",
                }}
              >
                {/* Header */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 10,
                    gap: 8,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: `${color}22`,
                      borderWidth: 2,
                      borderColor: color,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color,
                        fontSize: 9,
                        fontWeight: "700",
                        fontFamily: mono,
                      }}
                    >
                      {getInitials(item.displayName)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 13,
                      fontWeight: "600",
                      flex: 1,
                    }}
                  >
                    {item.displayName}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 11 }}>
                    {timeAgo(item.takenAt ?? item.uploadedAt)}
                  </Text>
                </View>

                {/* Photo */}
                <Pressable onPress={() => setViewerIndex(index)}>
                  <Image
                    source={{
                      uri: `${getBaseUrl()}/api/storage/${item.storageKey}`,
                    }}
                    style={{
                      width: SCREEN_WIDTH - 34,
                      height: (SCREEN_WIDTH - 34) * 0.75,
                    }}
                    resizeMode="cover"
                  />
                </Pressable>

                {/* Caption + reactions */}
                <View style={{ padding: 10, gap: 6 }}>
                  {item.caption && (
                    <Text style={{ color: C.fg, fontSize: 14 }}>
                      {item.caption}
                    </Text>
                  )}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {REACTIONS.map((r) => {
                      const count = item.reactions[r.key] ?? 0;
                      const isActive = item.myReaction === r.key;
                      return (
                        <Pressable
                          key={r.key}
                          onPress={() =>
                            reactMutation.mutate({
                              workspaceId,
                              tripId: tripId ?? "",
                              photoId: item.id,
                              reaction: r.key,
                            })
                          }
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 2,
                            paddingHorizontal: 6,
                            paddingVertical: 4,
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: isActive ? C.info : C.border,
                            backgroundColor: isActive
                              ? `${C.info}15`
                              : "transparent",
                            minHeight: 28,
                          }}
                        >
                          <Text style={{ fontSize: 13 }}>{r.emoji}</Text>
                          {count > 0 && (
                            <Text
                              style={{
                                color: isActive ? C.info : C.muted,
                                fontSize: 10,
                                fontWeight: "600",
                                fontFamily: mono,
                              }}
                            >
                              {count}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                    <View style={{ flex: 1 }} />
                    {item.userId ===
                      authClient.useSession?.()?.data?.user?.id && (
                      <Pressable
                        onPress={() =>
                          Alert.alert("Delete?", "", [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () =>
                                deleteMutation.mutate({
                                  workspaceId,
                                  tripId: tripId ?? "",
                                  photoId: item.id,
                                }),
                            },
                          ])
                        }
                        style={{ padding: 4 }}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color={C.muted}
                        />
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Bottom action bar */}
      <View
        style={{
          position: "absolute",
          bottom: 32,
          left: 16,
          right: 16,
          flexDirection: "row",
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => void handlePickPhotos()}
          disabled={activeUploads.length > 0}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: C.info,
            borderRadius: R.md,
            paddingVertical: 14,
            minHeight: 52,
            opacity: activeUploads.length > 0 ? 0.5 : 1,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 2,
            elevation: 2,
          }}
        >
          <Ionicons name="images" size={18} color={C.white} />
          <Text style={{ color: C.white, fontSize: 15, fontWeight: "600" }}>
            Add Photos
          </Text>
        </Pressable>
      </View>

      {/* Full-screen viewer */}
      {viewerIndex !== null && photos && (
        <FullScreenViewer
          photos={photos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </View>
  );
}

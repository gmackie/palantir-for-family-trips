import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useShareIntent } from "expo-share-intent";
import { useEffect } from "react";
import { Alert } from "react-native";

import { trpc } from "./api";
import { authClient } from "./auth";
import { getBaseUrl } from "./base-url";
import { getActiveWorkspaceId } from "./workspace-store";

export function useShareIntentHandler(tripId: string | undefined) {
  const { shareIntent, resetShareIntent } = useShareIntent();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation(
    trpc.photos.upload.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.photos.list.queryFilter());
      },
    }),
  );

  useEffect(() => {
    const files = shareIntent?.files;
    if (!files?.length || !tripId) return;

    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) return;

    const cookies = authClient.getCookie();

    void (async () => {
      let uploaded = 0;
      for (const file of files) {
        if (!file.path) continue;

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
                uri: file.path,
                name: "shared-photo.jpg",
                type: file.mimeType ?? "image/jpeg",
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
                tripId,
                storageKey: data.storageKey,
              });
              uploaded++;
            }
          }
        } catch {
          // skip failed uploads
        }
      }

      if (uploaded > 0) {
        Alert.alert(
          "Photos shared",
          `${uploaded} photo${uploaded !== 1 ? "s" : ""} added to your trip`,
        );
      }

      resetShareIntent();
    })();
  }, [shareIntent, tripId, uploadMutation, resetShareIntent]);
}

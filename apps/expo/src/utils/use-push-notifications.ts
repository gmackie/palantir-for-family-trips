import { useMutation } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { trpc } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushNotifications() {
  const registered = useRef(false);
  const registerMutation = useMutation(
    trpc.notifications.registerPushToken.mutationOptions({}),
  );

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;

    void (async () => {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") return;

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: "5f21337f-9f48-4b0c-8d02-656e4a08dc86",
      });

      registerMutation.mutate({
        token: tokenData.data,
        platform: Platform.OS === "ios" ? "ios" : "android",
      });
    })();
  }, [registerMutation]);
}

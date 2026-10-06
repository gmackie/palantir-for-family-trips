import { useMutation } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { trpc } from "./api";
import { authClient } from "./auth";
import { createPushRegistration } from "./push-registration";

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
  const { data: session, isPending } = authClient.useSession();
  const registration = useRef(createPushRegistration());
  const { mutateAsync: register } = useMutation(
    trpc.notifications.registerPushToken.mutationOptions({}),
  );
  const userId = isPending ? null : (session?.user.id ?? null);

  useEffect(() => {
    const attempt = registration.current.start(userId, {
      async getToken() {
        const { status: existing } = await Notifications.getPermissionsAsync();
        const finalStatus =
          existing === "granted"
            ? existing
            : (await Notifications.requestPermissionsAsync()).status;
        if (finalStatus !== "granted") return null;
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: "5f21337f-9f48-4b0c-8d02-656e4a08dc86",
        });
        return tokenData.data;
      },
      async register(token) {
        await register({
          token,
          platform: Platform.OS === "ios" ? "ios" : "android",
        });
      },
    });
    return attempt.cancel;
  }, [userId, register]);
}

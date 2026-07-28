import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { captureOutbox } from "~/utils/capture-outbox-native";
import { C, mono, R } from "~/utils/design";
import { fuelOutbox } from "~/utils/fuel-outbox-native";
import { journeyOutbox } from "~/utils/journey-outbox-native";
import { useNetworkStatus } from "~/utils/network-status";

/**
 * Global connectivity + pending-sync strip. Mount once under the root Stack.
 */
export function OfflineBanner({
  onSync,
  syncing,
}: {
  onSync?: () => void;
  syncing?: boolean;
}) {
  const { online } = useNetworkStatus();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function count() {
      const [fuel, journey, capture] = await Promise.all([
        fuelOutbox.pendingCount(),
        journeyOutbox.list().then((l) => l.length),
        captureOutbox.pendingCount(),
      ]);
      if (!cancelled) setPending(fuel + journey + capture);
    }
    void count();
    const t = setInterval(() => void count(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [online, syncing]);

  if (online && pending === 0) return null;

  return (
    <View
      style={{
        backgroundColor: online ? C.warningBg : "rgba(248,81,73,0.18)",
        borderBottomWidth: 1,
        borderBottomColor: online ? C.warning + "55" : C.critical + "55",
        paddingHorizontal: 14,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Ionicons
        name={online ? "cloud-upload-outline" : "cloud-offline-outline"}
        size={16}
        color={online ? C.warning : C.critical}
      />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: online ? C.warning : C.critical,
            fontSize: 12,
            fontWeight: "700",
          }}
        >
          {online
            ? `${pending} change${pending === 1 ? "" : "s"} waiting to sync`
            : "You're offline"}
        </Text>
        {!online && pending > 0 && (
          <Text style={{ color: C.muted, fontSize: 11, fontFamily: mono }}>
            {pending} queued · will send when back online
          </Text>
        )}
      </View>
      {online && pending > 0 && onSync ? (
        <Pressable
          onPress={onSync}
          disabled={syncing}
          style={{
            borderWidth: 1,
            borderColor: C.warning + "88",
            borderRadius: R.sm,
            paddingHorizontal: 10,
            paddingVertical: 6,
            minHeight: 32,
            justifyContent: "center",
            opacity: syncing ? 0.5 : 1,
          }}
        >
          <Text style={{ color: C.warning, fontSize: 12, fontWeight: "700" }}>
            {syncing ? "Syncing…" : "Sync now"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

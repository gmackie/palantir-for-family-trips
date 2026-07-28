import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { C, mono, R } from "~/utils/design";

export interface PlanChromeProps {
  tonightPlace?: string | null;
  tonightKind?: string | null;
  nextNights?: Array<{ date: string; place: string }>;
  nextAnchorTitle?: string | null;
  nextAnchorDate?: string | null;
  facts?: string[];
  offline?: boolean;
  onOpenMap?: () => void;
}

export function PlanChrome({
  tonightPlace,
  tonightKind,
  nextNights,
  nextAnchorTitle,
  nextAnchorDate,
  facts,
  offline,
  onOpenMap,
}: PlanChromeProps) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: C.border,
        backgroundColor: C.surface,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          style={{
            color: C.muted,
            fontSize: 10,
            fontWeight: "800",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            fontFamily: mono,
          }}
        >
          Plan{offline ? " · offline seeds" : ""}
        </Text>
        {onOpenMap ? (
          <Pressable
            onPress={onOpenMap}
            hitSlop={10}
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
          >
            <Ionicons name="map-outline" size={14} color={C.info} />
            <Text style={{ color: C.info, fontSize: 12, fontWeight: "700" }}>
              Map
            </Text>
          </Pressable>
        ) : null}
      </View>

      {tonightPlace ? (
        <Text style={{ color: C.fg, fontSize: 15, fontWeight: "700" }}>
          Tonight · {tonightPlace}
          {tonightKind ? (
            <Text style={{ color: C.muted, fontWeight: "500" }}>
              {" "}
              · {tonightKind.replace("_", " ")}
            </Text>
          ) : null}
        </Text>
      ) : (
        <Text style={{ color: C.muted, fontSize: 14 }}>
          No tonight locked — ask co-pilot in chat
        </Text>
      )}

      {nextNights && nextNights.length > 0 ? (
        <Text style={{ color: C.muted, fontSize: 12, lineHeight: 17 }}>
          {nextNights
            .slice(0, 4)
            .map((n) => `${n.date.slice(5)} ${n.place}`)
            .join(" · ")}
        </Text>
      ) : null}

      {nextAnchorTitle ? (
        <Text
          style={{
            color: C.warning,
            fontSize: 11,
            fontFamily: mono,
            fontWeight: "600",
          }}
        >
          Anchor · {nextAnchorTitle}
          {nextAnchorDate ? ` ${nextAnchorDate}` : ""}
        </Text>
      ) : null}

      {facts && facts.length > 0 ? (
        <Text style={{ color: C.info, fontSize: 11, fontFamily: mono }}>
          {facts.slice(0, 3).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

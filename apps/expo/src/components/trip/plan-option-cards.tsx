import { Pressable, Text, View } from "react-native";

import type { PlanOption } from "@sortey/api/copilot";
import { C, mono, R } from "~/utils/design";

export function PlanOptionCards({
  options,
  recommendedId,
  appliedId,
  onApply,
}: {
  options: PlanOption[];
  recommendedId?: string;
  appliedId?: string | null;
  onApply?: (option: PlanOption) => void;
}) {
  if (options.length === 0) return null;

  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      {options.map((opt) => {
        const rec = opt.id === recommendedId || opt.recommended;
        const applied = opt.id === appliedId;
        return (
          <View
            key={opt.id}
            style={{
              borderWidth: 1,
              borderColor: applied
                ? C.success
                : rec
                  ? C.info
                  : C.border,
              backgroundColor: C.bg,
              borderRadius: R.md,
              padding: 12,
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
                  color: C.fg,
                  fontSize: 14,
                  fontWeight: "800",
                  flex: 1,
                }}
              >
                {rec ? "★ " : ""}
                {opt.title}
              </Text>
              {applied ? (
                <Text
                  style={{
                    color: C.success,
                    fontSize: 10,
                    fontWeight: "800",
                    textTransform: "uppercase",
                  }}
                >
                  Applied
                </Text>
              ) : null}
            </View>
            <Text style={{ color: C.muted, fontSize: 13, lineHeight: 18 }}>
              {opt.summary}
            </Text>
            <Text style={{ color: C.placeholder, fontSize: 11, fontFamily: mono }}>
              {opt.costs.totalDriveHours.toFixed(1)}h total · max day{" "}
              {opt.costs.maxDayDriveHours.toFixed(1)}h · hike{" "}
              {opt.costs.hikeQuality}/3 · heat {opt.costs.heatRisk}/3 · anchor
              risk {opt.costs.anchorRisk}/3
            </Text>
            {opt.nights.length > 0 ? (
              <Text style={{ color: C.muted, fontSize: 11 }}>
                {opt.nights
                  .map((n) => `${n.date.slice(5)} ${n.place}`)
                  .join(" → ")}
              </Text>
            ) : null}
            <Text style={{ color: C.warning, fontSize: 11 }}>
              Cut if behind: {opt.cutIfBehind}
            </Text>
            {onApply && !applied ? (
              <Pressable
                onPress={() => onApply(opt)}
                style={{
                  alignSelf: "flex-start",
                  marginTop: 4,
                  backgroundColor: rec ? C.info : C.surface,
                  borderWidth: 1,
                  borderColor: rec ? C.info : C.border,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  minHeight: 40,
                  justifyContent: "center",
                  borderRadius: R.md,
                }}
              >
                <Text
                  style={{
                    color: rec ? C.white : C.info,
                    fontWeight: "800",
                    fontSize: 13,
                  }}
                >
                  Apply to plan chrome
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

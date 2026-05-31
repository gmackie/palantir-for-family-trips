import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

import { C, R } from "~/utils/design";

export function SkeletonLine({
  width = "100%" as `${number}%`,
  height = 14,
}: {
  width?: number | `${number}%`;
  height?: number;
}) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: R.sm,
        backgroundColor: C.border,
        opacity,
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 16,
        gap: 10,
      }}
    >
      <SkeletonLine width="60%" height={16} />
      <SkeletonLine width="80%" />
      <SkeletonLine width="40%" />
    </View>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: 12, padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

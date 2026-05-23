import { useQuery } from "@tanstack/react-query";
import { Stack, useGlobalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { trpc } from "~/utils/api";

const C = {
  bg: "#141116",
  fg: "#f9f7fb",
  primary: "#d66daa",
} as const;

export default function Post() {
  const { id } = useGlobalSearchParams<{ id: string }>();
  const { data } = useQuery(trpc.post.byId.queryOptions({ id }));

  if (!data) return null;

  return (
    <View style={{ backgroundColor: C.bg }}>
      <Stack.Screen options={{ title: data.title }} />
      <View style={{ height: "100%", width: "100%", padding: 16 }}>
        <Text
          style={{
            color: C.primary,
            paddingVertical: 8,
            fontSize: 30,
            fontWeight: "bold",
          }}
        >
          {data.title}
        </Text>
        <Text style={{ color: C.fg, paddingVertical: 16 }}>{data.content}</Text>
      </View>
    </View>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { C, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const RESPONSE_STYLES: Record<string, { bg: string; text: string }> = {
  yes: { bg: C.success, text: C.white },
  no: { bg: C.critical, text: C.white },
  maybe: { bg: C.warning, text: "#000" },
  prefer: { bg: C.info, text: C.white },
};

export default function PollsScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const queryClient = useQueryClient();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const [expandedPollId, setExpandedPollId] = useState<string | null>(null);

  const { data: polls, isLoading } = useQuery(
    trpc.planning.listPolls.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const voteMutation = useMutation(
    trpc.planning.vote.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.planning.listPolls.queryFilter(),
        );
      },
    }),
  );

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Stack.Screen
          options={{
            title: "Polls",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Polls & Planning",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      {!polls || polls.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: C.muted, fontSize: 18, marginBottom: 8 }}>
            No polls yet
          </Text>
          <Text style={{ color: C.muted, fontSize: 15, textAlign: "center" }}>
            Polls help your group decide on dates, activities, and more.
          </Text>
        </View>
      ) : (
        <FlatList
          data={polls}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          renderItem={({ item: poll }) => {
            const isExpanded = expandedPollId === poll.id;
            const totalVotes = poll.options.reduce(
              (sum, opt) => sum + (opt.voteCount ?? 0),
              0,
            );

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
                <Pressable
                  onPress={() => setExpandedPollId(isExpanded ? null : poll.id)}
                  style={{ padding: 16, minHeight: 48 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}
                      >
                        {poll.title}
                      </Text>
                      <Text
                        style={{ color: C.muted, fontSize: 12, marginTop: 4 }}
                      >
                        {poll.pollType.replace("_", " ")} | {totalVotes} vote
                        {totalVotes !== 1 ? "s" : ""} | {poll.status}
                      </Text>
                    </View>
                    <Text style={{ color: C.muted, fontSize: 18 }}>
                      {isExpanded ? "−" : "+"}
                    </Text>
                  </View>
                </Pressable>

                {isExpanded && (
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: C.border,
                      paddingHorizontal: 16,
                      paddingBottom: 16,
                      paddingTop: 12,
                    }}
                  >
                    {poll.options.map((option) => (
                      <View
                        key={option.id}
                        style={{
                          borderWidth: 1,
                          borderColor: C.border,
                          borderRadius: R.md,
                          padding: 12,
                          marginBottom: 12,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 8,
                          }}
                        >
                          <Text
                            style={{ color: C.fg, fontWeight: "500", flex: 1 }}
                          >
                            {option.label}
                          </Text>
                          <Text style={{ color: C.muted, fontSize: 12 }}>
                            {option.voteCount ?? 0} votes
                          </Text>
                        </View>
                        {option.description && (
                          <Text
                            style={{
                              color: C.muted,
                              fontSize: 15,
                              marginBottom: 8,
                            }}
                          >
                            {option.description}
                          </Text>
                        )}

                        {poll.status === "open" && (
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            {(
                              Object.entries(RESPONSE_STYLES) as Array<
                                [string, { bg: string; text: string }]
                              >
                            ).map(([response, style]) => (
                              <Pressable
                                key={response}
                                onPress={() => {
                                  voteMutation.mutate({
                                    workspaceId,
                                    tripId: tripId ?? "",
                                    pollOptionId: option.id,
                                    response: response as
                                      | "yes"
                                      | "no"
                                      | "maybe"
                                      | "prefer",
                                  });
                                }}
                                disabled={voteMutation.isPending}
                                style={{
                                  backgroundColor: style.bg,
                                  borderRadius: R.md,
                                  paddingHorizontal: 12,
                                  paddingVertical: 8,
                                  minHeight: 44,
                                  justifyContent: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    color: style.text,
                                    fontSize: 12,
                                    fontWeight: "600",
                                    textAlign: "center",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  {response}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

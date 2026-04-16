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
import { SafeAreaView } from "react-native-safe-area-context";

import { trpc } from "~/utils/api";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

const RESPONSE_LABELS: Record<string, { label: string; color: string }> = {
  yes: { label: "Yes", color: "bg-green-500" },
  no: { label: "No", color: "bg-red-500" },
  maybe: { label: "Maybe", color: "bg-yellow-500" },
  prefer: { label: "Prefer", color: "bg-blue-500" },
};

export default function PollsScreen() {
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
      <SafeAreaView className="bg-background flex-1">
        <Stack.Screen options={{ title: "Polls" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="bg-background flex-1">
      <Stack.Screen options={{ title: "Polls & Planning" }} />

      {!polls || polls.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-muted-foreground mb-2 text-lg">
            No polls yet
          </Text>
          <Text className="text-muted-foreground text-center text-sm">
            Polls help your group decide on dates, activities, and more.
          </Text>
        </View>
      ) : (
        <FlatList
          data={polls}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View className="h-4" />}
          renderItem={({ item: poll }) => {
            const isExpanded = expandedPollId === poll.id;
            const totalVotes = poll.options.reduce(
              (sum, opt) => sum + (opt.voteCount ?? 0),
              0,
            );

            return (
              <View className="border-border bg-card rounded-lg border">
                {/* Poll header */}
                <Pressable
                  onPress={() =>
                    setExpandedPollId(isExpanded ? null : poll.id)
                  }
                  className="p-4"
                  style={{ minHeight: 48 }}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className="text-foreground text-base font-semibold">
                        {poll.title}
                      </Text>
                      <Text className="text-muted-foreground mt-1 text-xs">
                        {poll.pollType.replace("_", " ")} | {totalVotes} vote
                        {totalVotes !== 1 ? "s" : ""} | {poll.status}
                      </Text>
                    </View>
                    <Text className="text-muted-foreground text-lg">
                      {isExpanded ? "−" : "+"}
                    </Text>
                  </View>
                </Pressable>

                {/* Expanded poll options with voting */}
                {isExpanded && (
                  <View className="border-border border-t px-4 pb-4 pt-3">
                    {poll.options.map((option) => (
                      <View
                        key={option.id}
                        className="border-border mb-3 rounded-md border p-3"
                      >
                        <View className="mb-2 flex-row items-center justify-between">
                          <Text className="text-foreground flex-1 font-medium">
                            {option.label}
                          </Text>
                          <Text className="text-muted-foreground text-xs">
                            {option.voteCount ?? 0} votes
                          </Text>
                        </View>
                        {option.description && (
                          <Text className="text-muted-foreground mb-2 text-sm">
                            {option.description}
                          </Text>
                        )}

                        {/* Vote buttons */}
                        {poll.status === "open" && (
                          <View className="flex-row gap-2">
                            {(
                              Object.entries(RESPONSE_LABELS) as Array<
                                [
                                  string,
                                  { label: string; color: string },
                                ]
                              >
                            ).map(([response, meta]) => (
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
                                className={`rounded-md px-3 py-2 ${meta.color}`}
                                style={{ minHeight: 44, justifyContent: "center" }}
                              >
                                <Text className="text-center text-xs font-medium text-white">
                                  {meta.label}
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
    </SafeAreaView>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

type Tab = "polls" | "proposals";

const VOTE_BUTTONS = [
  {
    key: "yes" as const,
    label: "Yes",
    icon: "checkmark-circle" as const,
    color: C.success,
  },
  {
    key: "no" as const,
    label: "No",
    icon: "close-circle" as const,
    color: C.critical,
  },
  {
    key: "maybe" as const,
    label: "Maybe",
    icon: "help-circle" as const,
    color: C.warning,
  },
];

const REACTION_BUTTONS = [
  { key: "up" as const, icon: "thumbs-up" as const, label: "Like" },
  { key: "down" as const, icon: "thumbs-down" as const, label: "Pass" },
  { key: "interested" as const, icon: "star" as const, label: "Interested" },
  { key: "booked" as const, icon: "checkmark-done" as const, label: "Booked" },
];

const PROPOSAL_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  activity: "bicycle-outline",
  lodging: "bed-outline",
  flight: "airplane-outline",
  car_rental: "car-outline",
  other: "ellipsis-horizontal-circle-outline",
};

const PROPOSAL_STATUS_COLORS: Record<string, string> = {
  proposed: C.muted,
  selected: C.info,
  booked: C.success,
  rejected: C.critical,
};

const POLL_TYPES = [
  { key: "single_choice" as const, label: "Single choice" },
  { key: "multi_choice" as const, label: "Multi choice" },
  { key: "ranked" as const, label: "Ranked" },
] as const;

const PROPOSAL_TYPES = [
  {
    key: "activity" as const,
    label: "Activity",
    icon: "bicycle-outline" as const,
  },
  { key: "lodging" as const, label: "Lodging", icon: "bed-outline" as const },
  {
    key: "flight" as const,
    label: "Flight",
    icon: "airplane-outline" as const,
  },
  {
    key: "car_rental" as const,
    label: "Car Rental",
    icon: "car-outline" as const,
  },
  {
    key: "other" as const,
    label: "Other",
    icon: "ellipsis-horizontal-circle-outline" as const,
  },
] as const;

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: C.muted,
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6,
      }}
    >
      {children}
    </Text>
  );
}

function CreatePollModal({
  visible,
  onClose,
  onSubmit,
  isPending,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    pollType: "single_choice" | "multi_choice" | "ranked";
    options: string[];
  }) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [pollType, setPollType] = useState<
    "single_choice" | "multi_choice" | "ranked"
  >("single_choice");
  const [options, setOptions] = useState(["", ""]);

  const reset = () => {
    setTitle("");
    setPollType("single_choice");
    setOptions(["", ""]);
  };

  const validOptions = options.filter((o) => o.trim().length > 0);
  const canSubmit = title.trim().length > 0 && validOptions.length >= 2;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}
        >
          <Pressable
            onPress={() => {
              reset();
              onClose();
            }}
            style={{ minWidth: 60 }}
          >
            <Text style={{ color: C.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={{ color: C.fg, fontSize: 17, fontWeight: "600" }}>
            New Poll
          </Text>
          <View style={{ minWidth: 60 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <SectionLabel>Question</SectionLabel>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="What should we do on Saturday?"
                placeholderTextColor={C.placeholder}
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.surface,
                  borderRadius: R.md,
                  padding: 14,
                  color: C.fg,
                  fontSize: 16,
                }}
              />
            </View>

            <View>
              <SectionLabel>Poll Type</SectionLabel>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {POLL_TYPES.map((pt) => (
                  <Pressable
                    key={pt.key}
                    onPress={() => setPollType(pt.key)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: R.md,
                      alignItems: "center",
                      minHeight: 44,
                      justifyContent: "center",
                      ...(pollType === pt.key
                        ? { backgroundColor: C.info }
                        : { borderWidth: 1, borderColor: C.border }),
                    }}
                  >
                    <Text
                      style={{
                        color: pollType === pt.key ? C.white : C.fg,
                        fontSize: 13,
                        fontWeight: "500",
                      }}
                    >
                      {pt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View>
              <SectionLabel>Options</SectionLabel>
              {options.map((opt, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginBottom: 8,
                    alignItems: "center",
                  }}
                >
                  <TextInput
                    value={opt}
                    onChangeText={(v) => {
                      const next = [...options];
                      next[i] = v;
                      setOptions(next);
                    }}
                    placeholder={`Option ${i + 1}`}
                    placeholderTextColor={C.placeholder}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: C.border,
                      backgroundColor: C.surface,
                      borderRadius: R.md,
                      padding: 12,
                      color: C.fg,
                      fontSize: 15,
                    }}
                  />
                  {options.length > 2 && (
                    <Pressable
                      onPress={() =>
                        setOptions(options.filter((_, j) => j !== i))
                      }
                      style={{
                        minHeight: 44,
                        minWidth: 36,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="close-circle" size={18} color={C.muted} />
                    </Pressable>
                  )}
                </View>
              ))}
              <Pressable
                onPress={() => setOptions([...options, ""])}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderStyle: "dashed",
                  paddingVertical: 12,
                  minHeight: 44,
                }}
              >
                <Ionicons name="add-circle-outline" size={16} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 14 }}>Add Option</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <View
          style={{
            padding: 16,
            paddingBottom: 36,
            borderTopWidth: 1,
            borderTopColor: C.border,
          }}
        >
          <Pressable
            onPress={() => {
              onSubmit({
                title: title.trim(),
                pollType,
                options: validOptions,
              });
              reset();
            }}
            disabled={!canSubmit || isPending}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              opacity: !canSubmit || isPending ? 0.5 : 1,
            }}
          >
            {isPending ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
                Create Poll
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function CreateProposalModal({
  visible,
  onClose,
  onSubmit,
  isPending,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    proposalType: "activity" | "lodging" | "flight" | "car_rental" | "other";
    description?: string;
    url?: string;
    priceCents?: number;
  }) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [proposalType, setProposalType] = useState<
    "activity" | "lodging" | "flight" | "car_rental" | "other"
  >("activity");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");

  const reset = () => {
    setTitle("");
    setProposalType("activity");
    setDescription("");
    setUrl("");
    setPrice("");
  };

  const canSubmit = title.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}
        >
          <Pressable
            onPress={() => {
              reset();
              onClose();
            }}
            style={{ minWidth: 60 }}
          >
            <Text style={{ color: C.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={{ color: C.fg, fontSize: 17, fontWeight: "600" }}>
            New Proposal
          </Text>
          <View style={{ minWidth: 60 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <SectionLabel>Type</SectionLabel>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -4 }}
              >
                {PROPOSAL_TYPES.map((pt) => {
                  const active = proposalType === pt.key;
                  return (
                    <Pressable
                      key={pt.key}
                      onPress={() => setProposalType(pt.key)}
                      style={{
                        marginHorizontal: 4,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: R.md,
                        minHeight: 44,
                        ...(active
                          ? { backgroundColor: C.info }
                          : { borderWidth: 1, borderColor: C.border }),
                      }}
                    >
                      <Ionicons
                        name={pt.icon}
                        size={16}
                        color={active ? C.white : C.muted}
                      />
                      <Text
                        style={{
                          color: active ? C.white : C.fg,
                          fontSize: 14,
                          fontWeight: "500",
                        }}
                      >
                        {pt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View>
              <SectionLabel>Title</SectionLabel>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Kayaking at Lake Manawa"
                placeholderTextColor={C.placeholder}
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.surface,
                  borderRadius: R.md,
                  padding: 14,
                  color: C.fg,
                  fontSize: 16,
                }}
              />
            </View>

            <View>
              <SectionLabel>Description (optional)</SectionLabel>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Details, notes, timing..."
                placeholderTextColor={C.placeholder}
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.surface,
                  borderRadius: R.md,
                  padding: 14,
                  color: C.fg,
                  fontSize: 15,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
              />
            </View>

            <View>
              <SectionLabel>Link (optional)</SectionLabel>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://..."
                placeholderTextColor={C.placeholder}
                autoCapitalize="none"
                keyboardType="url"
                style={{
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.surface,
                  borderRadius: R.md,
                  padding: 14,
                  color: C.fg,
                  fontSize: 15,
                }}
              />
            </View>

            <View>
              <SectionLabel>Estimated cost (optional)</SectionLabel>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: C.border,
                  backgroundColor: C.surface,
                  borderRadius: R.md,
                  paddingHorizontal: 12,
                }}
              >
                <Text style={{ color: C.muted, fontSize: 16 }}>$</Text>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  placeholder="0.00"
                  placeholderTextColor={C.placeholder}
                  keyboardType="decimal-pad"
                  style={{
                    flex: 1,
                    color: C.fg,
                    paddingVertical: 12,
                    textAlign: "right",
                    fontFamily: mono,
                    fontSize: 16,
                  }}
                />
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <View
          style={{
            padding: 16,
            paddingBottom: 36,
            borderTopWidth: 1,
            borderTopColor: C.border,
          }}
        >
          <Pressable
            onPress={() => {
              const priceCents = price
                ? Math.round(Number.parseFloat(price) * 100)
                : undefined;
              onSubmit({
                title: title.trim(),
                proposalType,
                description: description.trim() || undefined,
                url: url.trim() || undefined,
                priceCents:
                  priceCents && !Number.isNaN(priceCents)
                    ? priceCents
                    : undefined,
              });
              reset();
            }}
            disabled={!canSubmit || isPending}
            style={{
              backgroundColor: C.info,
              borderRadius: R.md,
              paddingVertical: 16,
              alignItems: "center",
              opacity: !canSubmit || isPending ? 0.5 : 1,
            }}
          >
            {isPending ? (
              <ActivityIndicator color={C.white} />
            ) : (
              <Text style={{ color: C.white, fontSize: 16, fontWeight: "600" }}>
                Submit Proposal
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function PollsScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const queryClient = useQueryClient();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const [activeTab, setActiveTab] = useState<Tab>("polls");
  const [expandedPollId, setExpandedPollId] = useState<string | null>(null);
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);

  const { data: polls, isLoading: pollsLoading } = useQuery(
    trpc.planning.listPolls.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const { data: proposals, isLoading: proposalsLoading } = useQuery(
    trpc.planning.listProposals.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries(trpc.planning.listPolls.queryFilter());
    void queryClient.invalidateQueries(
      trpc.planning.listProposals.queryFilter(),
    );
  }, [queryClient]);

  const voteMutation = useMutation(
    trpc.planning.vote.mutationOptions({ onSuccess: invalidateAll }),
  );

  const createPollMutation = useMutation(
    trpc.planning.createPoll.mutationOptions({
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const addOptionMutation = useMutation(
    trpc.planning.addPollOption.mutationOptions({
      onSuccess: invalidateAll,
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const createProposalMutation = useMutation(
    trpc.planning.createProposal.mutationOptions({
      onSuccess: invalidateAll,
      onError: (err) => Alert.alert("Error", err.message),
    }),
  );

  const reactMutation = useMutation(
    trpc.planning.reactToProposal.mutationOptions({
      onSuccess: invalidateAll,
    }),
  );

  const handleCreatePoll = useCallback(
    async (data: {
      title: string;
      pollType: "single_choice" | "multi_choice" | "ranked";
      options: string[];
    }) => {
      const poll = await createPollMutation.mutateAsync({
        workspaceId,
        tripId: tripId ?? "",
        title: data.title,
        pollType: data.pollType,
      });
      for (let i = 0; i < data.options.length; i++) {
        await addOptionMutation.mutateAsync({
          workspaceId,
          tripId: tripId ?? "",
          pollId: poll.id,
          label: data.options[i]!,
          sortOrder: i,
        });
      }
      invalidateAll();
      setShowCreatePoll(false);
    },
    [workspaceId, tripId, createPollMutation, addOptionMutation, invalidateAll],
  );

  const handleCreateProposal = useCallback(
    (data: {
      title: string;
      proposalType: "activity" | "lodging" | "flight" | "car_rental" | "other";
      description?: string;
      url?: string;
      priceCents?: number;
    }) => {
      createProposalMutation.mutate({
        workspaceId,
        tripId: tripId ?? "",
        ...data,
      });
      setShowCreateProposal(false);
    },
    [workspaceId, tripId, createProposalMutation],
  );

  const isLoading = activeTab === "polls" ? pollsLoading : proposalsLoading;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Polls & Planning",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />

      {/* Tab bar */}
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}
      >
        {(["polls", "proposals"] as const).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={{
              flex: 1,
              paddingVertical: 14,
              alignItems: "center",
              borderBottomWidth: 2,
              borderBottomColor: activeTab === tab ? C.info : "transparent",
            }}
          >
            <Text
              style={{
                color: activeTab === tab ? C.fg : C.muted,
                fontSize: 15,
                fontWeight: activeTab === tab ? "600" : "400",
                textTransform: "capitalize",
              }}
            >
              {tab}
              {tab === "polls" && polls
                ? ` (${polls.length})`
                : tab === "proposals" && proposals
                  ? ` (${proposals.length})`
                  : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator size="large" color={C.muted} />
        </View>
      ) : activeTab === "polls" ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        >
          {!polls || polls.length === 0 ? (
            <View
              style={{
                alignItems: "center",
                paddingVertical: 48,
                gap: 8,
              }}
            >
              <Ionicons name="bar-chart-outline" size={36} color={C.muted} />
              <Text style={{ color: C.muted, fontSize: 16 }}>No polls yet</Text>
              <Text
                style={{
                  color: C.muted,
                  fontSize: 13,
                  textAlign: "center",
                  maxWidth: 260,
                }}
              >
                Create a poll to help the group decide on activities,
                restaurants, or timing.
              </Text>
            </View>
          ) : (
            polls.map((poll) => {
              const isExpanded = expandedPollId === poll.id;
              const totalVotes = poll.options.reduce(
                (sum, opt) => sum + (opt.voteCount ?? 0),
                0,
              );
              const maxVotes = Math.max(
                ...poll.options.map((o) => o.voteCount ?? 0),
                1,
              );

              return (
                <View
                  key={poll.id}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.surface,
                    borderRadius: R.md,
                    overflow: "hidden",
                    marginBottom: 12,
                  }}
                >
                  <Pressable
                    onPress={() =>
                      setExpandedPollId(isExpanded ? null : poll.id)
                    }
                    style={{ padding: 16, minHeight: 48 }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <Ionicons
                        name={
                          poll.status === "open"
                            ? "radio-button-on"
                            : "checkmark-circle"
                        }
                        size={20}
                        color={poll.status === "open" ? C.info : C.success}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: C.fg,
                            fontSize: 15,
                            fontWeight: "600",
                          }}
                        >
                          {poll.title}
                        </Text>
                        <Text
                          style={{
                            color: C.muted,
                            fontSize: 12,
                            marginTop: 2,
                          }}
                        >
                          {poll.options.length} options &middot; {totalVotes}{" "}
                          vote{totalVotes !== 1 ? "s" : ""} &middot;{" "}
                          {poll.status}
                        </Text>
                      </View>
                      <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={C.muted}
                      />
                    </View>
                  </Pressable>

                  {isExpanded && (
                    <View
                      style={{
                        borderTopWidth: 1,
                        borderTopColor: C.border,
                        padding: 16,
                        gap: 10,
                      }}
                    >
                      {poll.options.map((option) => {
                        const barWidth =
                          maxVotes > 0
                            ? ((option.voteCount ?? 0) / maxVotes) * 100
                            : 0;
                        return (
                          <View key={option.id}>
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text
                                style={{
                                  color: C.fg,
                                  fontSize: 14,
                                  fontWeight: "500",
                                  flex: 1,
                                }}
                              >
                                {option.label}
                              </Text>
                              <Text
                                style={{
                                  color: C.muted,
                                  fontSize: 12,
                                  fontFamily: mono,
                                }}
                              >
                                {option.voteCount ?? 0}
                              </Text>
                            </View>
                            {option.description && (
                              <Text
                                style={{
                                  color: C.muted,
                                  fontSize: 12,
                                  marginBottom: 6,
                                }}
                              >
                                {option.description}
                              </Text>
                            )}
                            <View
                              style={{
                                height: 6,
                                backgroundColor: C.border,
                                borderRadius: 3,
                                overflow: "hidden",
                                marginBottom: 8,
                              }}
                            >
                              <View
                                style={{
                                  height: "100%",
                                  width: `${barWidth}%`,
                                  backgroundColor: C.info,
                                  borderRadius: 3,
                                }}
                              />
                            </View>

                            {poll.status === "open" && (
                              <View
                                style={{
                                  flexDirection: "row",
                                  gap: 8,
                                  marginBottom: 4,
                                }}
                              >
                                {VOTE_BUTTONS.map((btn) => (
                                  <Pressable
                                    key={btn.key}
                                    onPress={() =>
                                      voteMutation.mutate({
                                        workspaceId,
                                        tripId: tripId ?? "",
                                        pollOptionId: option.id,
                                        response: btn.key,
                                      })
                                    }
                                    disabled={voteMutation.isPending}
                                    style={{
                                      flexDirection: "row",
                                      alignItems: "center",
                                      gap: 4,
                                      paddingHorizontal: 10,
                                      paddingVertical: 6,
                                      borderRadius: R.sm,
                                      borderWidth: 1,
                                      borderColor: C.border,
                                      minHeight: 36,
                                    }}
                                  >
                                    <Ionicons
                                      name={btn.icon}
                                      size={14}
                                      color={btn.color}
                                    />
                                    <Text
                                      style={{
                                        color: C.fg,
                                        fontSize: 12,
                                        fontWeight: "500",
                                      }}
                                    >
                                      {btn.label}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        >
          {!proposals || proposals.length === 0 ? (
            <View
              style={{
                alignItems: "center",
                paddingVertical: 48,
                gap: 8,
              }}
            >
              <Ionicons name="bulb-outline" size={36} color={C.muted} />
              <Text style={{ color: C.muted, fontSize: 16 }}>
                No proposals yet
              </Text>
              <Text
                style={{
                  color: C.muted,
                  fontSize: 13,
                  textAlign: "center",
                  maxWidth: 260,
                }}
              >
                Propose activities, restaurants, or lodging for the group to
                react to.
              </Text>
            </View>
          ) : (
            proposals.map((proposal) => {
              const typeIcon =
                PROPOSAL_TYPE_ICONS[proposal.proposalType] ??
                "ellipsis-horizontal-circle-outline";
              const statusColor =
                PROPOSAL_STATUS_COLORS[proposal.status] ?? C.muted;
              const reactionCounts = (proposal.reactionCounts ?? {}) as Record<
                string,
                number
              >;

              return (
                <View
                  key={proposal.id}
                  style={{
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.surface,
                    borderRadius: R.md,
                    padding: 16,
                    marginBottom: 12,
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <Ionicons name={typeIcon} size={20} color={C.muted} />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: C.fg,
                          fontSize: 15,
                          fontWeight: "600",
                        }}
                      >
                        {proposal.title}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          marginTop: 4,
                        }}
                      >
                        <Text
                          style={{
                            color: statusColor,
                            fontSize: 12,
                            fontWeight: "600",
                            textTransform: "uppercase",
                          }}
                        >
                          {proposal.status}
                        </Text>
                        {proposal.priceCents != null && (
                          <Text
                            style={{
                              color: C.muted,
                              fontSize: 12,
                              fontFamily: mono,
                            }}
                          >
                            ${(proposal.priceCents / 100).toFixed(2)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>

                  {proposal.description && (
                    <Text style={{ color: C.muted, fontSize: 13 }}>
                      {proposal.description}
                    </Text>
                  )}

                  {proposal.url && (
                    <Text
                      style={{ color: C.info, fontSize: 12 }}
                      numberOfLines={1}
                    >
                      {proposal.url}
                    </Text>
                  )}

                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {REACTION_BUTTONS.map((btn) => {
                      const count = reactionCounts[btn.key] ?? 0;
                      return (
                        <Pressable
                          key={btn.key}
                          onPress={() =>
                            reactMutation.mutate({
                              workspaceId,
                              tripId: tripId ?? "",
                              proposalId: proposal.id,
                              reaction: btn.key,
                            })
                          }
                          disabled={reactMutation.isPending}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: R.sm,
                            borderWidth: 1,
                            borderColor: count > 0 ? C.info : C.border,
                            backgroundColor:
                              count > 0 ? `${C.info}15` : "transparent",
                            minHeight: 36,
                          }}
                        >
                          <Ionicons
                            name={btn.icon}
                            size={14}
                            color={count > 0 ? C.info : C.muted}
                          />
                          {count > 0 && (
                            <Text
                              style={{
                                color: C.info,
                                fontSize: 12,
                                fontWeight: "600",
                                fontFamily: mono,
                              }}
                            >
                              {count}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* FAB */}
      <Pressable
        onPress={() =>
          activeTab === "polls"
            ? setShowCreatePoll(true)
            : setShowCreateProposal(true)
        }
        style={{
          position: "absolute",
          bottom: 36,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: C.info,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <Ionicons name="add" size={28} color={C.white} />
      </Pressable>

      <CreatePollModal
        visible={showCreatePoll}
        onClose={() => setShowCreatePoll(false)}
        onSubmit={(data) => void handleCreatePoll(data)}
        isPending={createPollMutation.isPending || addOptionMutation.isPending}
      />

      <CreateProposalModal
        visible={showCreateProposal}
        onClose={() => setShowCreateProposal(false)}
        onSubmit={handleCreateProposal}
        isPending={createProposalMutation.isPending}
      />
    </View>
  );
}

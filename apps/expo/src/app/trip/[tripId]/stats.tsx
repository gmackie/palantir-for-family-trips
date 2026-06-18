import { Ionicons } from "@expo/vector-icons";
import { formatMoney as formatCurrency } from "@sortey/validators/money";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

function StatBox({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 14,
        gap: 6,
        minWidth: 140,
      }}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text
        style={{
          color: C.fg,
          fontSize: 20,
          fontWeight: "700",
          fontFamily: mono,
        }}
      >
        {value}
      </Text>
      <Text style={{ color: C.muted, fontSize: 11, fontWeight: "600" }}>
        {label}
      </Text>
    </View>
  );
}

function BarRow({
  label,
  value,
  maxValue,
  color,
}: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <View style={{ gap: 4, marginBottom: 10 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          style={{ color: C.fg, fontSize: 13, fontWeight: "500", flex: 1 }}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text style={{ color: C.muted, fontSize: 12, fontFamily: mono }}>
          {formatCurrency(value)}
        </Text>
      </View>
      <View
        style={{
          height: 8,
          backgroundColor: C.border,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: color,
            borderRadius: 4,
          }}
        />
      </View>
    </View>
  );
}

export default function StatsScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";

  const { data: expenses, isLoading: expensesLoading } = useQuery(
    trpc.expenses.list.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const { data: settlement } = useQuery(
    trpc.settlements.summary.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const { data: members } = useQuery(
    trpc.trips.listMembers.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
    }),
  );

  const stats = useMemo(() => {
    if (!expenses || !members) return null;

    const totalCents = expenses.reduce(
      (sum, e) => sum + (e.totalCents ?? 0),
      0,
    );
    const expenseCount = expenses.length;
    const memberCount = members.length;
    const perPersonCents =
      memberCount > 0 ? Math.round(totalCents / memberCount) : 0;

    const byPayer: Record<string, { name: string; totalCents: number }> = {};
    for (const exp of expenses) {
      const uid = exp.payerUserId;
      if (!byPayer[uid]) {
        const m = members.find((mem) => mem.userId === uid);
        byPayer[uid] = {
          name: m?.displayName ?? uid.slice(0, 8),
          totalCents: 0,
        };
      }
      byPayer[uid].totalCents += exp.totalCents ?? 0;
    }
    const payerRanking = Object.values(byPayer).sort(
      (a, b) => b.totalCents - a.totalCents,
    );

    const byMerchant: Record<string, number> = {};
    for (const exp of expenses) {
      const cat = exp.merchant ?? "Other";
      byMerchant[cat] = (byMerchant[cat] ?? 0) + (exp.totalCents ?? 0);
    }
    const merchantRanking = Object.entries(byMerchant)
      .map(([name, cents]) => ({ name, totalCents: cents }))
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 10);

    const CATEGORY_LABELS: Record<string, string> = {
      meal: "Meals",
      transit: "Transit",
      lodging: "Lodging",
      activity: "Activities",
      drinks: "Drinks",
      tickets: "Tickets",
      general: "General",
      fuel: "Fuel",
      camping: "Camping",
    };
    const byExpenseCategory: Record<string, number> = {};
    for (const exp of expenses) {
      const label = CATEGORY_LABELS[exp.category] ?? exp.category;
      byExpenseCategory[label] =
        (byExpenseCategory[label] ?? 0) + (exp.totalCents ?? 0);
    }
    const categoryRanking = Object.entries(byExpenseCategory)
      .map(([name, cents]) => ({ name, totalCents: cents }))
      .sort((a, b) => b.totalCents - a.totalCents);

    const avgExpenseCents =
      expenseCount > 0 ? Math.round(totalCents / expenseCount) : 0;

    const largestExpense = expenses.reduce(
      (max, e) => ((e.totalCents ?? 0) > (max?.totalCents ?? 0) ? e : max),
      expenses[0],
    );

    return {
      totalCents,
      expenseCount,
      memberCount,
      perPersonCents,
      avgExpenseCents,
      payerRanking,
      categoryRanking,
      merchantRanking,
      largestExpense,
    };
  }, [expenses, members]);

  if (expensesLoading) {
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
            title: "Trip Stats",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <ActivityIndicator size="large" color={C.muted} />
      </View>
    );
  }

  if (!stats) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <Stack.Screen
          options={{
            title: "Trip Stats",
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.fg,
          }}
        />
        <Ionicons name="bar-chart-outline" size={36} color={C.muted} />
        <Text style={{ color: C.muted, fontSize: 16 }}>No expenses yet</Text>
      </View>
    );
  }

  const COLORS = [
    C.info,
    "#56D364",
    "#D2A8FF",
    "#F97316",
    "#F472B6",
    "#6CB6FF",
    "#FBBF24",
    "#7EE787",
    "#BC8CFF",
    "#B1BAC4",
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Trip Stats",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }}
      >
        {/* Overview cards */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <StatBox
            label="TOTAL SPENT"
            value={formatCurrency(stats.totalCents)}
            icon="wallet-outline"
            color={C.info}
          />
          <StatBox
            label="PER PERSON"
            value={formatCurrency(stats.perPersonCents)}
            icon="person-outline"
            color="#56D364"
          />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <StatBox
            label="EXPENSES"
            value={String(stats.expenseCount)}
            icon="receipt-outline"
            color="#D2A8FF"
          />
          <StatBox
            label="AVG EXPENSE"
            value={formatCurrency(stats.avgExpenseCents)}
            icon="trending-up-outline"
            color="#F97316"
          />
        </View>

        {/* Largest expense */}
        {stats.largestExpense && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
              borderRadius: R.md,
              padding: 14,
              gap: 4,
            }}
          >
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Biggest Expense
            </Text>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ color: C.fg, fontSize: 16, fontWeight: "600" }}>
                {stats.largestExpense.merchant ?? "Unknown"}
              </Text>
              <Text
                style={{
                  color: C.fg,
                  fontSize: 18,
                  fontWeight: "700",
                  fontFamily: mono,
                }}
              >
                {formatCurrency(stats.largestExpense.totalCents ?? 0)}
              </Text>
            </View>
          </View>
        )}

        {/* Who paid the most */}
        {stats.payerRanking.length > 0 && (
          <View>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 10,
              }}
            >
              Who Paid
            </Text>
            {stats.payerRanking.map((p, i) => (
              <BarRow
                key={p.name}
                label={p.name}
                value={p.totalCents}
                maxValue={stats.payerRanking[0]!.totalCents}
                color={COLORS[i % COLORS.length]!}
              />
            ))}
          </View>
        )}

        {/* By category */}
        {stats.categoryRanking.length > 0 && (
          <View>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 10,
              }}
            >
              By Category
            </Text>
            {stats.categoryRanking.map((c, i) => (
              <BarRow
                key={c.name}
                label={c.name}
                value={c.totalCents}
                maxValue={stats.categoryRanking[0]!.totalCents}
                color={COLORS[i % COLORS.length]!}
              />
            ))}
          </View>
        )}

        {/* By merchant */}
        {stats.merchantRanking.length > 0 && (
          <View>
            <Text
              style={{
                color: C.muted,
                fontSize: 11,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 10,
              }}
            >
              Top Merchants
            </Text>
            {stats.merchantRanking.map((c, i) => (
              <BarRow
                key={c.name}
                label={c.name}
                value={c.totalCents}
                maxValue={stats.merchantRanking[0]!.totalCents}
                color={COLORS[(i + 3) % COLORS.length]!}
              />
            ))}
          </View>
        )}

        {/* Settlement status */}
        {settlement && (
          <View
            style={{
              borderWidth: 1,
              borderColor: settlement.allSettled ? C.success : C.border,
              backgroundColor: C.surface,
              borderRadius: R.md,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Ionicons
              name={
                settlement.allSettled ? "checkmark-circle" : "swap-horizontal"
              }
              size={24}
              color={settlement.allSettled ? C.success : C.warning}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.fg, fontSize: 15, fontWeight: "600" }}>
                {settlement.allSettled
                  ? "All settled up!"
                  : `${settlement.suggestedTransactions.length} payment${settlement.suggestedTransactions.length !== 1 ? "s" : ""} remaining`}
              </Text>
              {!settlement.allSettled && (
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  Go to Settle Up to see details
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

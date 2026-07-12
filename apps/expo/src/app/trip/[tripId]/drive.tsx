import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { FerryDriveCard } from "~/components/trip/ferry-drive-card";
import { RouteAheadCard } from "~/components/trip/route-ahead-card";
import { SideTripCard } from "~/components/trip/side-trip-card";
import { VanStatusCard } from "~/components/trip/van-status-card";
import type { RouterOutputs } from "~/utils/api";
import { trpc } from "~/utils/api";
import { C, mono, R } from "~/utils/design";
import { useBreadcrumbRecorder } from "~/utils/use-breadcrumb-recorder";
import { getActiveWorkspaceId } from "~/utils/workspace-store";

// ---- formatting helpers -------------------------------------------------

function fmtMiles(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtMiles1(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function fmtEta(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtLastSeen(secondsAgo: number): string {
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
  return `${Math.floor(secondsAgo / 86400)}d ago`;
}

// ---- shared block scaffold ---------------------------------------------

function BlockShell({
  label,
  icon,
  iconColor,
  borderColor,
  children,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  borderColor?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: borderColor ?? C.border,
        backgroundColor: C.surface,
        borderRadius: R.md,
        padding: 18,
        gap: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={icon} size={16} color={iconColor} />
        <Text
          style={{
            color: C.muted,
            fontSize: 12,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 1.2,
          }}
        >
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

function BlockLoading() {
  return (
    <View style={{ paddingVertical: 8 }}>
      <ActivityIndicator size="small" color={C.muted} />
    </View>
  );
}

function BlockEmpty({ text }: { text: string }) {
  return (
    <Text style={{ color: C.muted, fontSize: 15, paddingVertical: 4 }}>
      {text}
    </Text>
  );
}

// ---- screen -------------------------------------------------------------

type DrivingSummary = RouterOutputs["trips"]["drivingSummary"];

export default function DriveScreen() {
  "use no memo";
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const workspaceId = getActiveWorkspaceId() ?? "";
  const router = useRouter();

  const { data, isLoading, isError, refetch } = useQuery(
    trpc.trips.drivingSummary.queryOptions(
      { workspaceId, tripId: tripId ?? "" },
      // Poll every 10s — this is the day-of road dashboard; convoy + range
      // come from the same query (no realtime dependency).
      { refetchInterval: 10_000 },
    ),
  );

  const today = new Date().toISOString().slice(0, 10);
  const { data: briefing } = useQuery(
    trpc.daymap.briefing.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
      date: today,
    }),
  );
  const { data: amenityScan } = useQuery(
    trpc.planner.scanAmenities.queryOptions({
      workspaceId,
      tripId: tripId ?? "",
      maxMiles: 25,
    }),
  );
  const todayAmenities = amenityScan?.find((r) => r.date === today);

  const summary: DrivingSummary | undefined = data;

  const track = useBreadcrumbRecorder(workspaceId, tripId ?? "");

  const goVanState = () =>
    router.push({
      pathname: "/trip/[tripId]/log-vanstate" as any,
      params: { tripId: tripId ?? "" },
    });

  const openMap = () =>
    router.push({
      pathname: "/trip/[tripId]/map" as any,
      params: { tripId: tripId ?? "" },
    });

  const goLogStop = () =>
    router.push({
      pathname: "/trip/[tripId]/log-stop" as any,
      params: { tripId: tripId ?? "" },
    });

  const goCampHere = () =>
    router.push({
      pathname: "/trip/[tripId]/log-stop" as any,
      params: { tripId: tripId ?? "", quick: "camp" },
    });

  const goJourneyLog = () =>
    router.push({
      pathname: "/trip/[tripId]/journey-log" as any,
      params: { tripId: tripId ?? "" },
    });

  const goDayPlan = () =>
    router.push({
      pathname: "/trip/[tripId]/day-plan" as any,
      params: { tripId: tripId ?? "", date: today },
    });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen
        options={{
          title: "Driving Mode",
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.fg,
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}
      >
        {/* SIDE TRIP — off planned corridor by >2 mi */}
        <SideTripCard
          tripId={tripId ?? ""}
          workspaceId={workspaceId}
          onLogStop={goLogStop}
          onOpenMap={openMap}
        />

        {/* TODAY'S PLAN — from multi-day itinerary + briefing */}
        {briefing && (
          <Pressable onPress={goDayPlan}>
            <BlockShell
              label="Today's plan"
              icon="map-outline"
              iconColor={C.info}
              borderColor={C.info + "55"}
            >
              {briefing.plannedDay && (
                <Text style={{ color: C.fg, fontSize: 17, fontWeight: "700" }}>
                  {briefing.plannedDay.title ??
                    briefing.plannedDay.overnightName ??
                    "Today"}
                  <Text style={{ color: C.muted, fontSize: 13, fontWeight: "600" }}>
                    {"  "}
                    {briefing.plannedDay.intent}
                  </Text>
                </Text>
              )}
              {briefing.drive && (
                <Text
                  style={{ color: C.muted, fontFamily: mono, fontSize: 13 }}
                >
                  {briefing.drive.fromName} → {briefing.drive.toName} ·{" "}
                  {briefing.drive.miles} mi · ~{briefing.drive.hours}h
                </Text>
              )}
              {briefing.plannedDay?.heroTitle && (
                <Text style={{ color: C.success, fontSize: 14, fontWeight: "600" }}>
                  ★ {briefing.plannedDay.heroTitle}
                </Text>
              )}
              {briefing.schedule.slice(0, 3).map((s, i) => (
                <Text
                  key={`${s.part}-${i}`}
                  style={{ color: C.fg, fontSize: 14 }}
                >
                  <Text style={{ color: C.muted, fontSize: 11 }}>
                    {s.part.toUpperCase()}{" "}
                  </Text>
                  {s.title}
                </Text>
              ))}
              {briefing.plannedDay?.cutIfBehind && (
                <Text style={{ color: C.warning, fontSize: 13 }}>
                  Cut if behind: {briefing.plannedDay.cutIfBehind}
                </Text>
              )}
              {todayAmenities && (
                <View style={{ gap: 4, marginTop: 4 }}>
                  {todayAmenities.overnight && (
                    <Text style={{ color: C.muted, fontSize: 12 }}>
                      Sleep: {todayAmenities.overnight.name} (
                      {todayAmenities.overnight.milesAway} mi)
                    </Text>
                  )}
                  {todayAmenities.fuel && (
                    <Text style={{ color: C.muted, fontSize: 12 }}>
                      Fuel: {todayAmenities.fuel.name} (
                      {todayAmenities.fuel.milesAway} mi)
                    </Text>
                  )}
                  {todayAmenities.dump && (
                    <Text style={{ color: C.muted, fontSize: 12 }}>
                      Dump: {todayAmenities.dump.name} (
                      {todayAmenities.dump.milesAway} mi)
                    </Text>
                  )}
                  {todayAmenities.tolls.length > 0 && (
                    <Text style={{ color: C.warning, fontSize: 12 }}>
                      Tolls nearby: {todayAmenities.tolls.length}
                    </Text>
                  )}
                  {todayAmenities.warnings.slice(0, 2).map((w) => (
                    <Text key={w} style={{ color: C.warning, fontSize: 12 }}>
                      ⚠ {w}
                    </Text>
                  ))}
                </View>
              )}
              {briefing.notes.slice(0, 2).map((n) => (
                <Text key={n} style={{ color: C.warning, fontSize: 12 }}>
                  {n}
                </Text>
              ))}
              <Text style={{ color: C.info, fontSize: 12, fontWeight: "700" }}>
                Tap to edit day plan →
              </Text>
            </BlockShell>
          </Pressable>
        )}

        {/* LOG A STOP — capture where you are right now */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={goLogStop}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: C.success,
              backgroundColor: C.successBg,
              borderRadius: R.md,
              paddingVertical: 14,
              minHeight: 48,
            }}
          >
            <Ionicons name="location" size={18} color={C.success} />
            <Text style={{ color: C.success, fontSize: 15, fontWeight: "700" }}>
              Log a stop
            </Text>
          </Pressable>
          <Pressable
            onPress={goCampHere}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderWidth: 1,
              borderColor: C.warning,
              backgroundColor: C.warningBg,
              borderRadius: R.md,
              paddingHorizontal: 14,
              minHeight: 48,
            }}
          >
            <Ionicons name="bonfire-outline" size={18} color={C.warning} />
            <Text style={{ color: C.warning, fontSize: 14, fontWeight: "700" }}>
              Camp here
            </Text>
          </Pressable>
          <Pressable
            onPress={goJourneyLog}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              paddingHorizontal: 16,
              minHeight: 48,
            }}
          >
            <Ionicons name="list-outline" size={18} color={C.info} />
            <Text style={{ color: C.info, fontSize: 15, fontWeight: "600" }}>
              Log
            </Text>
          </Pressable>
        </View>

        {/* RECORD TRACK + VAN STATE */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => (track.recording ? track.stop() : track.start())}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: track.recording ? C.critical : C.border,
              backgroundColor: track.recording ? C.criticalBg : C.surface,
              borderRadius: R.md,
              paddingVertical: 14,
              minHeight: 48,
            }}
          >
            <Ionicons
              name={track.recording ? "stop-circle" : "radio-button-on"}
              size={18}
              color={track.recording ? C.critical : C.info}
            />
            <Text
              style={{
                color: track.recording ? C.critical : C.fg,
                fontSize: 15,
                fontWeight: "700",
              }}
            >
              {track.recording ? `Recording · ${track.count}` : "Record track"}
            </Text>
          </Pressable>
          <Pressable
            onPress={goVanState}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: R.md,
              paddingHorizontal: 16,
              minHeight: 48,
            }}
          >
            <Ionicons name="speedometer-outline" size={18} color={C.info} />
            <Text style={{ color: C.info, fontSize: 15, fontWeight: "600" }}>
              Van state
            </Text>
          </Pressable>
        </View>

        {isError && (
          <View
            style={{
              borderWidth: 1,
              borderColor: C.critical,
              backgroundColor: C.criticalBg,
              borderRadius: R.md,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Ionicons name="warning-outline" size={18} color={C.critical} />
            <Text style={{ color: C.fg, fontSize: 14, flex: 1 }}>
              Couldn't load driving data.
            </Text>
            <Pressable
              onPress={() => refetch()}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                minHeight: 44,
                justifyContent: "center",
              }}
            >
              <Text style={{ color: C.info, fontSize: 14, fontWeight: "600" }}>
                Retry
              </Text>
            </Pressable>
          </View>
        )}

        {/* 1 — NEXT STOP */}
        <BlockShell label="Next Stop" icon="flag-outline" iconColor={C.info}>
          {isLoading ? (
            <BlockLoading />
          ) : !summary?.nextStop ? (
            <BlockEmpty text="No stops planned." />
          ) : (
            <View style={{ gap: 8 }}>
              <Text
                style={{ color: C.fg, fontSize: 20, fontWeight: "700" }}
                numberOfLines={1}
              >
                {summary.nextStop.name}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 16,
                }}
              >
                <View>
                  <Text
                    style={{
                      color: C.fg,
                      fontSize: 44,
                      fontWeight: "800",
                      fontFamily: mono,
                      fontVariant: ["tabular-nums"],
                      lineHeight: 48,
                    }}
                  >
                    {fmtMiles1(summary.nextStop.distanceMiles)}
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontSize: 12,
                      fontWeight: "600",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    miles
                  </Text>
                </View>
                <View style={{ paddingBottom: 6 }}>
                  <Text
                    style={{
                      color: C.info,
                      fontSize: 24,
                      fontWeight: "700",
                      fontFamily: mono,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {fmtEta(summary.nextStop.etaMinutes)}
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontSize: 12,
                      fontWeight: "600",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    eta
                  </Text>
                </View>
              </View>
            </View>
          )}
        </BlockShell>

        {/* 2 — LEG PROGRESS */}
        <BlockShell
          label="Leg Progress"
          icon="trending-up-outline"
          iconColor={C.success}
        >
          {isLoading ? (
            <BlockLoading />
          ) : !summary?.legProgress ? (
            <BlockEmpty text="No active leg." />
          ) : (
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <Text
                  style={{
                    color: C.fg,
                    fontSize: 22,
                    fontWeight: "700",
                    fontFamily: mono,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {Math.round(summary.legProgress.fractionDone * 100)}%
                </Text>
                <Text
                  style={{
                    color: C.muted,
                    fontSize: 15,
                    fontFamily: mono,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {fmtMiles1(summary.legProgress.milesRemaining)} mi left
                </Text>
              </View>
              <View
                style={{
                  height: 6,
                  backgroundColor: C.border,
                  borderRadius: R.sm,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${Math.min(Math.max(summary.legProgress.fractionDone, 0), 1) * 100}%`,
                    backgroundColor: C.success,
                    borderRadius: R.sm,
                  }}
                />
              </View>
            </View>
          )}
        </BlockShell>

        {/* 2b — ROUTE AHEAD (route gradient + predicted zones; renders nothing
            without a planned route) */}
        <RouteAheadCard tripId={tripId ?? ""} workspaceId={workspaceId} />

        {/* 3 — NEXT FERRY (read-only; renders nothing when no upcoming ferry) */}
        <FerryDriveCard tripId={tripId ?? ""} workspaceId={workspaceId} />

        {/* 3b — VAN STATUS (read-only; renders nothing unless telemetry is
            flag-enabled and the van is linked to a driftport rig) */}
        <VanStatusCard tripId={tripId ?? ""} workspaceId={workspaceId} />

        {/* 4 — FUEL RANGE */}
        {(() => {
          const fr = summary?.fuelRange ?? null;
          const low = fr?.low ?? false;
          const critical = fr
            ? fr.estimatedRangeMiles < fr.distanceToGoMiles * 0.75
            : false;
          const accent = low ? (critical ? C.critical : C.warning) : C.success;
          return (
            <BlockShell
              label="Fuel Range"
              icon="speedometer-outline"
              iconColor={accent}
              borderColor={low ? accent : C.border}
            >
              {isLoading ? (
                <BlockLoading />
              ) : !fr ? (
                <BlockEmpty text="Log a fill-up to see range." />
              ) : (
                <View style={{ gap: 10 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-end",
                      gap: 20,
                    }}
                  >
                    <View>
                      <Text
                        style={{
                          color: accent,
                          fontSize: 40,
                          fontWeight: "800",
                          fontFamily: mono,
                          fontVariant: ["tabular-nums"],
                          lineHeight: 44,
                        }}
                      >
                        {fmtMiles(fr.estimatedRangeMiles)}
                      </Text>
                      <Text
                        style={{
                          color: C.muted,
                          fontSize: 12,
                          fontWeight: "600",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        mi range
                      </Text>
                    </View>
                    <View style={{ paddingBottom: 4 }}>
                      <Text
                        style={{
                          color: C.fg,
                          fontSize: 22,
                          fontWeight: "700",
                          fontFamily: mono,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {fmtMiles(fr.distanceToGoMiles)}
                      </Text>
                      <Text
                        style={{
                          color: C.muted,
                          fontSize: 12,
                          fontWeight: "600",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        mi to go
                      </Text>
                    </View>
                  </View>
                  {low && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Ionicons
                        name="alert-circle-outline"
                        size={16}
                        color={accent}
                      />
                      <Text
                        style={{
                          color: accent,
                          fontSize: 13,
                          fontWeight: "700",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        {critical ? "Refuel now" : "Plan a fill-up"}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </BlockShell>
          );
        })()}

        {/* 5 — CONVOY */}
        <BlockShell label="Convoy" icon="people-outline" iconColor={C.info}>
          {isLoading ? (
            <BlockLoading />
          ) : !summary || summary.convoy.length === 0 ? (
            <BlockEmpty text="No one sharing location." />
          ) : (
            <View style={{ gap: 8 }}>
              {summary.convoy.map((m) => {
                const dirColor =
                  m.aheadOrBehind === "ahead"
                    ? C.success
                    : m.aheadOrBehind === "behind"
                      ? C.warning
                      : C.muted;
                const dirIcon =
                  m.aheadOrBehind === "ahead"
                    ? "arrow-up"
                    : m.aheadOrBehind === "behind"
                      ? "arrow-down"
                      : "remove";
                return (
                  <Pressable
                    key={m.userId}
                    onPress={openMap}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      minHeight: 44,
                      paddingVertical: 6,
                    }}
                  >
                    <Ionicons
                      name={dirIcon as keyof typeof Ionicons.glyphMap}
                      size={18}
                      color={dirColor}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: C.fg,
                          fontSize: 16,
                          fontWeight: "600",
                        }}
                        numberOfLines={1}
                      >
                        {m.name}
                      </Text>
                      <Text
                        style={{
                          color: dirColor,
                          fontSize: 12,
                          fontWeight: "600",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        {m.aheadOrBehind === "unknown"
                          ? "Position unknown"
                          : m.aheadOrBehind}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: C.muted,
                        fontSize: 13,
                        fontFamily: mono,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {fmtLastSeen(m.lastSeenSecondsAgo)}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={C.muted}
                    />
                  </Pressable>
                );
              })}
              <Pressable
                onPress={openMap}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: R.md,
                  paddingVertical: 14,
                  minHeight: 44,
                  marginTop: 4,
                }}
              >
                <Ionicons name="map-outline" size={16} color={C.info} />
                <Text
                  style={{ color: C.info, fontSize: 15, fontWeight: "600" }}
                >
                  View map
                </Text>
              </Pressable>
            </View>
          )}
        </BlockShell>
      </ScrollView>
    </View>
  );
}

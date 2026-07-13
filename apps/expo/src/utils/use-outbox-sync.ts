import { useCallback, useEffect, useState } from "react";

import { trpcClient } from "./api";
import { captureOutbox } from "./capture-outbox-native";
import { fuelOutbox } from "./fuel-outbox-native";
import { journeyOutbox } from "./journey-outbox-native";
import { fetchIsOnline, useNetworkStatus } from "./network-status";

/**
 * Drain journey + fuel outboxes when connectivity returns (or on manual Sync).
 */
export function useOutboxSync() {
  const { online } = useNetworkStatus();
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const syncNow = useCallback(async () => {
    const reachable = await fetchIsOnline();
    if (!reachable) return;
    setSyncing(true);
    setLastError(null);
    try {
      await journeyOutbox.flush((command) =>
        trpcClient.journey.logStop.mutate({
          workspaceId: command.workspaceId,
          tripId: command.tripId,
          stopId: command.stopId,
          name: command.name,
          lat: command.lat,
          lng: command.lng,
          arrivedAt: command.arrivedAt,
          kind: command.kind,
          note: command.note,
        }),
      );
      await fuelOutbox.flush((command) => {
        const {
          clientId: _clientId,
          workspaceId,
          tripId,
          ...rest
        } = command;
        return trpcClient.fuelLogs.create.mutate({
          workspaceId,
          tripId,
          gallons: rest.gallons,
          pricePerGallon: rest.pricePerGallon,
          totalCents: rest.totalCents,
          fuelType: rest.fuelType,
          loggedAt: rest.loggedAt,
          odometerMiles: rest.odometerMiles,
          segmentId: rest.segmentId,
          vanProfileId: rest.vanProfileId,
          stationName: rest.stationName,
          stationLat: rest.stationLat,
          stationLng: rest.stationLng,
          isCostco: rest.isCostco ?? false,
          notes: rest.notes,
          currency: rest.currency ?? "USD",
          splitWithGroup: rest.splitWithGroup ?? false,
        });
      });
      await captureOutbox.flush(async (command) => {
        if (command.kind === "expense.create") {
          const { clientId: _c, kind: _k, ...rest } = command;
          return trpcClient.expenses.create.mutate({
            workspaceId: rest.workspaceId,
            tripId: rest.tripId,
            segmentId: rest.segmentId,
            merchant: rest.merchant,
            occurredAt: rest.occurredAt,
            category: rest.category ?? "general",
            currency: rest.currency ?? "USD",
            subtotalCents: rest.subtotalCents ?? 0,
            taxCents: rest.taxCents ?? 0,
            tipCents: rest.tipCents ?? 0,
            totalCents: rest.totalCents ?? 0,
            notes: rest.notes,
          });
        }
        const { clientId: _c, kind: _k, ...rest } = command;
        return trpcClient.pins.create.mutate({
          workspaceId: rest.workspaceId,
          tripId: rest.tripId,
          segmentId: rest.segmentId,
          title: rest.title,
          type: rest.type as
            | "lodging"
            | "activity"
            | "meal"
            | "transit"
            | "custom"
            | "fuel"
            | "water"
            | "campsite"
            | "dump_station"
            | "rest_area"
            | "scenic"
            | "shower"
            | "grocery"
            | "propane"
            | "laundry",
          lat: rest.lat,
          lng: rest.lng,
          startsAt: rest.startsAt,
          endsAt: rest.endsAt,
          notes: rest.notes,
        });
      });
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (online) {
      void syncNow();
    }
  }, [online, syncNow]);

  return { online, syncing, lastError, syncNow };
}

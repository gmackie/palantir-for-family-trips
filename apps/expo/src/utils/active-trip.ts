/**
 * Persist last-opened trip and pick the active road-trip for cold-start default.
 */
import * as SecureStore from "expo-secure-store";

export {
  ACTIVE_TRIP_STATUSES,
  defaultRouteForTrip,
  isActiveTripStatus,
  pickDefaultTrip,
  type TripListItem,
} from "./active-trip-logic";

const LAST_TRIP_KEY = "sortey.last_trip_id";

export function getLastTripId(): string | null {
  return SecureStore.getItem(LAST_TRIP_KEY);
}

export async function setLastTripId(tripId: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_TRIP_KEY, tripId);
}

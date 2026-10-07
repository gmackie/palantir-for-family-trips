import { tripCalendarDay } from "@sortey/validators/trip-day";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** Keep trip-local day selection current across midnight and app resumes. */
export function useTripCalendarDay(
  timeZone: string | undefined,
): string | null {
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => setClock(Date.now());
    const timer = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return timeZone === undefined
    ? null
    : tripCalendarDay(new Date(clock), timeZone);
}

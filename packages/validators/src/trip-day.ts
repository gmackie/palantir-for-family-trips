/** Resolve calendar days in the trip timezone, independently of device/server timezone. */
export function resolveTripTimezone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch (error) {
    if (error instanceof RangeError) return "UTC";
    throw error;
  }
}

export function tripCalendarDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTripTimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day)
    throw new Error("Could not resolve trip calendar day");
  return `${year}-${month}-${day}`;
}

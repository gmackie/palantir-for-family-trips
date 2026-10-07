import { z } from "zod";

const calendarDateSchema = z.string().date();
const mediumFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** A YYYY-MM-DD value is a calendar date; device offsets must not move its label. */
export function formatCalendarDate(
  value: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "";
  const date = calendarDateSchema.parse(value);
  const formatter = options
    ? new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })
    : mediumFormatter;
  return formatter.format(new Date(`${date}T00:00:00Z`));
}

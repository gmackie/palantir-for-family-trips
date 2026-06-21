const MS_PER_MINUTE = 60_000;

/**
 * Compute the "leave-by" deadline for a ferry crossing: the latest a traveler
 * can depart their current location and still make the boat, accounting for the
 * operator's arrival cutoff and the drive time to the departure terminal.
 *
 * Returns `null` when the scheduled departure is unknown. Never mutates the
 * provided `scheduledDepartureAt`.
 */
export function computeLeaveBy({
  scheduledDepartureAt,
  arrivalCutoffMinutes,
  driveMinutesToTerminal,
}: {
  scheduledDepartureAt: Date | null;
  arrivalCutoffMinutes: number;
  driveMinutesToTerminal: number;
}): Date | null {
  if (scheduledDepartureAt === null) {
    return null;
  }

  const offsetMinutes = arrivalCutoffMinutes + driveMinutesToTerminal;
  return new Date(
    scheduledDepartureAt.getTime() - offsetMinutes * MS_PER_MINUTE,
  );
}

/**
 * Minutes a ferry crossing consumes that are *not* driving time: the crossing
 * itself plus the arrival cutoff (the buffer spent queued at the terminal). A
 * null crossing duration is treated as zero.
 */
export function ferryNonDrivableMinutes({
  durationMinutes,
  arrivalCutoffMinutes,
}: {
  durationMinutes: number | null;
  arrivalCutoffMinutes: number;
}): number {
  return (durationMinutes ?? 0) + arrivalCutoffMinutes;
}

export function showsSegmentColumns(width: number, fontScale: number): boolean {
  return fontScale < 1.6 && width >= 600 * Math.max(1, fontScale);
}

interface DatedLeg {
  id: string;
  startDate: string | null;
  endDate: string | null;
}

export function selectedTripSegment<T extends DatedLeg>(
  legs: readonly T[],
  chosenId: string | null,
  today: string,
): T | undefined {
  return (
    legs.find((leg) => leg.id === chosenId) ??
    legs.find(
      (leg) =>
        leg.startDate &&
        leg.startDate <= today &&
        (leg.endDate ?? leg.startDate) >= today,
    ) ??
    legs.find((leg) => leg.startDate && leg.startDate > today) ??
    legs[0]
  );
}

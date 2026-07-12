export function mergeJourneyTimeline<
  TServer extends { id: string; arrivedAt: string | Date },
  TQueued extends { stopId: string; arrivedAt: string },
>(server: TServer[], queued: TQueued[]) {
  const confirmedIds = new Set(server.map((stop) => stop.id));
  const pending = queued
    .filter((command) => !confirmedIds.has(command.stopId))
    .map(({ stopId, ...command }) => ({
      ...command,
      id: stopId,
      syncState: "queued" as const,
    }));
  return [...server, ...pending].sort(
    (a, b) => new Date(a.arrivedAt).getTime() - new Date(b.arrivedAt).getTime(),
  );
}

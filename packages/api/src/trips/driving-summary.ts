// Driving Mode assembly — a PURE, DB/IO-free logic fn that turns already-loaded
// trip data (itinerary stops, the requester's position, fuel/van profile, member
// locations) into the four glanceable blocks the Driving Mode screen renders.
//
// Mirrors the store pattern in `router/chat.ts`: this file has zero DB access so
// it can be unit-tested against fixtures. The thin `trips.drivingSummary`
// procedure loads the rows and calls `buildDrivingSummary`.

// Average highway speed used as the ETA fallback when no route-planner
// distance/duration is supplied. Mirrors `AVG_SPEED_MPH` in
// `router/route-planner.ts` (route-planner keeps it module-local, so we restate
// the same constant here rather than couple the two modules).
const AVG_SPEED_MPH = 65;

const EARTH_RADIUS_MILES = 3959;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in miles. Used only as a fallback when the caller has no
// precomputed route distance for the next leg (route-planner's own distances are
// preferred when available since they follow roads, not straight lines).
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const x =
    sinLat * sinLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLng * sinLng;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export interface DrivingSummaryStop {
  name: string;
  lat: number;
  lng: number;
  // Lower order == earlier in the trip. Used to pick "next stop" relative to now
  // when a scheduled time is unavailable.
  order: number;
  // ISO string or Date; the next stop is the earliest one still in the future.
  scheduledAt?: string | Date | null;
}

export interface DrivingSummaryPosition {
  lat: number;
  lng: number;
}

// Distance/duration to the next stop, as produced by route-planner. When
// provided these win over the haversine + AVG_SPEED_MPH fallback.
export interface NextLegRoute {
  distanceMiles: number;
  durationMinutes: number;
}

export interface DrivingSummaryFuelLog {
  // Odometer at the time of the most recent fill-up. Null/undefined → no range.
  odometerMiles: number | null | undefined;
  loggedAt: string | Date;
}

export interface DrivingSummaryVanProfile {
  mpgEstimate: number | null | undefined;
  tankGallons: number | null | undefined;
}

export interface DrivingSummaryMemberLocation {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  updatedAt: string | Date;
}

export interface BuildDrivingSummaryInput {
  // Itinerary stops for the trip. Empty → nextStop/legProgress null.
  stops: DrivingSummaryStop[];
  // The requesting user's own latest position, or null if unknown.
  currentPosition: DrivingSummaryPosition | null;
  // Precomputed route to the next stop (preferred). When absent the fn falls
  // back to haversine distance + AVG_SPEED_MPH for ETA.
  nextLegRoute?: NextLegRoute | null;
  // Total miles still to drive for the whole remaining trip (used by fuelRange
  // `low`). When absent, distance-to-next-stop is used as the to-go estimate.
  distanceToGoMiles?: number | null;
  latestFuelLog: DrivingSummaryFuelLog | null;
  vanProfile: DrivingSummaryVanProfile | null;
  // Current odometer reading, if known (e.g. live van telemetry). When absent we
  // cannot compute miles-since-fill-up, so fuelRange is null.
  currentOdometerMiles?: number | null;
  memberLocations: DrivingSummaryMemberLocation[];
  // The requester's own userId — excluded from the convoy list.
  selfUserId: string;
  now: Date;
}

export interface DrivingSummaryNextStop {
  name: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  etaMinutes: number;
}

export interface DrivingSummaryLegProgress {
  fractionDone: number;
  milesRemaining: number;
}

export interface DrivingSummaryFuelRange {
  estimatedRangeMiles: number;
  distanceToGoMiles: number;
  low: boolean;
}

export interface DrivingSummaryConvoyMember {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  lastSeenSecondsAgo: number;
  aheadOrBehind: "ahead" | "behind" | "unknown";
}

export interface DrivingSummary {
  nextStop: DrivingSummaryNextStop | null;
  legProgress: DrivingSummaryLegProgress | null;
  fuelRange: DrivingSummaryFuelRange | null;
  convoy: DrivingSummaryConvoyMember[];
}

function toMillis(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Pick the next stop: the earliest scheduled stop still in the future; if no
// stop has a future scheduled time (or none are scheduled), fall back to the
// lowest-order stop. Returns null when there are no stops.
function pickNextStop(
  stops: DrivingSummaryStop[],
  now: Date,
): DrivingSummaryStop | null {
  if (stops.length === 0) return null;

  const nowMs = now.getTime();
  const future = stops
    .filter((s) => s.scheduledAt != null && toMillis(s.scheduledAt) >= nowMs)
    .sort((a, b) => toMillis(a.scheduledAt!) - toMillis(b.scheduledAt!));

  if (future.length > 0) return future[0]!;

  // No future-scheduled stop → use stop ordering as the proxy for "next".
  return [...stops].sort((a, b) => a.order - b.order)[0]!;
}

function buildNextStop(
  input: BuildDrivingSummaryInput,
  nextStop: DrivingSummaryStop | null,
): DrivingSummaryNextStop | null {
  if (!nextStop) return null;

  let distanceMiles: number | null = null;
  let etaMinutes: number | null = null;

  if (input.nextLegRoute) {
    distanceMiles = input.nextLegRoute.distanceMiles;
    etaMinutes = input.nextLegRoute.durationMinutes;
  } else if (input.currentPosition) {
    distanceMiles = haversineMiles(input.currentPosition, nextStop);
    etaMinutes = (distanceMiles / AVG_SPEED_MPH) * 60;
  }

  // Without either a route or a current position we can't quantify distance/ETA.
  if (distanceMiles == null || etaMinutes == null) return null;

  return {
    name: nextStop.name,
    lat: nextStop.lat,
    lng: nextStop.lng,
    distanceMiles: round1(distanceMiles),
    etaMinutes: Math.round(etaMinutes),
  };
}

function buildLegProgress(
  input: BuildDrivingSummaryInput,
  nextStop: DrivingSummaryNextStop | null,
): DrivingSummaryLegProgress | null {
  // Leg progress needs the full leg length (route distance) and how far is left
  // (distance still to drive to the next stop). We derive "leg length" from the
  // route when available, otherwise there's nothing meaningful to show.
  if (!nextStop || !input.nextLegRoute) return null;

  const legMiles = input.nextLegRoute.distanceMiles;
  if (legMiles <= 0) return null;

  // distanceToGoMiles, when scoped to this leg, is the remaining portion; clamp
  // to [0, legMiles]. Default to the next-stop distance when not supplied.
  const remaining = Math.min(
    Math.max(
      input.distanceToGoMiles != null
        ? input.distanceToGoMiles
        : nextStop.distanceMiles,
      0,
    ),
    legMiles,
  );

  const fractionDone = (legMiles - remaining) / legMiles;

  return {
    fractionDone: Math.round(fractionDone * 100) / 100,
    milesRemaining: round1(remaining),
  };
}

function buildFuelRange(
  input: BuildDrivingSummaryInput,
  nextStop: DrivingSummaryNextStop | null,
): DrivingSummaryFuelRange | null {
  const { latestFuelLog, vanProfile } = input;

  if (!latestFuelLog || !vanProfile) return null;

  const mpg = vanProfile.mpgEstimate;
  const tank = vanProfile.tankGallons;
  const fillUpOdometer = latestFuelLog.odometerMiles;

  // Range requires all three inputs. Any missing → no range block.
  if (
    mpg == null ||
    tank == null ||
    fillUpOdometer == null ||
    !Number.isFinite(mpg) ||
    !Number.isFinite(tank) ||
    !Number.isFinite(fillUpOdometer)
  ) {
    return null;
  }

  // Miles burned since the last fill-up. Without a current odometer we assume a
  // full tank (0 miles since fill-up) rather than dropping the block entirely —
  // the most recent fill-up implies a topped-off tank.
  const milesSinceFillUp =
    input.currentOdometerMiles != null
      ? Math.max(input.currentOdometerMiles - fillUpOdometer, 0)
      : 0;

  const estimatedRangeMiles = Math.max(mpg * tank - milesSinceFillUp, 0);

  // Distance the range must cover: whole-trip to-go when supplied, else just the
  // next stop, else 0.
  const distanceToGoMiles =
    input.distanceToGoMiles != null
      ? Math.max(input.distanceToGoMiles, 0)
      : (nextStop?.distanceMiles ?? 0);

  return {
    estimatedRangeMiles: round1(estimatedRangeMiles),
    distanceToGoMiles: round1(distanceToGoMiles),
    low: estimatedRangeMiles < distanceToGoMiles,
  };
}

function buildConvoy(
  input: BuildDrivingSummaryInput,
  nextStop: DrivingSummaryStop | null,
): DrivingSummaryConvoyMember[] {
  const nowMs = input.now.getTime();

  // Distance from the requester to the next stop, used as the ahead/behind
  // reference. "Ahead" == closer to the next stop than the requester is.
  const selfToNext =
    input.currentPosition && nextStop
      ? haversineMiles(input.currentPosition, nextStop)
      : null;

  return input.memberLocations
    .filter((m) => m.userId !== input.selfUserId)
    .map((m) => {
      const lastSeenSecondsAgo = Math.max(
        Math.round((nowMs - toMillis(m.updatedAt)) / 1000),
        0,
      );

      // Heuristic: compare each member's straight-line distance to the next stop
      // against the requester's. Closer == "ahead", farther == "behind". This is
      // a coarse proxy (no route projection) but cheap and good enough for a
      // glanceable convoy readout. If we lack a next stop or the requester's
      // own position, we can't compare → "unknown".
      let aheadOrBehind: "ahead" | "behind" | "unknown" = "unknown";
      if (selfToNext != null && nextStop) {
        const memberToNext = haversineMiles(m, nextStop);
        aheadOrBehind = memberToNext < selfToNext ? "ahead" : "behind";
      }

      return {
        userId: m.userId,
        name: m.name,
        lat: m.lat,
        lng: m.lng,
        lastSeenSecondsAgo,
        aheadOrBehind,
      };
    });
}

export function buildDrivingSummary(
  input: BuildDrivingSummaryInput,
): DrivingSummary {
  const nextStopRow = pickNextStop(input.stops, input.now);
  const nextStop = buildNextStop(input, nextStopRow);
  const legProgress = buildLegProgress(input, nextStop);
  const fuelRange = buildFuelRange(input, nextStop);
  const convoy = buildConvoy(input, nextStopRow);

  return { nextStop, legProgress, fuelRange, convoy };
}

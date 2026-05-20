/**
 * Auto-Split Segments
 *
 * Given a set of route legs from Google Routes, splits them into
 * driving segments of at most `maxDrivingHours` each. Each segment
 * gets a generated name like "Day 1", "Day 2", etc.
 *
 * Used by road trip mode to automatically create trip segments from
 * a long-distance route.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoSplitLeg {
  distanceMeters: number;
  duration: string; // Google duration format, e.g. "3600s"
  startLocation: { lat: number; lng: number };
  endLocation: { lat: number; lng: number };
}

export interface AutoSplitInput {
  legs: AutoSplitLeg[];
  maxDrivingHours?: number; // default 12
}

export interface AutoSplitSegment {
  name: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  distanceMiles: number;
  durationMinutes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DRIVING_HOURS = 12;
const METERS_PER_MILE = 1_609.344;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Google Routes duration string (e.g. "3600s", "7200.5s") into
 * total seconds. The API always returns durations as "<number>s".
 */
function parseDurationSeconds(duration: string): number {
  const match = duration.match(/^([\d.]+)s$/);
  if (!match?.[1]) {
    return 0;
  }
  return Number.parseFloat(match[1]);
}

function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

function secondsToMinutes(seconds: number): number {
  return seconds / SECONDS_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function autoSplitSegments(input: AutoSplitInput): AutoSplitSegment[] {
  const { legs, maxDrivingHours = DEFAULT_MAX_DRIVING_HOURS } = input;

  if (legs.length === 0) {
    return [];
  }

  const maxDrivingSeconds =
    maxDrivingHours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

  const segments: AutoSplitSegment[] = [];

  // Track the current segment being accumulated
  let segmentOrigin = legs[0]!.startLocation;
  let segmentDistanceMeters = 0;
  let segmentDurationSeconds = 0;
  let dayNumber = 1;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const legDurationSeconds = parseDurationSeconds(leg.duration);
    const legDistanceMeters = leg.distanceMeters;

    // Check if adding this leg would exceed the max driving time
    if (
      segmentDurationSeconds + legDurationSeconds > maxDrivingSeconds &&
      segmentDurationSeconds > 0
    ) {
      // Finalize the current segment (ends at this leg's start)
      segments.push({
        name: `Day ${dayNumber}`,
        originLat: segmentOrigin.lat,
        originLng: segmentOrigin.lng,
        destinationLat: leg.startLocation.lat,
        destinationLng: leg.startLocation.lng,
        distanceMiles:
          Math.round(metersToMiles(segmentDistanceMeters) * 10) / 10,
        durationMinutes: Math.round(secondsToMinutes(segmentDurationSeconds)),
      });

      dayNumber++;
      segmentOrigin = leg.startLocation;
      segmentDistanceMeters = 0;
      segmentDurationSeconds = 0;
    }

    // Add this leg to the current segment
    segmentDistanceMeters += legDistanceMeters;
    segmentDurationSeconds += legDurationSeconds;
  }

  // Finalize the last segment
  const lastLeg = legs[legs.length - 1]!;
  segments.push({
    name: `Day ${dayNumber}`,
    originLat: segmentOrigin.lat,
    originLng: segmentOrigin.lng,
    destinationLat: lastLeg.endLocation.lat,
    destinationLng: lastLeg.endLocation.lng,
    distanceMiles: Math.round(metersToMiles(segmentDistanceMeters) * 10) / 10,
    durationMinutes: Math.round(secondsToMinutes(segmentDurationSeconds)),
  });

  return segments;
}

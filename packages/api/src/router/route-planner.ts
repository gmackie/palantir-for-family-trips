import { decode, encode } from "@googlemaps/polyline-codec";
import { and, desc, eq, isNotNull } from "@sortey/db";
import { db } from "@sortey/db/client";
import {
  ferryCrossings,
  fuelLogs,
  tripSegments,
  trips,
  vanProfiles,
} from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import SunCalc from "suncalc";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { labelRouteCandidates } from "../route-planner/route-candidates";
import { assessSideTrip } from "../route-planner/side-trip";
import {
  computeFuelZones,
  computeOvernightZones,
  fuelRangeMiles,
  type LatLng as ZoneLatLng,
  type ZoneSegment,
} from "../route-planner/zones";
import { protectedProcedure } from "../trpc";
import { computeLeaveBy, ferryNonDrivableMinutes } from "./ferry-eta";

type Db = typeof db;

const MAX_DRIVING_HOURS = 12;
const PACK_UP_HOURS = 1;
const SUNSET_BUFFER_HOURS = 1;
const AVG_SPEED_MPH = 65;

interface LatLng {
  lat: number;
  lng: number;
}

interface GoogleRouteLeg {
  distanceMeters: number;
  duration: string;
  polyline: { encodedPolyline: string };
}

interface GoogleRouteResponse {
  routes?: Array<{
    distanceMeters: number;
    duration: string;
    polyline: { encodedPolyline: string };
    legs: GoogleRouteLeg[];
  }>;
}

function metersToMiles(m: number): number {
  return Math.round((m / 1609.344) * 10) / 10;
}

function durationToMinutes(d: string): number {
  return Math.round(parseInt(d.replace("s", ""), 10) / 60);
}

function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 3959;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const x =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng *
      sinLng;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function cumulativeDistances(points: LatLng[]): number[] {
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    dists.push(dists[i - 1]! + haversineDistance(points[i - 1]!, points[i]!));
  }
  return dists;
}

function sunsetTime(date: Date, lat: number, lng: number): Date {
  return SunCalc.getTimes(date, lat, lng).sunset;
}

function sunriseTime(date: Date, lat: number, lng: number): Date {
  return SunCalc.getTimes(date, lat, lng).sunrise;
}

const MS_PER_HOUR = 3_600_000;

interface AutoSplitSegment {
  name: string;
  originIndex: number;
  destIndex: number;
  origin: LatLng;
  destination: LatLng;
  distanceMiles: number;
  durationMinutes: number;
  encodedPolyline: string;
  startDate: string;
}

function autoSplitRoute(
  points: LatLng[],
  totalDistanceMiles: number,
  startDate: Date,
  originName: string,
  destName: string,
): AutoSplitSegment[] {
  if (points.length < 2) return [];

  const cumDist = cumulativeDistances(points);
  const segments: AutoSplitSegment[] = [];
  let segStart = 0;
  let currentDate = new Date(startDate);
  let dayNum = 1;

  while (segStart < points.length - 1) {
    const startPoint = points[segStart]!;
    const sunrise = sunriseTime(currentDate, startPoint.lat, startPoint.lng);
    const departureMs = sunrise.getTime() + PACK_UP_HOURS * MS_PER_HOUR;
    let segEnd = segStart;

    for (let i = segStart + 1; i < points.length; i++) {
      const pt = points[i]!;
      const segDist = cumDist[i]! - cumDist[segStart]!;
      const drivingHours = segDist / AVG_SPEED_MPH;
      const arrivalMs = departureMs + drivingHours * MS_PER_HOUR;

      const sunset = sunsetTime(currentDate, pt.lat, pt.lng);
      const hoursUntilSunset = (sunset.getTime() - arrivalMs) / MS_PER_HOUR;

      if (
        drivingHours >= MAX_DRIVING_HOURS ||
        hoursUntilSunset < SUNSET_BUFFER_HOURS
      ) {
        segEnd = i;
        break;
      }
      segEnd = i;
    }

    if (segEnd === segStart) segEnd = segStart + 1;

    const segPoints = points.slice(segStart, segEnd + 1);
    const dist = cumDist[segEnd]! - cumDist[segStart]!;
    const duration = Math.round((dist / AVG_SPEED_MPH) * 60);

    const isFirst = segments.length === 0;
    const isLast = segEnd >= points.length - 1;
    const segOriginName = isFirst ? originName : `Day ${dayNum} start`;
    const segDestName = isLast ? destName : `Day ${dayNum} overnight`;

    segments.push({
      name: `${segOriginName} → ${segDestName}`,
      originIndex: segStart,
      destIndex: segEnd,
      origin: points[segStart]!,
      destination: points[segEnd]!,
      distanceMiles: Math.round(dist * 10) / 10,
      durationMinutes: duration,
      encodedPolyline: encode(
        segPoints.map((p) => [p.lat, p.lng]),
        5,
      ),
      startDate: currentDate.toISOString().slice(0, 10),
    });

    segStart = segEnd;
    currentDate = new Date(currentDate.getTime() + 86400000);
    dayNum++;

    if (segEnd >= points.length - 1) break;
  }

  return segments;
}

/**
 * A drive leg the ferry gating cares about: it has an id (segment id), the name
 * of the place the drive ends (terminal candidate), and the drive minutes spent
 * reaching that destination.
 */
export interface FerryGatingLeg {
  id: string;
  destinationName: string | null;
  durationMinutes: number | null;
}

/** The subset of a ferry crossing the planner needs to gate a leg. */
export interface FerryGatingCrossing {
  id: string;
  departureTerminal: string | null;
  afterSegmentId: string | null;
  scheduledDepartureAt: Date | null;
  durationMinutes: number | null;
  arrivalCutoffMinutes: number;
}

/** Ferry data attached to a leg whose drive ends at the departure terminal. */
export interface AttachedFerry {
  /** Latest a traveler can leave to make the boat, or null if unknown. */
  leaveBy: Date | null;
  /**
   * Minutes the crossing + arrival cutoff consume. This is *non-driving* time:
   * it never counts toward the 12h driving budget.
   */
  nonDrivableMinutes: number;
}

export type FerryGatedLeg<TLeg extends FerryGatingLeg> = TLeg & {
  ferry: AttachedFerry | null;
};

export interface FerryGatingResult<TLeg extends FerryGatingLeg> {
  legs: Array<FerryGatedLeg<TLeg>>;
  /**
   * Total ferry non-drivable minutes across all matched legs. Surfaced so
   * callers can confirm this time is withheld from the driving-hours cap rather
   * than spent driving — a ferry can interrupt a day without counting toward
   * the 12h budget.
   */
  totalNonDrivableMinutes: number;
}

/**
 * Attach ferry gating data to drive legs without changing the legs' driving
 * math. A crossing is matched to the leg it follows by `afterSegmentId` first,
 * then by `departureTerminal` matching the leg's `destinationName`. The matched
 * leg's drive minutes are used as the drive time to the terminal for the
 * leave-by deadline. Ferry non-drivable minutes are reported separately and are
 * never added to any leg's `durationMinutes`, so the 12h driving budget is
 * unaffected.
 *
 * Pure: no DB, no mutation of inputs. Backward-compatible — with zero crossings
 * every leg gets `ferry: null` and `totalNonDrivableMinutes` is 0.
 */
export function applyFerryGating<TLeg extends FerryGatingLeg>(
  legs: TLeg[],
  crossings: FerryGatingCrossing[],
): FerryGatingResult<TLeg> {
  let totalNonDrivableMinutes = 0;

  const gatedLegs = legs.map((leg): FerryGatedLeg<TLeg> => {
    const crossing = crossings.find((c) => {
      if (c.afterSegmentId !== null) {
        return c.afterSegmentId === leg.id;
      }
      return (
        c.departureTerminal !== null &&
        leg.destinationName !== null &&
        c.departureTerminal === leg.destinationName
      );
    });

    if (!crossing) {
      return { ...leg, ferry: null };
    }

    const nonDrivableMinutes = ferryNonDrivableMinutes({
      durationMinutes: crossing.durationMinutes,
      arrivalCutoffMinutes: crossing.arrivalCutoffMinutes,
    });
    totalNonDrivableMinutes += nonDrivableMinutes;

    const leaveBy = computeLeaveBy({
      scheduledDepartureAt: crossing.scheduledDepartureAt,
      arrivalCutoffMinutes: crossing.arrivalCutoffMinutes,
      driveMinutesToTerminal: leg.durationMinutes ?? 0,
    });

    return { ...leg, ferry: { leaveBy, nonDrivableMinutes } };
  });

  return { legs: gatedLegs, totalNonDrivableMinutes };
}

/**
 * Read the trip's ferry crossings and attach gating data to the planner's
 * returned segments. Additive: the segment rows are returned unchanged plus a
 * `ferry` field. Used by `planRoute` so it can stay backward-compatible when a
 * trip has no crossings (every segment gets `ferry: null`).
 */
async function gateSegmentsWithFerries<TLeg extends FerryGatingLeg>(
  db: Db,
  tripId: string,
  segments: TLeg[],
): Promise<FerryGatingResult<TLeg>> {
  const crossings = await db
    .select({
      id: ferryCrossings.id,
      departureTerminal: ferryCrossings.departureTerminal,
      afterSegmentId: ferryCrossings.afterSegmentId,
      scheduledDepartureAt: ferryCrossings.scheduledDepartureAt,
      durationMinutes: ferryCrossings.durationMinutes,
      arrivalCutoffMinutes: ferryCrossings.arrivalCutoffMinutes,
    })
    .from(ferryCrossings)
    .where(eq(ferryCrossings.tripId, tripId));

  return applyFerryGating(segments, crossings);
}

export const routePlannerRouter = {
  planRoute: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        origin: z.object({
          name: z.string(),
          lat: z.number(),
          lng: z.number(),
        }),
        destination: z.object({
          name: z.string(),
          lat: z.number(),
          lng: z.number(),
        }),
        waypoints: z
          .array(
            z.object({
              name: z.string().optional(),
              lat: z.number(),
              lng: z.number(),
            }),
          )
          .default([]),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        autoSplit: z.boolean().default(true),
        /**
         * Optional dual-candidate selection from `listCandidates`. When set,
         * we skip the Google primary fetch and plan from this polyline.
         */
        preferredRoute: z
          .object({
            encodedPolyline: z.string().min(8),
            distanceMiles: z.number().positive(),
            durationMinutes: z.number().int().positive(),
            label: z.string().max(80).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let totalMiles: number;
      let totalMinutes: number;
      let fullPolyline: string;

      if (input.preferredRoute) {
        totalMiles = input.preferredRoute.distanceMiles;
        totalMinutes = input.preferredRoute.durationMinutes;
        fullPolyline = input.preferredRoute.encodedPolyline;
        try {
          const pts = decode(fullPolyline, 5);
          if (pts.length < 2) {
            throw new Error("too few points");
          }
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "preferredRoute.encodedPolyline is not a valid polyline.",
          });
        }
      } else {
        const apiKey =
          process.env.GOOGLE_ROUTES_API_KEY ??
          process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

        if (!apiKey) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Google Routes API key not configured",
          });
        }

        const body: Record<string, unknown> = {
          origin: {
            location: {
              latLng: {
                latitude: input.origin.lat,
                longitude: input.origin.lng,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: input.destination.lat,
                longitude: input.destination.lng,
              },
            },
          },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          polylineEncoding: "ENCODED_POLYLINE",
        };

        if (input.waypoints.length > 0) {
          body.intermediates = input.waypoints.map((wp) => ({
            location: {
              latLng: { latitude: wp.lat, longitude: wp.lng },
            },
          }));
        }

        const res = await fetch(
          "https://routes.googleapis.com/directions/v2:computeRoutes",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask":
                "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline",
            },
            body: JSON.stringify(body),
          },
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Google Routes API error: ${res.status} ${errText}`,
          });
        }

        const data = (await res.json()) as GoogleRouteResponse;
        const route = data.routes?.[0];
        if (!route) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No route found",
          });
        }

        totalMiles = metersToMiles(route.distanceMeters);
        totalMinutes = durationToMinutes(route.duration);
        fullPolyline = route.polyline.encodedPolyline;
      }

      // Update trip with destination info
      await ctx.db
        .update(trips)
        .set({
          destinationName: input.destination.name,
          destinationLat: input.destination.lat.toString(),
          destinationLng: input.destination.lng.toString(),
          startDate: input.startDate,
        })
        .where(eq(trips.id, ctx.tripId));

      // Delete existing segments for this trip
      await ctx.db
        .delete(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId));

      if (input.autoSplit) {
        const points = decode(fullPolyline, 5).map(([lat, lng]) => ({
          lat,
          lng,
        }));

        const splitSegments = autoSplitRoute(
          points,
          totalMiles,
          new Date(input.startDate + "T00:00:00"),
          input.origin.name,
          input.destination.name,
        );

        const created = [];
        for (let i = 0; i < splitSegments.length; i++) {
          const seg = splitSegments[i]!;
          const [row] = await ctx.db
            .insert(tripSegments)
            .values({
              tripId: ctx.tripId,
              name: seg.name,
              originName: i === 0 ? input.origin.name : undefined,
              originLat: seg.origin.lat.toString(),
              originLng: seg.origin.lng.toString(),
              destinationName:
                i === splitSegments.length - 1
                  ? input.destination.name
                  : `Day ${i + 1} overnight`,
              destinationLat: seg.destination.lat.toString(),
              destinationLng: seg.destination.lng.toString(),
              routePolyline: seg.encodedPolyline,
              distanceMiles: seg.distanceMiles.toString(),
              durationMinutes: seg.durationMinutes,
              startDate: seg.startDate,
              endDate: seg.startDate,
              tz: "America/Los_Angeles",
              sortOrder: i,
            })
            .returning();
          if (!row) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create trip segment",
            });
          }
          created.push(row);
        }

        const { legs: gatedSegments, totalNonDrivableMinutes } =
          await gateSegmentsWithFerries(ctx.db, ctx.tripId, created);

        // Lean return: clients re-fetch segments via listSegments. Returning
        // the full FerryGatedLeg[] here bloated tRPC RouterOutputs past TS's
        // inference ceiling (collapsing app-wide types to `any`).
        return {
          totalMiles,
          totalMinutes,
          segmentCount: gatedSegments.length,
          ferryNonDrivableMinutes: totalNonDrivableMinutes,
        };
      }

      // No auto-split: single segment
      const [single] = await ctx.db
        .insert(tripSegments)
        .values({
          tripId: ctx.tripId,
          name: `${input.origin.name} → ${input.destination.name}`,
          originName: input.origin.name,
          originLat: input.origin.lat.toString(),
          originLng: input.origin.lng.toString(),
          destinationName: input.destination.name,
          destinationLat: input.destination.lat.toString(),
          destinationLng: input.destination.lng.toString(),
          routePolyline: fullPolyline,
          distanceMiles: totalMiles.toString(),
          durationMinutes: totalMinutes,
          startDate: input.startDate,
          endDate: input.startDate,
          tz: "America/Los_Angeles",
          sortOrder: 0,
        })
        .returning();

      if (!single) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create trip segment",
        });
      }

      const { legs: gatedSingle, totalNonDrivableMinutes } =
        await gateSegmentsWithFerries(ctx.db, ctx.tripId, [single]);

      return {
        totalMiles,
        totalMinutes,
        segmentCount: gatedSingle.length,
        ferryNonDrivableMinutes: totalNonDrivableMinutes,
      };
    }),

  getRoutePreview: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          distanceMiles: tripSegments.distanceMiles,
          durationMinutes: tripSegments.durationMinutes,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId));

      const totalMiles = rows.reduce(
        (sum, s) => sum + (s.distanceMiles ? Number(s.distanceMiles) : 0),
        0,
      );
      const totalMinutes = rows.reduce(
        (sum, s) => sum + (s.durationMinutes ?? 0),
        0,
      );

      return {
        segmentCount: rows.length,
        totalMiles: Math.round(totalMiles * 10) / 10,
        totalMinutes,
      };
    }),

  /**
   * Predict the Fuel Zones + Overnight Zones for a planned road trip, feeding
   * the markers the route-gradient map and TripTik strip already render.
   *
   * Fail-soft: an incomplete van model (no MPG/tank) simply yields no fuel
   * zones; overnight zones come from the auto-split segment boundaries and need
   * no van data.
   */
  predictZones: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
      }),
    )
    .query(async ({ ctx }) => {
      const [trip] = await ctx.db
        .select({ workspaceId: trips.workspaceId })
        .from(trips)
        .where(eq(trips.id, ctx.tripId))
        .limit(1);

      const segments = await ctx.db
        .select({
          sortOrder: tripSegments.sortOrder,
          originLat: tripSegments.originLat,
          originLng: tripSegments.originLng,
          destinationLat: tripSegments.destinationLat,
          destinationLng: tripSegments.destinationLng,
          routePolyline: tripSegments.routePolyline,
          distanceMiles: tripSegments.distanceMiles,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId));

      segments.sort((a, b) => a.sortOrder - b.sortOrder);

      // Van fuel model (optional — drives fuel zones only). Prefer the van
      // actually used on this trip (latest fuel log), else the workspace's sole
      // van profile.
      let mpg: number | null = null;
      let tankGallons: number | null = null;
      let vanProfileId: string | null = null;

      const [latestFuelLog] = await ctx.db
        .select({ vanProfileId: fuelLogs.vanProfileId })
        .from(fuelLogs)
        .where(
          and(
            eq(fuelLogs.tripId, ctx.tripId),
            isNotNull(fuelLogs.vanProfileId),
          ),
        )
        .orderBy(desc(fuelLogs.loggedAt))
        .limit(1);
      vanProfileId = latestFuelLog?.vanProfileId ?? null;

      if (!vanProfileId && trip) {
        const workspaceVans = await ctx.db
          .select({ id: vanProfiles.id })
          .from(vanProfiles)
          .where(eq(vanProfiles.workspaceId, trip.workspaceId))
          .limit(2);
        if (workspaceVans.length === 1) {
          vanProfileId = workspaceVans[0]!.id;
        }
      }

      if (vanProfileId) {
        const [van] = await ctx.db
          .select({
            mpgEstimate: vanProfiles.mpgEstimate,
            tankGallons: vanProfiles.tankGallons,
          })
          .from(vanProfiles)
          .where(eq(vanProfiles.id, vanProfileId))
          .limit(1);
        mpg = van?.mpgEstimate != null ? Number(van.mpgEstimate) : null;
        tankGallons = van?.tankGallons != null ? Number(van.tankGallons) : null;
      }

      // Build the route polyline: prefer each segment's encoded polyline, else
      // fall back to its origin → destination endpoints.
      const points: ZoneLatLng[] = [];
      const pushPoint = (lat: number, lng: number) => {
        const last = points[points.length - 1];
        if (last && last.lat === lat && last.lng === lng) return;
        points.push({ lat, lng });
      };
      for (const seg of segments) {
        if (seg.routePolyline) {
          for (const [lat, lng] of decode(seg.routePolyline, 5)) {
            pushPoint(lat, lng);
          }
          continue;
        }
        if (seg.originLat != null && seg.originLng != null) {
          pushPoint(Number(seg.originLat), Number(seg.originLng));
        }
        if (seg.destinationLat != null && seg.destinationLng != null) {
          pushPoint(Number(seg.destinationLat), Number(seg.destinationLng));
        }
      }

      const rangeMiles = fuelRangeMiles(mpg, tankGallons);
      const fuelZones = computeFuelZones(points, rangeMiles);

      const zoneSegments: ZoneSegment[] = segments.map((s) => ({
        destinationLat:
          s.destinationLat != null ? Number(s.destinationLat) : null,
        destinationLng:
          s.destinationLng != null ? Number(s.destinationLng) : null,
        distanceMiles: s.distanceMiles != null ? Number(s.distanceMiles) : null,
      }));
      const overnightZones = computeOvernightZones(zoneSegments);

      return {
        fuelZones,
        overnightZones,
        rangeMiles: Math.round(rangeMiles),
        hasVanModel: rangeMiles > 0,
      };
    }),

  /**
   * Side-trip probe: is the live GPS position more than ~2 mi off the planned
   * route polyline? Pure geometry; clients poll from Driving Mode.
   */
  assessSideTrip: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        thresholdMiles: z.number().positive().max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const segments = await ctx.db
        .select({
          sortOrder: tripSegments.sortOrder,
          originLat: tripSegments.originLat,
          originLng: tripSegments.originLng,
          destinationLat: tripSegments.destinationLat,
          destinationLng: tripSegments.destinationLng,
          routePolyline: tripSegments.routePolyline,
        })
        .from(tripSegments)
        .where(eq(tripSegments.tripId, ctx.tripId));

      segments.sort((a, b) => a.sortOrder - b.sortOrder);

      const points: ZoneLatLng[] = [];
      const pushPoint = (lat: number, lng: number) => {
        const last = points[points.length - 1];
        if (last && last.lat === lat && last.lng === lng) return;
        points.push({ lat, lng });
      };
      for (const seg of segments) {
        if (seg.routePolyline) {
          for (const [lat, lng] of decode(seg.routePolyline, 5)) {
            pushPoint(lat, lng);
          }
          continue;
        }
        if (seg.originLat != null && seg.originLng != null) {
          pushPoint(Number(seg.originLat), Number(seg.originLng));
        }
        if (seg.destinationLat != null && seg.destinationLng != null) {
          pushPoint(Number(seg.destinationLat), Number(seg.destinationLng));
        }
      }

      // Cap density so assessment stays cheap on long multi-day routes.
      const sampled =
        points.length <= 400
          ? points
          : points.filter(
              (_, i) => i % Math.ceil(points.length / 400) === 0,
            );

      return assessSideTrip({
        position: { lat: input.lat, lng: input.lng },
        routePoints: sampled,
        thresholdMiles: input.thresholdMiles,
      });
    }),

  searchPlaces: protectedProcedure
    .input(z.object({ query: z.string().min(2).max(200) }))
    .query(async ({ input }) => {
      const apiKey =
        process.env.GOOGLE_ROUTES_API_KEY ??
        process.env.GOOGLE_MAPS_API_KEY ??
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Google Maps API key not configured",
        });
      }

      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(input.query)}&key=${apiKey}`,
      );
      const data = (await res.json()) as {
        status?: string;
        error_message?: string;
        results?: Array<{
          place_id: string;
          formatted_address: string;
          geometry: { location: { lat: number; lng: number } };
          address_components?: Array<{
            long_name: string;
            types: string[];
          }>;
        }>;
      };

      if (
        data.status &&
        data.status !== "OK" &&
        data.status !== "ZERO_RESULTS"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Geocoding API: ${data.status}`,
        });
      }

      return (data.results ?? []).slice(0, 5).map((r) => {
        const locality = r.address_components?.find((c) =>
          c.types.includes("locality"),
        );
        const admin = r.address_components?.find((c) =>
          c.types.includes("administrative_area_level_1"),
        );
        const name =
          locality?.long_name ?? r.formatted_address.split(",")[0] ?? "";
        const shortAddr = admin
          ? `${name}, ${admin.long_name}`
          : r.formatted_address;
        return {
          name,
          address: shortAddr,
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          placeId: r.place_id,
        };
      });
    }),

  /**
   * Dual-candidate routes (primary + Google alternatives). Labels coast/inland
   * or shorter when geometry supports it. Does not write segments — preview only.
   */
  listCandidates: tripProcedure()
    .input(
      z.object({
        workspaceId: z.string().min(1),
        tripId: z.string().min(1),
        origin: z.object({
          name: z.string().optional(),
          lat: z.number(),
          lng: z.number(),
        }),
        destination: z.object({
          name: z.string().optional(),
          lat: z.number(),
          lng: z.number(),
        }),
        waypoints: z
          .array(
            z.object({
              lat: z.number(),
              lng: z.number(),
            }),
          )
          .default([]),
      }),
    )
    .query(async ({ input }) => {
      const apiKey =
        process.env.GOOGLE_ROUTES_API_KEY ??
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

      if (!apiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Google Routes API key not configured",
        });
      }

      const body: Record<string, unknown> = {
        origin: {
          location: {
            latLng: {
              latitude: input.origin.lat,
              longitude: input.origin.lng,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: input.destination.lat,
              longitude: input.destination.lng,
            },
          },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineEncoding: "ENCODED_POLYLINE",
        computeAlternativeRoutes: true,
      };

      if (input.waypoints.length > 0) {
        body.intermediates = input.waypoints.map((wp) => ({
          location: {
            latLng: { latitude: wp.lat, longitude: wp.lng },
          },
        }));
      }

      const res = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
          },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Google Routes API error: ${res.status} ${errText}`,
        });
      }

      const data = (await res.json()) as GoogleRouteResponse;
      const raw = data.routes ?? [];
      if (raw.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No route candidates found",
        });
      }

      const inputs = raw.map((route) => {
        let samplePoints: LatLng[] | undefined;
        try {
          const decoded = decode(route.polyline.encodedPolyline, 5);
          // Sample ~20 points for coastal/inland midpoint.
          const step = Math.max(1, Math.floor(decoded.length / 20));
          samplePoints = decoded
            .filter((_, i) => i % step === 0)
            .map(([lat, lng]) => ({ lat: lat!, lng: lng! }));
        } catch {
          samplePoints = undefined;
        }
        return {
          distanceMiles: metersToMiles(route.distanceMeters),
          durationMinutes: durationToMinutes(route.duration),
          encodedPolyline: route.polyline.encodedPolyline,
          samplePoints,
        };
      });

      return labelRouteCandidates(inputs);
    }),
} satisfies TRPCRouterRecord;

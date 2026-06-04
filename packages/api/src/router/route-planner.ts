import { decode, encode } from "@googlemaps/polyline-codec";
import { asc, eq } from "@sortey/db";
import { tripSegments, trips } from "@sortey/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import SunCalc from "suncalc";
import { z } from "zod/v4";

import { tripProcedure } from "../auth/guards";
import { protectedProcedure } from "../trpc";

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
      }),
    )
    .mutation(async ({ ctx, input }) => {
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

      const totalMiles = metersToMiles(route.distanceMeters);
      const totalMinutes = durationToMinutes(route.duration);
      const fullPolyline = route.polyline.encodedPolyline;

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
          created.push(row);
        }

        return {
          totalMiles,
          totalMinutes,
          fullPolyline,
          segments: created,
          segmentCount: created.length,
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

      return {
        totalMiles,
        totalMinutes,
        fullPolyline,
        segments: [single],
        segmentCount: 1,
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
} satisfies TRPCRouterRecord;

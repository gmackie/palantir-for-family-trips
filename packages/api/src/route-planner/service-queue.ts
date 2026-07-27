/**
 * Ordered van service stops for the rest of the day — dump → water → fuel → sleep.
 * Pure ranking of already-scanned amenity POIs.
 */

export interface ServiceStop {
  kind: "dump" | "water" | "fuel" | "sleep" | "parking";
  priority: number;
  name: string;
  lat: number;
  lng: number;
  milesAway: number;
  category?: string;
  /** Why this is in the queue */
  reason: string;
}

export interface ServiceQueueInput {
  dump?: { name: string; lat: number; lng: number; milesAway: number } | null;
  water?: { name: string; lat: number; lng: number; milesAway: number } | null;
  fuel?: { name: string; lat: number; lng: number; milesAway: number } | null;
  overnight?: {
    name: string;
    lat: number;
    lng: number;
    milesAway: number;
    category?: string;
  } | null;
  parking?: {
    name: string;
    lat: number;
    lng: number;
    milesAway: number;
  } | null;
  /** If true, elevate dump (grey/black full soon). */
  needDump?: boolean;
  needWater?: boolean;
  needFuel?: boolean;
  warnings?: string[];
}

/**
 * Build a short ordered service queue. Default order dump → water → fuel → sleep
 * unless needs flags re-prioritize.
 */
export function buildServiceQueue(input: ServiceQueueInput): ServiceStop[] {
  const stops: ServiceStop[] = [];
  let priority = 0;

  const push = (
    kind: ServiceStop["kind"],
    poi: { name: string; lat: number; lng: number; milesAway: number },
    reason: string,
    category?: string,
  ) => {
    stops.push({
      kind,
      priority: priority++,
      name: poi.name,
      lat: poi.lat,
      lng: poi.lng,
      milesAway: poi.milesAway,
      category,
      reason,
    });
  };

  // Elevate based on needs / warnings text
  const warn = (input.warnings ?? []).join(" ").toLowerCase();
  const needDump =
    input.needDump || warn.includes("dump") || warn.includes("grey");
  const needWater =
    input.needWater || warn.includes("water") || warn.includes("fresh");
  const needFuel =
    input.needFuel || warn.includes("fuel") || warn.includes("gas");

  const order: Array<{
    kind: ServiceStop["kind"];
    poi: ServiceQueueInput["dump"];
    reason: string;
    elevate: boolean;
  }> = [
    {
      kind: "dump",
      poi: input.dump,
      reason: needDump ? "Tanks need dump soon" : "Dump if convenient",
      elevate: needDump,
    },
    {
      kind: "water",
      poi: input.water,
      reason: needWater ? "Fresh water low" : "Water fill if convenient",
      elevate: needWater,
    },
    {
      kind: "fuel",
      poi: input.fuel,
      reason: needFuel ? "Fuel range tight" : "Fuel before overnight",
      elevate: needFuel,
    },
    {
      kind: "sleep",
      poi: input.overnight,
      reason: "Tonight's sleep",
      elevate: false,
    },
  ];

  // Elevated first (stable among elevated by original dump→water→fuel)
  const elevated = order.filter((o) => o.elevate && o.poi);
  const rest = order.filter((o) => !o.elevate && o.poi);
  for (const o of [...elevated, ...rest]) {
    if (!o.poi) continue;
    push(
      o.kind,
      o.poi,
      o.reason,
      o.kind === "sleep" ? input.overnight?.category : undefined,
    );
  }

  return stops;
}

/**
 * One-shot: replan Van Journey remaining arc with open_sauce_full from today.
 * Usage:
 *   DATABASE_URL=... GOOGLE_ROUTES_API_KEY=... pnpm -F @sortey/api exec tsx scripts/seed-open-sauce-plan.ts
 */
import { db } from "@sortey/db/client";

import {
  planItineraryOp,
  resolveTemplate,
} from "../src/route-planner/plan-itinerary-ops";

const TRIP_ID = "12913c5b-8536-4e99-be38-116ce5e1ae64";
const WORKSPACE_ID = "5a34cd1a-6b66-47a5-bdce-d0bfac2e0dad";
const FROM_DATE = "2026-07-12";

async function main() {
  const result = await planItineraryOp(db, {
    tripId: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    stops: resolveTemplate("open_sauce_full"),
    fromDate: FROM_DATE,
    origin: {
      lat: 45.342,
      lng: -121.943,
      name: "Zigzag Mountain Farm",
    },
    autoAssignOvernights: true,
    replaceExisting: true,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

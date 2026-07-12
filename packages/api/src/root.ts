import { adminRouter } from "./router/admin";
import { anchorsRouter } from "./router/anchors";
import { authRouter } from "./router/auth";
import { chatRouter } from "./router/chat";
import { corridorRouter } from "./router/corridor";
import { daymapRouter } from "./router/daymap";
import { expensesRouter } from "./router/expenses";
import { ferriesRouter } from "./router/ferries";
import { fuelLogsRouter } from "./router/fuel-logs";
import { itineraryRouter } from "./router/itinerary";
import { journeyRouter } from "./router/journey";
import { locationRouter } from "./router/location";
import { lodgingRouter } from "./router/lodging";
import { notificationsRouter } from "./router/notifications";
import { photosRouter } from "./router/photos";
import { pinsRouter } from "./router/pins";
import { plannerRouter } from "./router/planner";
import { planningRouter } from "./router/planning";
import { postRouter } from "./router/post";
import { roomsRouter } from "./router/rooms";
import { routePlannerRouter } from "./router/route-planner";
import { settingsRouter } from "./router/settings";
import { settlementsRouter } from "./router/settlements";
import { shareRouter } from "./router/share";
import { tripsRouter } from "./router/trips";
import { vanProfilesRouter } from "./router/van-profiles";
import { vanTelemetryRouter } from "./router/van-telemetry";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  anchors: anchorsRouter,
  auth: authRouter,
  chat: chatRouter,
  corridor: corridorRouter,
  daymap: daymapRouter,
  expenses: expensesRouter,
  ferries: ferriesRouter,
  fuelLogs: fuelLogsRouter,
  itinerary: itineraryRouter,
  journey: journeyRouter,
  location: locationRouter,
  lodging: lodgingRouter,
  notifications: notificationsRouter,
  photos: photosRouter,
  pins: pinsRouter,
  planner: plannerRouter,
  planning: planningRouter,
  post: postRouter,
  rooms: roomsRouter,
  routePlanner: routePlannerRouter,
  settings: settingsRouter,
  settlements: settlementsRouter,
  share: shareRouter,
  trips: tripsRouter,
  vanProfiles: vanProfilesRouter,
  vanTelemetry: vanTelemetryRouter,
});

export type AppRouter = typeof appRouter;

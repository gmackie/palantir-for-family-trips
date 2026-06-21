import { adminRouter } from "./router/admin";
import { authRouter } from "./router/auth";
import { chatRouter } from "./router/chat";
import { corridorRouter } from "./router/corridor";
import { expensesRouter } from "./router/expenses";
import { ferriesRouter } from "./router/ferries";
import { fuelLogsRouter } from "./router/fuel-logs";
import { itineraryRouter } from "./router/itinerary";
import { locationRouter } from "./router/location";
import { lodgingRouter } from "./router/lodging";
import { notificationsRouter } from "./router/notifications";
import { photosRouter } from "./router/photos";
import { pinsRouter } from "./router/pins";
import { planningRouter } from "./router/planning";
import { postRouter } from "./router/post";
import { routePlannerRouter } from "./router/route-planner";
import { settingsRouter } from "./router/settings";
import { settlementsRouter } from "./router/settlements";
import { tripsRouter } from "./router/trips";
import { vanProfilesRouter } from "./router/van-profiles";
import { vanTelemetryRouter } from "./router/van-telemetry";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  auth: authRouter,
  chat: chatRouter,
  corridor: corridorRouter,
  expenses: expensesRouter,
  ferries: ferriesRouter,
  fuelLogs: fuelLogsRouter,
  itinerary: itineraryRouter,
  location: locationRouter,
  lodging: lodgingRouter,
  notifications: notificationsRouter,
  photos: photosRouter,
  pins: pinsRouter,
  planning: planningRouter,
  post: postRouter,
  routePlanner: routePlannerRouter,
  settings: settingsRouter,
  settlements: settlementsRouter,
  trips: tripsRouter,
  vanProfiles: vanProfilesRouter,
  vanTelemetry: vanTelemetryRouter,
});

export type AppRouter = typeof appRouter;

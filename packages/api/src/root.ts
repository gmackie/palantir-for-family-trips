import { adminRouter } from "./router/admin";
import { authRouter } from "./router/auth";
import { corridorRouter } from "./router/corridor";
import { expensesRouter } from "./router/expenses";
import { fuelLogsRouter } from "./router/fuel-logs";
import { lodgingRouter } from "./router/lodging";
import { pinsRouter } from "./router/pins";
import { planningRouter } from "./router/planning";
import { postRouter } from "./router/post";
import { routePlannerRouter } from "./router/route-planner";
import { settingsRouter } from "./router/settings";
import { settlementsRouter } from "./router/settlements";
import { tripsRouter } from "./router/trips";
import { vanProfilesRouter } from "./router/van-profiles";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  auth: authRouter,
  corridor: corridorRouter,
  expenses: expensesRouter,
  fuelLogs: fuelLogsRouter,
  lodging: lodgingRouter,
  pins: pinsRouter,
  planning: planningRouter,
  post: postRouter,
  routePlanner: routePlannerRouter,
  settings: settingsRouter,
  settlements: settlementsRouter,
  trips: tripsRouter,
  vanProfiles: vanProfilesRouter,
});

export type AppRouter = typeof appRouter;

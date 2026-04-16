import { adminRouter } from "./router/admin";
import { authRouter } from "./router/auth";
import { expensesRouter } from "./router/expenses";
import { pinsRouter } from "./router/pins";
import { planningRouter } from "./router/planning";
import { postRouter } from "./router/post";
import { settingsRouter } from "./router/settings";
import { settlementsRouter } from "./router/settlements";
import { tripsRouter } from "./router/trips";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  auth: authRouter,
  expenses: expensesRouter,
  pins: pinsRouter,
  planning: planningRouter,
  post: postRouter,
  settings: settingsRouter,
  settlements: settlementsRouter,
  trips: tripsRouter,
});

export type AppRouter = typeof appRouter;

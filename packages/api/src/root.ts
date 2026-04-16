import { adminRouter } from "./router/admin";
import { authRouter } from "./router/auth";
import { expensesRouter } from "./router/expenses";
import { postRouter } from "./router/post";
import { settingsRouter } from "./router/settings";
import { tripsRouter } from "./router/trips";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  auth: authRouter,
  expenses: expensesRouter,
  post: postRouter,
  settings: settingsRouter,
  trips: tripsRouter,
});

export type AppRouter = typeof appRouter;

import { appRouter, createTRPCContext } from "@gmacko/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, getSession } from "~/auth/server";

export async function requireTripsWorkspace() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/sign-in");
  }

  const requestHeaders = new Headers(await headers());
  const caller = appRouter.createCaller(
    await createTRPCContext({
      headers: requestHeaders,
      authApi: auth.api,
    }),
  );
  const workspaceContext = await caller.settings.getWorkspaceContext();

  if (!workspaceContext.workspace) {
    redirect("/");
  }

  return {
    caller,
    session,
    workspace: workspaceContext.workspace,
    workspaceContext,
  };
}

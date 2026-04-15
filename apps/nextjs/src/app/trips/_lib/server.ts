import { appRouter, createTRPCContext } from "@gmacko/api";
import { ensurePersonalWorkspace } from "@gmacko/api/workspace";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, getSession } from "~/auth/server";

export async function requireTripsWorkspace() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/sign-in");
  }

  await ensurePersonalWorkspace({
    userId: session.user.id,
    userName: session.user.name ?? "",
    userEmail: session.user.email,
  });

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

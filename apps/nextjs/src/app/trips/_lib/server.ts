import { appRouter, createTRPCContext } from "@sortey/api";
import { ensurePersonalWorkspace } from "@sortey/api/workspace";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, getSession } from "~/auth/server";

export async function requireTripsWorkspace() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/sign-in");
  }

  try {
    await ensurePersonalWorkspace({
      userId: session.user.id,
      userName: session.user.name ?? "",
      userEmail: session.user.email,
    });
  } catch (error) {
    console.error(
      "[requireTripsWorkspace] ensurePersonalWorkspace failed:",
      error,
    );
    // Surface a recoverable error page instead of a silent redirect home.
    redirect("/trips/setup-error");
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
    redirect("/trips/setup-error");
  }

  return {
    caller,
    session,
    workspace: workspaceContext.workspace,
    workspaceContext,
  };
}

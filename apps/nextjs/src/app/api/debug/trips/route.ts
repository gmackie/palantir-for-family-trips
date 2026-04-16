import { appRouter, createTRPCContext } from "@gmacko/api";
import { ensurePersonalWorkspace } from "@gmacko/api/workspace";
import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth, getSession } from "~/auth/server";

export async function GET(request: NextRequest) {
  const steps: Record<string, unknown> = {};

  try {
    const session = await getSession();
    steps.session = session ? { id: session.user.id, email: session.user.email } : null;

    if (!session?.user) {
      return NextResponse.json({ steps, error: "No session" }, { status: 401 });
    }

    try {
      await ensurePersonalWorkspace({
        userId: session.user.id,
        userName: session.user.name ?? "",
        userEmail: session.user.email,
      });
      steps.ensureWorkspace = "ok";
    } catch (e) {
      steps.ensureWorkspace = { error: String(e) };
    }

    const requestHeaders = new Headers(await headers());
    const caller = appRouter.createCaller(
      await createTRPCContext({
        headers: requestHeaders,
        authApi: auth.api,
      }),
    );
    steps.callerCreated = true;

    try {
      const ctx = await caller.settings.getWorkspaceContext();
      steps.workspaceContext = ctx.workspace ? { id: ctx.workspace.id, name: ctx.workspace.name } : null;
    } catch (e) {
      steps.workspaceContext = { error: String(e) };
    }

    if (steps.workspaceContext && typeof steps.workspaceContext === "object" && "id" in steps.workspaceContext) {
      try {
        const trips = await caller.trips.list({
          workspaceId: (steps.workspaceContext as { id: string }).id,
        });
        steps.tripsList = { count: trips.length };
      } catch (e) {
        steps.tripsList = { error: String(e) };
      }
    }

    return NextResponse.json({ steps });
  } catch (e) {
    return NextResponse.json({ steps, fatalError: String(e) }, { status: 500 });
  }
}

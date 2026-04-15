import { appRouter, createTRPCContext } from "@gmacko/api";
import { Button } from "@gmacko/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@gmacko/ui/field";
import { Input } from "@gmacko/ui/input";
import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "~/auth/server";
import { DestinationPicker } from "../../_components/destination-picker";
import { requireTripsWorkspace } from "../../_lib/server";
import { parseTripSettingsFormData } from "../../_lib/trip-settings-form";

export default async function TripSettingsPage(props: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await props.params;
  const { caller, workspace, workspaceContext } = await requireTripsWorkspace();

  try {
    const trip = await caller.trips.get({
      workspaceId: workspace.id,
      tripId,
    });

    async function updateTripSettingsAction(formData: FormData) {
      "use server";

      const requestHeaders = new Headers(await headers());
      const actionCaller = appRouter.createCaller(
        await createTRPCContext({
          headers: requestHeaders,
          authApi: auth.api,
        }),
      );
      const actionWorkspaceContext =
        await actionCaller.settings.getWorkspaceContext();

      if (!actionWorkspaceContext.workspace) {
        redirect("/");
      }

      const tripsCaller = actionCaller.trips as {
        setClaimMode: (input: {
          workspaceId: string;
          tripId: string;
          claimMode: "organizer" | "tap";
        }) => Promise<unknown>;
        setGroupMode: (input: {
          workspaceId: string;
          tripId: string;
          groupMode: boolean;
        }) => Promise<unknown>;
        update: (input: {
          workspaceId: string;
          tripId: string;
          name: string;
          destinationName: string;
          startDate?: string;
          endDate?: string;
          tz?: string;
        }) => Promise<unknown>;
      };

      const input = parseTripSettingsFormData(formData);
      const tripUpdateInput = {
        workspaceId: actionWorkspaceContext.workspace.id,
        tripId,
        name: input.name,
        destinationName: input.destinationName,
        tz: input.tz,
        ...(input.startDate ? { startDate: input.startDate } : {}),
        ...(input.endDate ? { endDate: input.endDate } : {}),
      };

      await tripsCaller.update(tripUpdateInput);
      await tripsCaller.setGroupMode({
        workspaceId: actionWorkspaceContext.workspace.id,
        tripId,
        groupMode: input.groupMode,
      });
      await tripsCaller.setClaimMode({
        workspaceId: actionWorkspaceContext.workspace.id,
        tripId,
        claimMode: input.claimMode,
      });

      redirect(`/trips/${tripId}/settings?saved=1`);
    }

    return (
      <main className="container mx-auto max-w-4xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
              Trip Settings
            </p>
            <h1 className="text-4xl font-black tracking-tight">{trip.name}</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Organizer controls for {workspace.name}. Group mode and claim mode
              stay trip-scoped.
            </p>
          </div>

          <Button asChild variant="outline">
            <Link href={`/trips/${trip.id}`}>Back to trip</Link>
          </Button>
        </div>

        <form
          action={updateTripSettingsAction}
          className="bg-card mt-8 rounded-3xl border p-6 shadow-sm"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Trip name</FieldLabel>
              <FieldContent>
                <Input
                  id="name"
                  name="name"
                  defaultValue={trip.name}
                  required
                />
              </FieldContent>
            </Field>

            <DestinationPicker defaultValue={trip.destinationName ?? ""} />

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="startDate">Start date</FieldLabel>
                <FieldContent>
                  <Input
                    id="startDate"
                    name="startDate"
                    type="date"
                    defaultValue={trip.startDate ?? ""}
                  />
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="endDate">End date</FieldLabel>
                <FieldContent>
                  <Input
                    id="endDate"
                    name="endDate"
                    type="date"
                    defaultValue={trip.endDate ?? ""}
                  />
                </FieldContent>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="tz">Trip time zone</FieldLabel>
              <FieldContent>
                <Input id="tz" name="tz" defaultValue={trip.tz} required />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="groupMode">Group mode</FieldLabel>
              <FieldContent>
                <label className="flex items-center gap-3 text-sm">
                  <input
                    id="groupMode"
                    name="groupMode"
                    type="checkbox"
                    defaultChecked={trip.groupMode}
                  />
                  <span>
                    Enable the shared claim-and-settlement workflow for this
                    trip.
                  </span>
                </label>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="claimMode">Claim mode</FieldLabel>
              <FieldContent>
                <select
                  id="claimMode"
                  name="claimMode"
                  defaultValue={trip.claimMode}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  <option value="organizer">Organizer</option>
                  <option value="tap">Tap-to-claim</option>
                </select>
                <FieldDescription>
                  Organizer mode keeps receipt allocation centralized. Tap mode
                  is the realtime-first claim flow from the plan.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>

          <section className="border-border mt-8 rounded-2xl border p-4">
            <h2 className="text-lg font-semibold">Membership surface</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Invite sending, member roster management, and personal payment
              handles are the next Phase 2 slice. This page now owns the core
              trip settings and mode toggles the rest of that surface depends
              on.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Workspace role</dt>
                <dd>{workspaceContext.workspaceRole ?? "member"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Trip status</dt>
                <dd className="capitalize">{trip.status}</dd>
              </div>
            </dl>
          </section>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button asChild variant="outline">
              <Link href={`/trips/${trip.id}`}>Cancel</Link>
            </Button>
            <Button type="submit">Save settings</Button>
          </div>
        </form>
      </main>
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      notFound();
    }

    throw error;
  }
}

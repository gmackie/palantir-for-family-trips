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
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getSession } from "~/auth/server";
import { DestinationPicker } from "../_components/destination-picker";
import { parseCreateTripFormData } from "../_lib/create-trip-form";
import { requireTripsWorkspace } from "../_lib/server";

export default async function NewTripPage() {
  const { workspace } = await requireTripsWorkspace();

  async function createTripAction(formData: FormData) {
    "use server";

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

    const input = parseCreateTripFormData(formData);
    const created = await caller.trips.create({
      workspaceId: workspaceContext.workspace.id,
      ...input,
    });

    redirect(`/trips/${created.trip.id}`);
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm uppercase tracking-[0.24em]">
          New Trip
        </p>
        <h1 className="text-4xl font-black tracking-tight">Create a trip</h1>
        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
          This trip will be created inside {workspace.name}. Start with the
          destination, dates, and trip-local time zone.
        </p>
      </div>

      <form
        action={createTripAction}
        className="bg-card mt-8 rounded-3xl border p-6 shadow-sm"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Trip name</FieldLabel>
            <FieldContent>
              <Input
                id="name"
                name="name"
                placeholder="Italy Summer"
                required
              />
              <FieldDescription>
                Use the group-facing name people will recognize in the trip
                list.
              </FieldDescription>
            </FieldContent>
          </Field>

          <DestinationPicker />

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="startDate">Start date</FieldLabel>
              <FieldContent>
                <Input id="startDate" name="startDate" type="date" />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="endDate">End date</FieldLabel>
              <FieldContent>
                <Input id="endDate" name="endDate" type="date" />
              </FieldContent>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="tz">Trip time zone</FieldLabel>
            <FieldContent>
              <Input
                id="tz"
                name="tz"
                defaultValue="UTC"
                placeholder="Europe/Rome"
              />
              <FieldDescription>
                All trip-local schedule rendering will default to this zone.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/trips">Cancel</Link>
          </Button>
          <Button type="submit">Create trip</Button>
        </div>
      </form>
    </main>
  );
}

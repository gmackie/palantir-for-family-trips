import { appRouter, createTRPCContext } from "@sortey/api";
import { Button } from "@sortey/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@sortey/ui/field";
import { GroupModeToggle } from "@sortey/ui/group-mode-toggle";
import { Input } from "@sortey/ui/input";
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
    const tripMode = input.tripMode;
    const created = await caller.trips.create({
      workspaceId: workspaceContext.workspace.id,
      name: input.name,
      tripMode,
      destinationName: input.destinationName,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      startDate: input.startDate,
      endDate: input.endDate,
      tz: input.tz,
      groupMode: input.groupMode,
    });

    if (tripMode === "roadtrip") {
      redirect(`/trips/${created.trip.id}/road-trip`);
    }
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
          This trip will be created inside {workspace.name}. Choose destination
          or road-trip mode, family or group splitting, then set dates and a
          trip-local time zone.
        </p>
      </div>

      <form
        action={createTripAction}
        className="bg-card mt-8 rounded-3xl border p-6"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="tripMode">Trip mode</FieldLabel>
            <FieldContent>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="tripMode"
                    value="destination"
                    defaultChecked
                    className="accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">Destination</p>
                    <p className="text-muted-foreground text-xs">
                      Fixed place — area map, lodging, arrivals
                    </p>
                  </div>
                </label>
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="tripMode"
                    value="roadtrip"
                    className="accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">Road trip</p>
                    <p className="text-muted-foreground text-xs">
                      Route-based with fuel and overnight planning
                    </p>
                  </div>
                </label>
              </div>
              <FieldDescription>
                Trip mode is the map and planning paradigm. Group mode is
                separate — either kind of trip can be family or group.
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="groupMode">Group or family</FieldLabel>
            <FieldContent>
              <GroupModeToggle
                id="groupMode"
                name="groupMode"
                defaultValue={false}
                variant="cards"
              />
              <FieldDescription>
                Group mode unlocks members, receipt claims, and settlement. You
                can change this later in trip settings.
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="name">Trip name</FieldLabel>
            <FieldContent>
              <Input
                id="name"
                name="name"
                placeholder="Seattle to Des Moines"
                required
              />
              <FieldDescription>
                Use the group-facing name people will recognize in the trip
                list.
              </FieldDescription>
            </FieldContent>
          </Field>

          <DestinationPicker
            googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
          />

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

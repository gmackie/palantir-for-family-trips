import { appRouter, createTRPCContext } from "@sortey/api";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { auth, getSession } from "~/auth/server";
import { InviteSignInForm } from "../../invite/[token]/_components/invite-sign-in-form";
import { JoinButton } from "./_components/join-button";

// Copied from apps/nextjs/src/app/trips/page.tsx — dark Static Maps thumbnail of
// the destination, used as the OG card image when coordinates are available.
function mapThumbnailUrl(lat: string, lng: string) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=11&size=600x300&scale=2&maptype=roadmap&style=element:geometry%7Ccolor:0x161B22&style=element:labels.text.fill%7Ccolor:0x8B949E&style=element:labels.text.stroke%7Ccolor:0x0A0C10&style=feature:road%7Celement:geometry%7Ccolor:0x21262D&style=feature:water%7Celement:geometry%7Ccolor:0x0A0C10&key=${apiKey}`;
}

// Builds the OG card image for an active preview. Returns a dark Static Maps
// thumbnail of the destination when coordinates AND a Maps API key are
// available, otherwise null so the preview omits an image entirely (avoids a
// broken og:image for a non-existent fallback asset).
function ogImageForPreview(preview: {
  destinationLat: string | null;
  destinationLng: string | null;
}): string | null {
  if (preview.destinationLat && preview.destinationLng) {
    return mapThumbnailUrl(preview.destinationLat, preview.destinationLng);
  }
  return null;
}

async function createCaller() {
  const requestHeaders = new Headers(await headers());
  return appRouter.createCaller(
    await createTRPCContext({
      headers: requestHeaders,
      authApi: auth.api,
    }),
  );
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).formatRange(new Date(startDate), new Date(endDate));
  } catch {
    return null;
  }
}

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;

  let preview: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof createCaller>>["trips"]["getShareLinkPreview"]
    >
  >;
  try {
    const caller = await createCaller();
    preview = await caller.trips.getShareLinkPreview({ token });
  } catch {
    return { title: "Join a trip on Sortey" };
  }

  if (preview.status !== "active") {
    return { title: "Join a trip on Sortey" };
  }

  const dateRange = formatDateRange(preview.startDate, preview.endDate);
  const description = preview.destinationName
    ? `${preview.destinationName}${dateRange ? ` · ${dateRange}` : ""}`
    : (dateRange ?? "You're invited to a trip on Sortey");

  const ogImage = ogImageForPreview(preview);

  return {
    title: `Join ${preview.tripName} on Sortey`,
    description,
    openGraph: {
      title: `Join ${preview.tripName}`,
      description,
      // Only attach an image when a real Static Maps URL could be built;
      // omit it otherwise so platforms render a text-only preview.
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    // The large-image card only makes sense when there's an image to show.
    ...(ogImage ? { twitter: { card: "summary_large_image" as const } } : {}),
  };
}

export default async function JoinPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const session = await getSession();
  const caller = await createCaller();

  let preview: Awaited<ReturnType<typeof caller.trips.getShareLinkPreview>>;
  try {
    preview = await caller.trips.getShareLinkPreview({ token });
  } catch {
    preview = { status: "not_found" };
  }

  if (preview.status === "not_found" || preview.status === "disabled") {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-xl font-semibold">Invite unavailable</h1>
        <p className="text-sm text-muted-foreground">
          This invite link is no longer active. Ask the trip organizer to send
          you a new one.
        </p>
      </main>
    );
  }

  if (preview.status === "ended") {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-xl font-semibold">Trip ended</h1>
        <p className="text-sm text-muted-foreground">
          This trip has already ended.
        </p>
      </main>
    );
  }

  // status === "active"
  const dateRange = formatDateRange(preview.startDate, preview.endDate);

  if (!session?.user) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Trip invite
          </p>
          <h1 className="text-xl font-semibold">Join {preview.tripName}</h1>
          {preview.destinationName ? (
            <p className="text-sm text-muted-foreground">
              {preview.destinationName}
              {dateRange ? ` · ${dateRange}` : ""}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Sign in to join this trip.
          </p>
        </div>
        <InviteSignInForm token={token} callbackUrl={`/join/${token}`} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-6 py-16">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Trip invite
        </p>
        <h1 className="text-xl font-semibold">Join {preview.tripName}</h1>
        {preview.destinationName ? (
          <p className="text-sm text-muted-foreground">
            {preview.destinationName}
            {dateRange ? ` · ${dateRange}` : ""}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as {session.user.email}. Join to add this trip
          to your dashboard.
        </p>
      </div>
      <JoinButton token={token} />
    </main>
  );
}

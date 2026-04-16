import { appRouter, createTRPCContext } from "@gmacko/api";
import { Button } from "@gmacko/ui/button";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, getSession } from "~/auth/server";
import { AcceptInviteButton } from "./_components/accept-invite-button";
import { InviteSignInForm } from "./_components/invite-sign-in-form";

export default async function InvitePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const session = await getSession();
  const requestHeaders = new Headers(await headers());
  const caller = appRouter.createCaller(
    await createTRPCContext({
      headers: requestHeaders,
      authApi: auth.api,
    }),
  );

  let invite: Awaited<ReturnType<typeof caller.trips.getInviteByToken>>;
  try {
    invite = await caller.trips.getInviteByToken({ token });
  } catch {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-xl font-semibold">Invite not found</h1>
        <p className="text-sm text-muted-foreground">
          This invite link may have been revoked or never existed.
        </p>
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </main>
    );
  }

  if (invite.status === "expired") {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-xl font-semibold">Invite expired</h1>
        <p className="text-sm text-muted-foreground">
          This invite to {invite.tripName} has expired. Ask the trip organizer
          to send you a new one.
        </p>
      </main>
    );
  }

  if (invite.status === "already_accepted") {
    if (session?.user) {
      redirect(`/trips/${invite.tripId}`);
    }
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-xl font-semibold">Invite already accepted</h1>
        <p className="text-sm text-muted-foreground">
          This invite to {invite.tripName} has already been used. Sign in to
          view the trip.
        </p>
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </main>
    );
  }

  if (!session?.user) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Trip invite
          </p>
          <h1 className="text-xl font-semibold">Join {invite.tripName}</h1>
          <p className="text-sm text-muted-foreground">
            Sign in as{" "}
            <span className="font-medium text-foreground">{invite.email}</span>{" "}
            to accept.
          </p>
        </div>
        <InviteSignInForm email={invite.email} token={token} />
      </main>
    );
  }

  const sessionEmail = session.user.email.toLowerCase();
  if (sessionEmail !== invite.email.toLowerCase()) {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-16">
        <h1 className="text-xl font-semibold">Wrong account</h1>
        <p className="text-sm text-muted-foreground">
          This invite was sent to{" "}
          <span className="font-medium text-foreground">{invite.email}</span>,
          but you&apos;re signed in as {session.user.email}. Sign out and sign
          back in as the invited email.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-6 py-16">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Trip invite
        </p>
        <h1 className="text-xl font-semibold">Join {invite.tripName}</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as {session.user.email}. Accept to add this
          trip to your dashboard.
        </p>
      </div>
      <AcceptInviteButton token={token} />
    </main>
  );
}

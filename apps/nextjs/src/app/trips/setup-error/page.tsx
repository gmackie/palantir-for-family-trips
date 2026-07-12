import Link from "next/link";

export default function TripsSetupErrorPage() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-16">
      <div className="border-border bg-card max-w-lg rounded-none border p-8 shadow-sm">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.16em] uppercase">
          Workspace setup
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Couldn&apos;t open your workspace
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          We couldn&apos;t create or load a personal workspace for your account.
          This is usually a temporary database or permission issue — not a
          problem with your trip data.
        </p>
        <ul className="text-muted-foreground mt-4 list-disc space-y-1 pl-5 text-sm leading-6">
          <li>Retry setup — this re-runs personal workspace provisioning</li>
          <li>
            If it keeps failing, email{" "}
            <a className="underline" href="mailto:support@gmacko.com">
              support@gmacko.com
            </a>
          </li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/trips"
            className="bg-primary text-primary-foreground inline-flex items-center justify-center rounded-none px-4 py-2.5 text-sm font-semibold"
          >
            Retry
          </Link>
          <Link
            href="/"
            className="border-border text-foreground inline-flex items-center justify-center border px-4 py-2.5 text-sm font-medium"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";

import { MarketingPage } from "../_components/marketing-page";

export default function PricingPage() {
  return (
    <MarketingPage
      eyebrow="Pricing"
      title="Free while we dogfood"
      description="Sortey is free for private launch and road-trip beta users. Billing stays off until we ship a public plan."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <section className="border-border bg-card rounded-3xl border p-6 shadow-sm">
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            Current
          </p>
          <h2 className="mt-2 text-xl font-semibold">Free beta</h2>
          <p className="text-foreground mt-1 font-mono text-3xl font-semibold tabular-nums">
            $0
          </p>
          <ul className="text-muted-foreground mt-4 space-y-2 text-sm leading-6">
            <li>Personal workspace + group trips</li>
            <li>Expenses, claims, settlement</li>
            <li>Road-trip planner, day plan, amenities</li>
            <li>Maps, chat, journey log, mobile OTA</li>
            <li>No card required</li>
          </ul>
          <Link
            href="/sign-in"
            className="bg-primary text-primary-foreground mt-6 inline-flex rounded-none px-4 py-2.5 text-sm font-semibold"
          >
            Start free
          </Link>
        </section>

        <section className="border-border bg-card rounded-3xl border p-6 shadow-sm">
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            Later
          </p>
          <h2 className="mt-2 text-xl font-semibold">Paid plans</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Stripe / RevenueCat are scaffolded but{" "}
            <strong className="text-foreground font-medium">disabled</strong>.
            When we open a public launch we will publish clear limits (for
            example trip or member caps) and pricing before charging anyone.
          </p>
          <p className="text-muted-foreground mt-4 text-sm leading-6">
            Questions about commercial use or family groups larger than a private
            beta? Email{" "}
            <a className="underline" href="mailto:support@gmacko.com">
              support@gmacko.com
            </a>
            .
          </p>
          <p className="text-muted-foreground mt-6 text-xs leading-5">
            See also{" "}
            <Link href="/terms" className="underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline">
              Privacy
            </Link>
            .
          </p>
        </section>
      </div>
    </MarketingPage>
  );
}

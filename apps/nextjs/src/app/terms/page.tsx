import { MarketingPage } from "../_components/marketing-page";

function Section(props: { heading: string; children: React.ReactNode }) {
  return (
    <div className="border-border bg-card rounded-3xl border p-6 shadow-sm">
      <h2 className="text-foreground text-base font-semibold">
        {props.heading}
      </h2>
      <div className="text-muted-foreground mt-2 space-y-2 text-sm leading-6">
        {props.children}
      </div>
    </div>
  );
}

export default function TermsPage() {
  return (
    <MarketingPage
      eyebrow="Terms"
      title="Terms of service"
      description="Rules for using Sortey, a product of Gmacko Ventures LLC. Last updated July 12, 2026."
    >
      <div className="space-y-4">
        <Section heading="Agreement">
          <p>
            By creating an account or using Sortey (the web app at sortey.app and
            the Sortey mobile apps), you agree to these Terms. If you do not
            agree, do not use the service. Sortey is operated by Gmacko Ventures
            LLC (&quot;we&quot;, &quot;us&quot;). Contact{" "}
            <a className="underline" href="mailto:support@gmacko.com">
              support@gmacko.com
            </a>
            .
          </p>
        </Section>

        <Section heading="The service">
          <p>
            Sortey is a trip coordination product: workspaces, trips, itineraries,
            expenses, maps, road-trip planning, and related collaboration tools.
            Features may change as we improve the product. We may offer free
            access, limited beta features, or paid plans later; current pricing
            is described on the Pricing page.
          </p>
        </Section>

        <Section heading="Accounts">
          <p>
            You must provide a valid email and keep credentials secure. You are
            responsible for activity under your account. Do not share accounts in
            a way that bypasses membership or invite controls. We may suspend
            accounts that abuse the service or other users.
          </p>
        </Section>

        <Section heading="Your content">
          <p>
            You retain ownership of content you upload (trip data, photos,
            receipts, messages). You grant us a limited license to host, process,
            and display that content solely to operate Sortey. Workspace and trip
            organizers control who can access shared trip content. Do not upload
            unlawful, infringing, or harmful material.
          </p>
        </Section>

        <Section heading="Acceptable use">
          <p>
            You may not reverse engineer the service except where allowed by law,
            probe or overload systems (including rate-limit evasion), scrape other
            users&apos; data, spam invites, or use Sortey for fraud. Automated
            access must respect these Terms and any published API limits.
          </p>
        </Section>

        <Section heading="Third-party services">
          <p>
            Maps, routing, email delivery, push notifications, and similar
            features depend on third parties (for example Google Maps, Resend,
            Expo). Their terms and availability may affect Sortey. We are not
            responsible for third-party outages beyond reasonable care.
          </p>
        </Section>

        <Section heading="Disclaimers">
          <p>
            Sortey is provided &quot;as is&quot; without warranties of
            merchantability, fitness for a particular purpose, or non-infringement
            to the fullest extent permitted by law. Trip plans, amenity data
            (including imported POIs), fuel estimates, and side-trip prompts are
            decision aids — not guarantees of safety, access, legality of camping,
            or road conditions. Always verify local rules and use a dedicated
            navigator for turn-by-turn driving.
          </p>
        </Section>

        <Section heading="Limitation of liability">
          <p>
            To the maximum extent permitted by law, Gmacko Ventures LLC is not
            liable for indirect, incidental, special, consequential, or punitive
            damages, or for lost profits, data, or trip disruptions arising from
            use of Sortey. Our aggregate liability for claims relating to the
            service is limited to the greater of (a) amounts you paid us for
            Sortey in the 12 months before the claim or (b) fifty US dollars
            ($50) if you use a free tier.
          </p>
        </Section>

        <Section heading="Termination">
          <p>
            You may stop using Sortey at any time. We may suspend or terminate
            access for Terms violations or to protect the service. On request we
            will process account data deletion consistent with our Privacy Policy
            and applicable law.
          </p>
        </Section>

        <Section heading="Changes">
          <p>
            We may update these Terms. Material changes will be posted on this
            page with a new &quot;Last updated&quot; date. Continued use after
            changes constitutes acceptance of the revised Terms.
          </p>
        </Section>

        <Section heading="Governing law">
          <p>
            These Terms are governed by the laws of the State of Washington, USA,
            without regard to conflict-of-law rules, except where mandatory
            consumer protections in your jurisdiction apply.
          </p>
        </Section>
      </div>
    </MarketingPage>
  );
}

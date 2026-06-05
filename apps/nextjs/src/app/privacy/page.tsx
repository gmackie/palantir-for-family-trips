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

export default function PrivacyPage() {
  return (
    <MarketingPage
      eyebrow="Privacy"
      title="Privacy policy"
      description="How Sortey, a product of Gmacko Ventures LLC, collects and uses your information."
    >
      <div className="space-y-4">
        <Section heading="Who we are">
          <p>
            Sortey is a group-trip planning product operated by Gmacko Ventures
            LLC ("we", "us"). This policy covers the Sortey web app (sortey.app)
            and the Sortey mobile apps. Questions? Email{" "}
            <a className="underline" href="mailto:support@gmacko.com">
              support@gmacko.com
            </a>
            .
          </p>
        </Section>

        <Section heading="What we collect">
          <p>
            Account details (name, email), trips and trip content you create
            (segments, itineraries, expenses, photos, pins), and, if you choose
            to provide it, your mobile phone number. We also collect basic usage
            and device data to operate and secure the service.
          </p>
        </Section>

        <Section heading="SMS / text messaging">
          <p>
            If you provide your mobile number and opt in, Sortey sends
            transactional trip text messages — for example trip invitations,
            "someone hasn't joined yet" reminders, and trip notifications such
            as itinerary changes or expense settle-ups. Message and data rates
            may apply, and message frequency varies by your trip activity.
          </p>
          <p>
            Reply <strong>STOP</strong> to any message to opt out at any time,
            or <strong>HELP</strong> for help. Opting in to text messages is not
            a condition of using Sortey.
          </p>
          <p>
            <strong>
              We do not sell or rent your mobile number, and your mobile opt-in
              consent and phone number are never shared with third parties or
              affiliates for their own marketing or promotional purposes.
            </strong>{" "}
            We share data with service providers (such as our SMS carrier) only
            as needed to deliver the messages you requested.
          </p>
        </Section>

        <Section heading="How we use your information">
          <p>
            To provide and improve Sortey, authenticate you, deliver the
            notifications you opt into, prevent abuse, and meet legal
            obligations. We do not sell your personal information.
          </p>
        </Section>

        <Section heading="Data retention & your choices">
          <p>
            We keep your data while your account is active and as needed for
            legal and operational purposes. You can request access, correction,
            or deletion of your data, and manage notification preferences in the
            app, by contacting{" "}
            <a className="underline" href="mailto:support@gmacko.com">
              support@gmacko.com
            </a>
            .
          </p>
        </Section>

        <Section heading="Contact">
          <p>
            Gmacko Ventures LLC — Sortey ·{" "}
            <a className="underline" href="mailto:support@gmacko.com">
              support@gmacko.com
            </a>
          </p>
        </Section>
      </div>
    </MarketingPage>
  );
}

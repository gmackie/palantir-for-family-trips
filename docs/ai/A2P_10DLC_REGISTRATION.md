# A2P 10DLC Registration — Sortey (Twilio)

> ## 🗄️ SHELVED (2026-06-04) — do not action
> **Decision:** Sortey will **not** pursue A2P 10DLC / app-sent SMS. App-sent SMS *invites* are inherently non-compliant (A2P/carriers require prior consent; invites go to people who haven't consented → treated as spam). Member notifications are already covered by **device-sent invites** (Phase 1a, live) + **push notifications** (`registerPushToken`/Expo push, already built). SMS added too little reach for the LLC-brand vetting, campaign fees, and opt-in-consent build it required.
> This doc is kept only as a reference if SMS-to-opted-in-members is ever revisited. The privacy-policy SMS clause + "product of Gmacko Ventures LLC" attribution shipped on sortey.app are kept (accurate and future-proof regardless).

**(Historical) Status:** Not started. This was the long-lead prerequisite for **Phase 1b** (Twilio app-sent invites + reminders). Phase 1a (device-sent invites) is already live and needs **none** of this.

**Path chosen:** Standard brand (registered business with EIN).

**Who does what:**
- 🧑 = only you can do it (Twilio account, legal identity, payment, submitting forms).
- 🤖 = Claude can build it (the app-side compliance pieces).

---

## Why this exists / what it gates

Phase 1a invites are **device-sent** — the inviter's own phone sends the text via the OS share sheet. That is peer-to-peer and needs no A2P registration. **Do not block Phase 1a on this.**

A2P 10DLC is required only when **Sortey's servers** send SMS (Phase 1b: automated invites to phone numbers, "Bob hasn't joined" reminders, trip notifications). US carriers reject unregistered application-to-person traffic, so the Brand + Campaign must be approved first. Approval typically takes **a few business days to ~2 weeks** (Brand vetting is fast; Campaign vetting via TCR is the variable part) — hence "start now."

---

## 🧑 Prerequisites to gather (have these in hand before you start)

| Field | Value (fill in) | Notes |
|---|---|---|
| Legal business name | **Gmacko Ventures LLC** | EXACTLY as registered with the IRS — mismatches are the #1 rejection cause. (Sortey is a product **of** this LLC — the **brand** is Gmacko Ventures LLC; the **campaign** represents Sortey.) |
| EIN | `__________` | US Tax ID |
| Business type | `__________` | LLC / C-Corp / S-Corp / etc. |
| Business address | `__________` | Registered address |
| Brand website | `https://gmacko.com` (the LLC) — or `https://sortey.app` if Gmacko has no live site | Must be live. See the brand↔product note below |
| Authorized rep | name + title + email + phone | A real person Twilio can verify |
| Support email | `support@gmacko.com` (recommended) | Currently none exists in-app — see action item |
| Support phone | `__________` | Optional but helps vetting |
| Stock symbol / exchange | n/a (private) | Only for public companies |

> ### ⚠️ Brand ↔ product domain note (a real vetting risk)
> The **brand** is *Gmacko Ventures LLC* but every message links to **sortey.app**. TCR/carriers sometimes flag a campaign whose links/domain don't obviously belong to the registered brand. Mitigate with ONE of:
> - Add a visible **"Sortey is a product of Gmacko Ventures LLC"** line in the sortey.app footer + Privacy Policy (cheapest; 🤖 I can do this), **and/or**
> - Use **`gmacko.com`** as the brand website with a page that lists Sortey as a product, **and/or**
> - Set the support email to **support@gmacko.com** (done) so brand contact matches the LLC.
> Doing the footer/privacy attribution is usually enough.

---

## 🧑 Step-by-step in the Twilio Console

1. **Create / log into Twilio**, add a payment method. (No CLI/account exists yet — start at twilio.com.)
2. **Trust Hub → Customer Profiles → Create a Business Profile.** Enter the EIN-based identity from the table above. Submit for validation.
3. **Messaging → Regulatory Compliance → A2P 10DLC → Register a Brand.** Choose **Standard** (registered business). It links to the Business Profile. Pay the one-time brand registration fee. Optionally request **Standard vetting** (a score that unlocks higher throughput).
4. **Messaging → Services → Create a Messaging Service** (e.g. name it `sortey-transactional`). You'll attach the campaign + a number to this.
5. **Register an A2P Campaign** under the brand (content below). Pay the monthly campaign fee. This is the part TCR reviews.
6. **Buy a phone number** (a local 10DLC long code) and add it to the Messaging Service's sender pool.
7. Wait for Campaign **APPROVED**, then wire the credentials into the app (see "Handoff to code" below).

---

## 🤖→🧑 Campaign content (ready to paste)

**Use case:** `Low Volume Mixed` (recommended to start — cheapest TCR vetting, fine for a launching app; covers invites + reminders + notifications in one campaign). Upgrade to `Mixed` / a dedicated use case later if volume grows.

**Campaign description** (paste):
> Sortey is a group-trip planning app. With the user's consent, we send trip invitations, "X hasn't joined yet" reminders, and trip-related notifications (itinerary changes, expense settle-ups) to members who have opted in by adding their mobile number in the app. Messages are transactional and tied to a specific trip the recipient is part of or invited to.

**Sample messages** (provide 2–5; these match the live copy + planned reminders):
1. `You're invited to Lake Tahoe Weekend on Sortey 🚗 Tap to join: https://sortey.app/join/aB3xYz`
2. `Reminder: you haven't joined "Omaha Road Trip" yet. Tap to join: https://sortey.app/join/aB3xYz — Reply STOP to opt out.`
3. `New expense added to Omaha Road Trip: $84.20 dinner. See the split: https://sortey.app/trips/123 — Reply STOP to opt out.`
4. `Your Sortey verification code is 123456.`

**Message flow / opt-in description** (paste — TCR scrutinizes this):
> Users opt in inside the Sortey app (web app.sortey.app and iOS/Android). When adding their mobile number under Settings → Notifications (or when accepting a trip invite), the user checks a box: "Text me trip invites and reminders. Msg & data rates may apply. Msg frequency varies. Reply HELP for help, STOP to cancel." Consent is logged with a timestamp. We do not purchase or share numbers. The opt-in CTA and consent language are shown on our website at https://sortey.app and described in our Privacy Policy at https://sortey.app/privacy.

**Required keywords (configure in the Messaging Service):**
- **Opt-out:** `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT` → reply: *"You're unsubscribed from Sortey texts and won't receive more. Reply START to resubscribe."*
- **Help:** `HELP, INFO` → reply: *"Sortey trip notifications. Msg & data rates may apply. Contact support@gmacko.com. Reply STOP to cancel."*
- **Opt-in (resubscribe):** `START, UNSTOP` → reply: *"You're resubscribed to Sortey texts. Reply STOP to cancel."*

**Other campaign fields:**
- Embedded links: **Yes** (the join/trip links). Use your real domain, not a public shortener (shorteners hurt approval).
- Embedded phone numbers: No.
- Age-gated content: No.
- Direct lending / loans: No.

---

## ⚠️ App-side compliance dependencies (must exist for the campaign to be truthful/approved)

These are real builds. The campaign description above promises them, so they should land before/with Phase 1b:

1. **🤖 Privacy Policy SMS section** — `apps/nextjs/src/app/privacy/page.tsx` currently has **no SMS language**. TCR commonly checks the privacy URL. Add a clause:
   > **SMS/Text Messaging.** If you provide your mobile number and opt in, Sortey sends transactional trip messages (invites, reminders, notifications). Message and data rates may apply; message frequency varies. Reply STOP to opt out or HELP for help. We do **not** sell or share your mobile number, and mobile opt-in data is **not** shared with third parties for marketing. See our Terms for details.
2. **🤖 The opt-in UI + consent logging** — the "Text me trip invites…" checkbox on the phone-number field (Settings → Notifications and/or the invite-accept flow), storing consent timestamp. This is the core of **Phase 1b** and doesn't exist yet.
3. **🧑 A `support@gmacko.com` mailbox** — referenced in HELP replies and the brand contact. No support email currently appears in the app.

---

## Handoff to code (after Campaign APPROVED)

Store via ForgeGraph secrets and wire into a new `@sortey/notifications` SMS channel:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or an API key/secret)
- `TWILIO_MESSAGING_SERVICE_SID` (the service holding the approved campaign + number)

The `route-planner`/invite send path already prefers dedicated env keys; Phase 1b adds `sendInviteSms(toPhone, link)` calling the Messaging Service SID.

---

## Cost / throughput (ballpark — verify current Twilio pricing)

- One-time **brand** registration fee + one-time **vetting** fee (optional, raises throughput).
- Monthly **campaign** fee.
- Per-message carrier fees on top of Twilio's per-SMS price.
- Standard brand + Low Volume Mixed: modest daily throughput, plenty for a launching app.

---

## TL;DR next actions
- 🧑 **You:** create Twilio account → Business Profile (EIN) → Standard Brand → Messaging Service → register the Campaign (paste the content above) → buy a number. Set up `support@gmacko.com`.
- 🤖 **Claude (say the word):** add the Privacy Policy SMS section now; build the opt-in checkbox + consent logging as the first piece of Phase 1b.

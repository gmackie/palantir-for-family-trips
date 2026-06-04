# Phase 1a — Device-Sent Texted Invites — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a revocable, shareable per-trip invite link that the organizer texts from their own device (no Twilio), with a rich link-preview card and a "who's joined" roster.

**Architecture:** Three nullable columns on the existing `trip` table hold a high-entropy share token + enabled flag (no new tables — the roster is the existing `tripMembers` list). Four tRPC procedures on `trips.ts` manage and consume the link; `joinByShareToken` is the single deliberate exception to the `tripProcedure` membership gate (it runs at `protectedProcedure` and the token is the authorization). A public `/join/[token]` SSR page renders an Open Graph card (using a Static Maps image of the destination) and a join CTA. Mobile uses React Native's `Share.share`.

**Tech Stack:** Drizzle ORM (push migrations via `pnpm db:push`), tRPC v11, Next.js (vinext/Workers, runtime SSR), Expo/React Native, Vitest, Biome/oxlint.

**Design source:** `docs/plans/2026-06-04-texted-invites-and-chat-design.md`

**Before starting:** create an isolated worktree per `superpowers:using-git-worktrees` (preferred dir `~/.config/superpowers/worktrees/sortey/`). Branch name suggestion: `feat/texted-invites-1a`.

**Conventions to match (read these first):**
- Schema: `packages/db/src/schema.ts` — `trips` (L190), `tripMembers` (L218, has `unique("trip_members_trip_user_unique")`), `tripInvites` (L298).
- Router: `packages/api/src/router/trips.ts` — `createInvite` (L585), `acceptInvite` (L784, the transaction + `sendPushToTripMembers` pattern to mirror). Helpers in this file: `generateInviteToken()`, `requireOrganizerTripRole(ctx.tripRole)`, `sendPushToTripMembers(...)`. Procedures: `tripProcedure()`, `protectedProcedure`, `publicProcedure`. Every `tripProcedure` input includes `{ workspaceId, tripId }`.
- Web invite page to mirror: `apps/nextjs/src/app/invite/[token]/page.tsx` (+ `_components/`).
- Static Maps URL helper to copy: `apps/nextjs/src/app/trips/page.tsx:34`.
- Tests live in `packages/api/src/router/__tests__/`.

---

## Task 1: Schema — add share-link columns to `trip`

**Files:**
- Modify: `packages/db/src/schema.ts:190-216` (the `trips` table)

**Step 1: Add the columns.** Inside the `trips` pgTable callback, after `tz` (L211) and before `createdAt`, add:

```ts
  // Phase 1a — device-sent share invite (one reusable, revocable link per trip)
  shareInviteToken: t.varchar({ length: 64 }).unique(),
  shareInviteEnabled: t.boolean().notNull().default(true),
  shareInviteCreatedAt: t.timestamp({ mode: "date", withTimezone: true }),
```

**Step 2: Push the schema to the dev DB.**

Run: `pnpm db:push`
Expected: drizzle-kit reports adding 3 columns to `trip` with no data loss prompt. If it prompts about the unique index, accept (the column is nullable so existing rows are fine).

**Step 3: Typecheck the db package.**

Run: `pnpm -F @sortey/db typecheck`
Expected: PASS.

**Step 4: Commit.**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add shareInviteToken columns to trip for texted invites"
```

---

## Task 2: Procedure — `getShareLink` (lazily generate)

`tripProcedure`, organizer-only. Returns the active token, generating one on first call.

**Files:**
- Modify: `packages/api/src/router/trips.ts` (add after `listInvites`, ~L670)
- Test: `packages/api/src/router/__tests__/trips-share-link.test.ts` (create)

**Step 1: Write the failing test.** Mirror the harness in the existing `trips` tests (same `__tests__` dir — copy its setup: in-memory/seeded db, a caller with an organizer session, a seeded trip + workspace). Assert:

```ts
it("generates and returns a stable share token", async () => {
  const first = await organizerCaller.trips.getShareLink({ workspaceId, tripId });
  expect(first.token).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(first.url).toBe(`https://sortey.app/join/${first.token}`);
  const second = await organizerCaller.trips.getShareLink({ workspaceId, tripId });
  expect(second.token).toBe(first.token); // stable, not regenerated
});

it("rejects non-organizers", async () => {
  await expect(
    memberCaller.trips.getShareLink({ workspaceId, tripId }),
  ).rejects.toThrow();
});
```

**Step 2: Run it — expect FAIL** (`getShareLink is not a function`).
Run: `pnpm -F @sortey/api test trips-share-link`

**Step 3: Implement.** Add a small helper near the other invite helpers:

```ts
const SHARE_BASE_URL = "https://sortey.app/join";
function shareUrl(token: string) {
  return `${SHARE_BASE_URL}/${token}`;
}
```

Procedure:

```ts
  getShareLink: tripProcedure()
    .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1) }))
    .query(async ({ ctx }) => {
      requireOrganizerTripRole(ctx.tripRole);
      const [row] = await ctx.db
        .select({
          token: trips.shareInviteToken,
          enabled: trips.shareInviteEnabled,
        })
        .from(trips)
        .where(eq(trips.id, ctx.tripId))
        .limit(1);

      let token = row?.token ?? null;
      if (!token) {
        token = generateInviteToken();
        await ctx.db
          .update(trips)
          .set({ shareInviteToken: token, shareInviteCreatedAt: new Date(), shareInviteEnabled: true })
          .where(eq(trips.id, ctx.tripId));
      }
      return { token, url: shareUrl(token), enabled: row?.enabled ?? true };
    }),
```

> Note: `getShareLink` is a `.query`, but it writes on first call. That's an acceptable lazy-init; if the test harness forbids writes in queries, switch it to `.mutation` named `ensureShareLink` and adjust callers.

**Step 4: Run tests — expect PASS.**
Run: `pnpm -F @sortey/api test trips-share-link`

**Step 5: Commit.**
```bash
git add packages/api/src/router/trips.ts packages/api/src/router/__tests__/trips-share-link.test.ts
git commit -m "feat(api): trips.getShareLink"
```

---

## Task 3: Procedures — `regenerateShareLink` + `setShareLinkEnabled`

`tripProcedure`, organizer-only. Rotate the token (old links die) and toggle the kill switch.

**Files:**
- Modify: `packages/api/src/router/trips.ts`
- Test: append to `trips-share-link.test.ts`

**Step 1: Failing tests.**
```ts
it("regenerate rotates the token", async () => {
  const a = await organizerCaller.trips.getShareLink({ workspaceId, tripId });
  const b = await organizerCaller.trips.regenerateShareLink({ workspaceId, tripId });
  expect(b.token).not.toBe(a.token);
});

it("setShareLinkEnabled toggles the flag", async () => {
  const r = await organizerCaller.trips.setShareLinkEnabled({ workspaceId, tripId, enabled: false });
  expect(r.enabled).toBe(false);
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement.**
```ts
  regenerateShareLink: tripProcedure()
    .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1) }))
    .mutation(async ({ ctx }) => {
      requireOrganizerTripRole(ctx.tripRole);
      const token = generateInviteToken();
      await ctx.db
        .update(trips)
        .set({ shareInviteToken: token, shareInviteCreatedAt: new Date(), shareInviteEnabled: true })
        .where(eq(trips.id, ctx.tripId));
      return { token, url: shareUrl(token), enabled: true };
    }),

  setShareLinkEnabled: tripProcedure()
    .input(z.object({ workspaceId: z.string().min(1), tripId: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireOrganizerTripRole(ctx.tripRole);
      await ctx.db
        .update(trips)
        .set({ shareInviteEnabled: input.enabled })
        .where(eq(trips.id, ctx.tripId));
      return { enabled: input.enabled };
    }),
```

**Step 4: Run — expect PASS. Step 5: Commit** (`feat(api): regenerate + enable/disable share link`).

---

## Task 4: Procedure — `joinByShareToken` (the guarded join)

`protectedProcedure` (joiner is not yet a member; **token is the authorization**). Mirror the `acceptInvite` transaction (L847-885) but validate the trip's share token instead of a per-email invite, and **do not** check email.

**Files:**
- Modify: `packages/api/src/router/trips.ts`
- Test: `packages/api/src/router/__tests__/trips-join-by-token.test.ts` (create)

**Step 1: Failing tests** — cover: happy path adds workspace + trip membership; idempotent for existing member; rejects disabled token; rejects unknown token; rejects `completed` trip.
```ts
it("joins a new user into workspace + trip", async () => {
  const { token } = await organizerCaller.trips.getShareLink({ workspaceId, tripId });
  const res = await strangerCaller.trips.joinByShareToken({ token });
  expect(res.tripId).toBe(tripId);
  const members = await organizerCaller.trips.listMembers({ workspaceId, tripId });
  expect(members.some((m) => m.userId === strangerUserId)).toBe(true);
});

it("is idempotent for an existing member", async () => {
  const { token } = await organizerCaller.trips.getShareLink({ workspaceId, tripId });
  await strangerCaller.trips.joinByShareToken({ token });
  await expect(strangerCaller.trips.joinByShareToken({ token })).resolves.toMatchObject({ tripId });
});

it("rejects a disabled link", async () => {
  const { token } = await organizerCaller.trips.getShareLink({ workspaceId, tripId });
  await organizerCaller.trips.setShareLinkEnabled({ workspaceId, tripId, enabled: false });
  await expect(strangerCaller.trips.joinByShareToken({ token })).rejects.toThrow();
});

it("rejects an unknown token", async () => {
  await expect(strangerCaller.trips.joinByShareToken({ token: "nope" })).rejects.toThrow();
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement** (place near `acceptInvite`):
```ts
  joinByShareToken: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [trip] = (await ctx.db
        .select({
          tripId: trips.id,
          workspaceId: trips.workspaceId,
          enabled: trips.shareInviteEnabled,
          status: trips.status,
        })
        .from(trips)
        .where(eq(trips.shareInviteToken, input.token))
        .limit(1)) as Array<{ tripId: string; workspaceId: string; enabled: boolean; status: TripStatus }>;

      if (!trip) throw new TRPCError({ code: "NOT_FOUND", message: "This invite link is no longer active." });
      if (!trip.enabled) throw new TRPCError({ code: "FORBIDDEN", message: "This invite link has been disabled." });
      if (trip.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "This trip has already ended." });

      // biome-ignore lint/suspicious/noExplicitAny: Drizzle tx type is complex
      await ctx.db.transaction(async (tx: any) => {
        const ws = await tx.query.workspaceMembership.findFirst({
          where: and(
            eq(workspaceMembership.userId, ctx.session.user.id),
            eq(workspaceMembership.workspaceId, trip.workspaceId),
          ),
        });
        if (!ws) {
          await tx.insert(workspaceMembership).values({
            workspaceId: trip.workspaceId, userId: ctx.session.user.id, role: "member",
          });
        }
        await tx.insert(tripMembers)
          .values({ tripId: trip.tripId, userId: ctx.session.user.id, role: "member" })
          .onConflictDoNothing({ target: [tripMembers.tripId, tripMembers.userId] });
      });

      void sendPushToTripMembers(ctx.db, {
        tripId: trip.tripId,
        excludeUserId: ctx.session.user.id,
        title: "New Member",
        body: `${ctx.session.user.name ?? ctx.session.user.email ?? "Someone"} joined the trip`,
        data: { tripId: trip.tripId, screen: "members" },
      });

      return { tripId: trip.tripId, workspaceId: trip.workspaceId };
    }),
```
(Use the `onConflictDoNothing` on the `trip_members_trip_user_unique` constraint for idempotency — cleaner than the `findFirst` check `acceptInvite` uses.)

**Step 4: Run — expect PASS.**

**Step 5: Add a basic rate-limit note + commit.** If the repo has a rate-limit util (grep `ratelimit`), wrap `joinByShareToken`; otherwise leave a `// TODO(ratelimit)` and commit (`feat(api): joinByShareToken with idempotent membership`).

---

## Task 5: Public read procedure — `getShareLinkPreview`

The `/join` page needs trip name + destination (for the OG card) **without** auth or membership.

**Files:**
- Modify: `packages/api/src/router/trips.ts` (mirror `getInviteByToken`, L672, which is `publicProcedure`)
- Test: append to `trips-join-by-token.test.ts`

**Step 1: Failing test** — returns `{ tripId, tripName, destinationName, startDate, endDate, status, enabled }` for a valid token; throws/returns inactive for unknown/disabled.

**Step 3: Implement** as `publicProcedure` selecting those fields from `trips` where `shareInviteToken = token`. Return a discriminated shape like `getInviteByToken` does (`status: "active" | "disabled" | "not_found"`) so the page can branch without try/catch. **Never** return the token or any secret.

**Step 5: Commit** (`feat(api): trips.getShareLinkPreview public procedure`).

---

## Task 6: Web — `/join/[token]` page + OG card

**Files:**
- Create: `apps/nextjs/src/app/join/[token]/page.tsx`
- Create: `apps/nextjs/src/app/join/[token]/_components/join-button.tsx`
- Reuse: `apps/nextjs/src/app/invite/[token]/_components/invite-sign-in-form.tsx` (import, don't duplicate)

**Step 1: `generateMetadata` for the rich card.** Export an async `generateMetadata({ params })` that calls `caller.trips.getShareLinkPreview({ token })` and returns:
```ts
return {
  title: `Join ${preview.tripName} on Sortey`,
  description: preview.destinationName
    ? `${preview.destinationName}${dateRange ? ` · ${dateRange}` : ""}`
    : "You're invited to a trip on Sortey",
  openGraph: {
    title: `Join ${preview.tripName}`,
    description,
    images: [staticMapImage(preview)], // see below
  },
  twitter: { card: "summary_large_image" },
};
```
For `staticMapImage`, copy the Static Maps URL builder from `apps/nextjs/src/app/trips/page.tsx:34` (it already uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` + lat/lng + the dark style). If the trip has no destination lat/lng, fall back to a static branded `/og-default.png`. **No `ImageResponse` / `og` route needed — the Static Maps PNG IS the image.**

**Step 2: Page body.** Mirror `invite/[token]/page.tsx`: create the caller, fetch `getShareLinkPreview`. Branch on status: `not_found`/`disabled` → friendly message; `active` + signed-out → render `<InviteSignInForm>` with `callbackUrl={/join/${token}}`; `active` + signed-in → render `<JoinButton token={token} />`.

**Step 3: `JoinButton` client component** — calls `trpc.trips.joinByShareToken.useMutation()`; on success `router.push(/trips/${res.tripId})`. Mirror `accept-invite-button.tsx`.

**Step 4: Manual verify locally.**
Run `pnpm dev:next`, create a trip, hit `trips.getShareLink`, open `/join/<token>` in a private window. Expected: card renders; signing in then joining lands you in the trip. Verify the OG tags: `curl -s localhost:3000/join/<token> | grep og:`.

**Step 5: Commit** (`feat(web): /join/[token] page with OG preview card`).

---

## Task 7: Web — "Invite by text" UI + roster panel

**Files:**
- Create: `apps/nextjs/src/app/trips/[tripId]/_components/share-invite-card.tsx`
- Modify: the dashboard/planning view that should host it (e.g. `apps/nextjs/src/app/trips/[tripId]/dashboard/...` — grep for the members/roster section).

**Step 1: `ShareInviteCard` (client).** Uses `trpc.trips.getShareLink.useQuery({ workspaceId, tripId })`. Shows:
- the `url`, a **Copy** button (`navigator.clipboard.writeText`), and a **Text it** anchor: `href={\`sms:?&body=${encodeURIComponent(message)}\`}` where `message = \`You're invited to ${tripName} on Sortey 🚗 Tap to join: ${url}\``.
- a small **QR** (use existing qr dep if present — grep `qrcode`; else render the `sms:`/url via a tiny inline lib or skip QR for v1 — YAGNI).
- organizer-only controls: **Regenerate** (`regenerateShareLink` mutation) + **Disable/Enable** toggle (`setShareLinkEnabled`).

**Step 2: Roster.** Below the link, render `trpc.trips.listMembers.useQuery(...)` as avatars + names + `joinedAt`. This is the "who's joined" view. If a members list UI already exists on the page, just add the share card above it (DRY — don't rebuild the roster).

**Step 3: Verify** the card renders for an organizer and is hidden/read-only for a non-organizer (gate on the member role already in context).

**Step 4: Commit** (`feat(web): share-invite card + roster on trip dashboard`).

---

## Task 8: Mobile — native share button

**Files:**
- Modify: `apps/expo/src/app/trip/[tripId]/members.tsx` (the roster screen) or `trip/[tripId]/index.tsx`.

**Step 1: Add a "Share invite" button** that:
```ts
import { Share } from "react-native";
const { url } = await utils.trips.getShareLink.fetch({ workspaceId, tripId }); // match the expo trpc client pattern in plan-route.tsx
await Share.share({
  message: `You're invited to ${tripName} on Sortey 🚗 Tap to join: ${url}`,
  url, // iOS uses this for the rich preview
});
```
Match the existing expo tRPC usage style (see `apps/expo/src/app/trip/[tripId]/plan-route.tsx` for `trpc.*` query/mutation patterns).

**Step 2: Verify** in the iOS simulator/dev client: tapping opens the share sheet; the link is present. (Rich preview only renders on a real device in Messages — note in the PR.)

**Step 3: Commit** (`feat(mobile): native share-invite button`).

---

## Task 9: Final integration pass

**Step 1:** `pnpm check:fast` (lint + typecheck) at repo root — expect PASS.
**Step 2:** `pnpm -F @sortey/api test` — expect all share-link/join tests green.
**Step 3:** Manual end-to-end on local: organizer gets link → open `/join/<token>` signed-out in another browser → sign in → join → appears in roster (web) and members (mobile).
**Step 4:** Open a PR via `superpowers:finishing-a-development-branch`. In the PR body, note: (a) `joinByShareToken` is the one membership-gate exception; (b) joiners auto-join the parent workspace as `member` (no guest role — intentional v1 scope); (c) rich iMessage preview needs a real device to verify.

---

## Out of scope (Phase 1b / 2 — do NOT build now)
- Twilio app-sent SMS + A2P 10DLC (Phase 1b).
- Per-recipient tracked invite rows / "remind Bob" (Phase 1b).
- Any realtime/chat work (Phase 2 — `@sortey/realtime` is still a stub).
- Phone-number capture, contact picker, guest role.

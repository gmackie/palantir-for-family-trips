# Initial Proposal — Group Trip Command Center

## Background

The current repo is a Vite + React single-page app: a Palantir-styled "situation dashboard" for a single family trip. State is local (`usePersistedTripState`), and the UI is built from a handful of top-level components (`App`, `CommandMap`, `InspectorRail`) driven by a static `tripData` / `tripModel` pair. There is no backend, no auth, and no multi-user concept.

This proposal expands the product into a **group trip command center** that preserves the existing single-family experience and adds a new *group mode* for coordinating trips where multiple people or households fly into the same destination and share an itinerary, expenses, and logistics on the ground.

## Goals

1. **Preserve the existing family-trip experience.** The current dashboard is the baseline; single-trip users should see the same density and feel after migration.
2. **Add per-trip group mode.** A trip can be flagged as a group trip, which unlocks shared membership, expenses, settlement, and a collaborative itinerary. Non-group trips keep the existing simple flow.
3. **Make shared spending painless.** Receipts can be uploaded as photos, line items extracted automatically, items assigned to one or more people, and tax + tip prorated by subtotal share. A running "who owes whom" settlement is always visible.
4. **Plan activities on the ground, together.** A zoomed-in area map lets members drop pins for lodging, activities, meals, and transit, and the shared itinerary shows a timeline of who's doing what, when.
5. **Deploy via ForgeGraph** using the standard create-gmacko-app monorepo layout.

## Non-Goals (v1)

- Multi-currency support
- Flight / hotel booking integrations
- Native mobile apps (web-first, mobile-responsive)
- Offline mode
- Real-time collaborative cursors (we'll use normal fetch/poll + optimistic updates)
- Automatic expense categorization beyond what OCR provides

## Users & Roles

- **Trip organizer** — creates the trip, invites members via magic link, can assign line items on behalf of others, can close out / lock the trip.
- **Trip member** — joins via magic link, sees the shared itinerary, can upload receipts, claim line items, drop map pins, and view their balance.
- **Family mode user** (existing) — a solo user running the legacy single-family dashboard experience; group features are hidden unless they flip a trip to group mode.

## Feature Set

### 1. Trips & Membership
- A `Trip` has a name, destination area (lat/lng + radius for the map default), date range, and a `group_mode` flag.
- Members join via **Better Auth magic links**. Invite flow: organizer enters emails → each gets a one-click join link → on first visit they pick a display name + color.
- Each member has a role (`organizer` | `member`) per trip.

### 2. Shared Itinerary & Map
- **Area map** (Google Maps JS API) centered on the trip destination, zoomed to neighborhood / city level rather than cross-country.
- **Pin types**: lodging, activity, meal, transit hub, custom. Each pin has title, time window, notes, attendees, and an optional link.
- **Timeline view** (Gantt-style, borrowed from tulip's stay timeline) showing pins across trip days, with overlap handling and per-member attendance lanes.
- **Routing between pins** via Google Maps Directions, with transit / walk / drive modes per leg.
- **Gap detection** (borrowed from tulip): highlight time windows with no planned activity.
- Pins and itinerary entries are collaboratively editable; last-write-wins with a short edit history.

### 3. Expenses & Receipts
- **Expense entity**: payer, date, merchant, subtotal, tax, tip, total, currency (USD only v1), notes, receipt image(s), line items.
- **Receipt upload**: members take a photo or upload an image; it's stored in object storage (ForgeGraph-managed bucket or equivalent).
- **OCR pipeline**: on upload, a server-side job calls Claude Sonnet 4.6 vision (or Codex) with a prompt-cached extraction schema to pull merchant, date, subtotal, tax, tip, total, and line items (name, qty, unit price, line total). Low-confidence extractions fall back to manual entry with OCR values pre-filled.
- **Line-item assignment** — two supported modes per trip:
  - **Organizer-assigns**: the uploader or organizer taps each line item and picks who it belongs to (one or many).
  - **Tap-to-claim**: the expense shows as "unclaimed items" and each member opens it on their phone and taps items they had. Conflicts (two people claim same item) surface for resolution. This mode uses short-interval polling — no websockets in v1.
- **Shared items**: a line item can be assigned to multiple people, splitting its cost equally across claimants.
- **Tax & tip allocation**: each person's share of tax + tip = (their subtotal share) / (total subtotal) × (tax + tip). This is applied automatically once all items are assigned.
- **Settlement view**: a running "who owes whom" panel computed from all expenses using a minimize-transactions algorithm (classic Splitwise simplification). One-tap "mark settled" when someone pays another.

### 4. Legacy Family Dashboard
- The existing Palantir-styled components (`CommandMap`, `InspectorRail`, activity board, meals planner, mission launch view) become stories in `packages/ui` and routes in `apps/nextjs` that render when `trip.group_mode === false`.
- Visual language stays governed by `DESIGN.md`.

## Architecture

### Monorepo (create-gmacko-app layout)

```
apps/nextjs          Next.js App Router, routes, layouts, auth wiring
packages/ui          Shared React components + Storybook stories
packages/api         Server-side routers: trips, members, itinerary, expenses, receipts, settlement
packages/db          Drizzle (or Prisma) schema, migrations, seeds
docs/ai              Planning artifacts (this file, IMPLEMENTATION_PLAN.md, etc.)
```

### Data Model (sketch)

- `users` (Better Auth)
- `trips` (id, name, destination_lat, destination_lng, default_zoom, start_date, end_date, group_mode, claim_mode, created_by)
- `trip_members` (trip_id, user_id, role, display_name, color)
- `pins` (trip_id, type, title, lat, lng, starts_at, ends_at, notes, created_by)
- `pin_attendees` (pin_id, user_id)
- `expenses` (trip_id, payer_user_id, merchant, occurred_at, subtotal, tax, tip, total, notes, ocr_confidence)
- `expense_images` (expense_id, storage_key)
- `line_items` (expense_id, name, quantity, unit_price, line_total)
- `line_item_claims` (line_item_id, user_id) — many-to-many, equal split across claimants
- `settlements` (trip_id, from_user_id, to_user_id, amount, settled_at)

### External Services

- **Better Auth** (magic links) — session + auth tables in the same Postgres.
- **Google Maps JS API** — maps, pins, directions. Requires an API key (stored server-side, proxied to the client via a keyed endpoint).
- **Claude API (Sonnet 4.6 vision)** — receipt OCR with prompt-cached schema. Codex as a fallback or alternative.
- **Object storage** — for receipt images (ForgeGraph-managed or S3-compatible).

### Deployment

- ForgeGraph app on the standard `apps/nextjs` target.
- Postgres provisioned per create-gmacko-app defaults.
- Secrets: `BETTER_AUTH_SECRET`, `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`, object storage credentials.

## UX Notes

- **Group mode toggle** lives in trip settings; flipping on mid-trip preserves existing data and reveals member/expense UIs.
- **Dashboard for group trips** foregrounds: today's plan, unclaimed line items count, your current balance, and unread edits.
- **Receipt capture** is a first-class floating action — one tap from anywhere in a group trip.
- **Mobile-first** for in-trip use; desktop keeps the existing high-density Palantir aesthetic for planning.

## Risks & Open Questions

- **OCR accuracy on crumpled / low-light receipts.** Mitigation: always show extracted fields in an editable form before saving; never silently trust OCR.
- **Google Maps cost at scale.** Mitigation: cache directions results per pin pair; load map libraries lazily.
- **Migration churn.** The Vite → Next.js migration touches every existing component. Mitigation: phase 0 is the migration with visual parity as the acceptance criterion, no new features.
- **Conflict handling on concurrent itinerary edits.** Mitigation: v1 is last-write-wins with a 30-second edit lock on a pin while someone has it open.
- **"Family mode" discoverability.** If group mode becomes the default mental model, make sure solo users can still land on the legacy dashboard without friction.

## Success Criteria

- A group of 4 people can create a trip, join via magic links, upload 5+ receipts, assign all line items (mix of organizer-assigns and tap-to-claim), and see an accurate settlement summary with no manual math.
- The same group can drop 10+ pins on the area map, view them on a shared timeline, and get directions between two pins.
- A legacy single-family user's existing dashboard looks and feels identical to today's after migration.

## Next Step

`docs/ai/IMPLEMENTATION_PLAN.md` — phased work breakdown starting with the monorepo migration, then auth, then trips/groups, then expenses/OCR, then settlement, then map/itinerary, with Storybook coverage gates throughout.

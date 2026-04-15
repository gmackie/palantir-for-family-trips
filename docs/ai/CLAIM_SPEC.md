# Claim Interaction Spec

This document defines the v1 claiming interaction for shared expenses in the Group Trip Command Center. It is the blocking design spec for Phase 3.

## Purpose

Claiming must let a small group split a receipt quickly, on a phone, at a restaurant table, without requiring everyone to understand accounting details. The interaction needs to feel immediate, survive partial connectivity, and still reconcile to deterministic expense shares on the server.

## Scope

This spec covers:

- Per-expense claiming modes
- Tap-to-claim interaction
- Organizer assignment interaction
- Pass-the-phone interaction
- Unclaimed item resolution
- Realtime behavior and polling fallback
- Required UI states

This spec does not cover:

- OCR extraction itself
- Share calculation math
- Settlement flow after shares are finalized

## Mental Model

- Claim mode is chosen per trip in settings, but it applies at the expense level once an expense is finalized.
- Users do not claim "money"; they claim line items.
- Tax and tip are system-managed. Users never tap tax or tip rows.
- Multiple people claiming the same line item is cooperative, not an error. The item is shared.
- Final expense shares are derived from claimed line items plus automatic tax and tip proration.

## Modes

## 1. Tap Mode

Tap mode is the default fast path for in-person meals and shared receipts.

- Every line item renders as a full-width 44px minimum tap target.
- The left side shows the item name, quantity, and line total.
- The right side shows claimant chips using each member's trip color.
- Tapping a row toggles the acting user's claim on that item.
- If the row has no claimants, the first tap adds the acting user.
- If the acting user already claimed the row, tapping removes their claim.
- If another member already claimed the row, tapping adds the acting user and the item becomes shared.
- Shared state is visible immediately through multiple claimant chips and split messaging.

## 2. Organizer Mode

Organizer mode is for asynchronous cleanup and trips where one person manages the split.

- Each row shows an assign button instead of full-row claim toggling.
- Tapping the assign control opens a popover or bottom sheet with member chips.
- Tapping a chip toggles that member on or off for the line item.
- The organizer can assign one member, many members, or none.
- The organizer sees the same claimant chips as tap mode after assignment.
- Non-organizers can view assignments but cannot edit them.

## Pass-the-Phone

Pass-the-phone is a first-class mode for one shared device at the table.

- The expense detail view shows a persistent top bar: `Claiming as: [Member Name v]`.
- Tapping the switcher opens a member picker using trip colors and names.
- Switching the acting user does not sign anyone out and does not change the app session owner.
- The acting user only affects local interaction intent:
  - Tap mode claims and unclaims on behalf of that selected member.
  - Organizer mode can still assign anyone, so the switcher is informational there and may be hidden.
- The active member must always be visible before the user taps any line item.

## Row Anatomy

Each line item row must include:

- Item name
- Quantity when quantity is not `1`
- Line total in Geist Mono tabular figures
- Claimant chips
- Shared-state indicator when more than one claimant is present
- Pending indicator during optimistic update

Optional secondary text:

- OCR confidence warning if the item looks ambiguous
- Notes such as "split 2 ways" when the row is already shared

Tax and tip rows are not interactive. They appear below the subtotal block with copy making it clear they are allocated automatically.

## Interaction States

Each claimable row must support all of these states:

## 1. Unclaimed

- No claimant chips
- Neutral border and surface treatment
- Row label: normal

## 2. Claimed by You

- Your color chip visible
- Subtle active surface treatment
- Immediate local confirmation on tap

## 3. Claimed by Others

- Other claimant chips visible
- Neutral to lightly emphasized surface
- Still tappable in tap mode

## 4. Shared

- Two or more claimant chips visible
- Supporting copy such as `Shared`
- Never shown as a conflict state by default

## 5. Optimistic / In Progress

- Spinner or subtle pending indicator on the row
- Row remains visually updated to the intended state immediately
- Additional taps on the same row are temporarily disabled until reconciliation returns

## 6. Error / Reverted

- Previous state is restored if the mutation fails
- Inline error treatment appears on the affected row
- Toast copy: `Couldn't update claim. Try again.`

## Realtime Behavior

Primary transport is `@gmacko/realtime`.

- Channel: `private-expense-${expenseId}`
- Primary event: `line-item:claimed`
- Companion event allowed: `line-item:unclaimed`
- Clients invalidate the expense detail query on receipt of a claim event
- The UI should not attempt to merge partial local state forever; it should re-read canonical server state after each event

## Reconciliation Rules

- Local tap updates the row optimistically.
- Server acknowledgement or realtime invalidation replaces local assumptions with canonical state.
- If two people tap the same row at nearly the same time, the steady state is shared ownership, not a blocking conflict.
- If a user unclaims while another user claims at the same time, the server response wins and the UI reflects canonical state on refetch.

## Polling Fallback

Polling exists only when realtime is unavailable or disabled.

- Interval: every 3 seconds
- Enabled only while the expense detail view is foregrounded
- Paused when `document.visibilityState === "hidden"`
- Resumes on foreground and immediately refetches once
- Polling fallback must preserve the same optimistic row behavior as realtime mode

## Unclaimed Item Resolution

Unclaimed resolution happens after the receipt is finalized and the group is done tapping.

- The organizer sees a `Resolve unclaimed` action when any line items have zero claimants.
- Resolution is a separate step, not an automatic background rule.
- The organizer gets two v1 options:
  - `Split among all participants`
  - `Assign to payer`
- The resolution UI must preview the impact in plain language before confirming.
- After resolution, rows become claimed and normal share calculation proceeds.

## Layout Rules

Phone is the primary target.

- Rows are full-width and vertically stacked
- Claimant chips stay on the right when there is room
- If width is constrained, chips wrap below the main row text
- No hover-only affordances
- All important states must be visible without opening a secondary inspector

Desktop and tablet may add supporting panels, but the core claim action must remain readable as a simple list.

## Copy Rules

- Use `Claim` only when no one has it yet
- Use `Claimed` for the acting user's owned state
- Use `Shared` for multi-claimant state
- Avoid language that implies an error when two people claim the same item
- Keep tax and tip copy explicit: `Allocated automatically after items are claimed`

## Accessibility

- 44px minimum touch targets on claimable rows
- Keyboard activation must work on web with Enter and Space
- Claim state must not rely on color alone; combine color chips with labels or icons
- Screen readers must announce item name, amount, and current claim state
- Pending and error transitions must be announced accessibly

## Acceptance Criteria

- A user on phone can claim multiple items one-handed without opening a modal per row
- Two users on separate devices can claim items on the same expense and see convergence to canonical state
- Two users claiming the same item results in a shared item, not a dead-end conflict
- Organizer mode supports explicit member assignment without requiring the assigned member to act
- Pass-the-phone makes the active claimant obvious before each tap
- Fallback polling preserves usability when realtime is disabled

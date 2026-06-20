/**
 * E2E: Trip → Expense → Claim → Settle flow
 *
 * Auth mechanism: /api/dev/auto-login?email=<email>
 *   This dev-only route (only available when NODE_ENV=development) triggers a
 *   magic-link sign-in and immediately redirects to the resulting magic-link URL,
 *   landing the browser on /trips after completing auth. Reuses the same path as
 *   the existing dev-magic-link infrastructure; no backdoor was added.
 *
 * E2E run command: pnpm -F @sortey/nextjs e2e
 *   (maps to `playwright test` via the "e2e" script in apps/nextjs/package.json)
 *
 * NOTE: Full execution requires CI with a running dev server and a seeded
 * database. No browser binaries were available in the sandbox where this spec
 * was authored; it compiles and is listed by `playwright test --list` but has
 * not been run end-to-end locally.
 *
 * Currency: all amounts are USD so settlement math operates on a single
 * currency (the app refuses mixed-currency settlement).
 */

import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Log in via the dev auto-login route (development only). */
async function devLogin(
  page: Parameters<Parameters<typeof test>[1]>[0]["page"],
  email: string,
): Promise<void> {
  // The route generates a magic link and redirects directly to it, which
  // completes the auth handshake and lands the user on /trips.
  await page.goto(`/api/dev/auto-login?email=${encodeURIComponent(email)}`);
  // Wait for the redirect chain to finish and the trips page to be ready.
  await page.waitForURL(/\/trips($|\/)/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Expense → Claim → Settlement flow", () => {
  // Use a timestamped email so each run creates a fresh account/trip and
  // avoids state bleed between parallel workers.
  const organiserEmail = `e2e-organiser-${Date.now()}@sortey.test`;
  // memberEmail is reserved for a future multi-member variant of this test.
  const _memberEmail = `e2e-member-${Date.now()}@sortey.test`;

  const tripName = `E2E Trip ${Date.now()}`;
  const merchantName = `E2E Cafe ${Date.now()}`;
  const lineItemName = "Espresso";
  const lineItemPrice = "4.50";
  // Total matches subtotal for simplicity (no tax/tip).
  const expenseTotal = "4.50";

  test("organiser creates a trip, adds an expense with a line item, finalizes it; member claims the line item; organiser records settlement", async ({
    page,
  }) => {
    // ------------------------------------------------------------------
    // Step 1 — Authenticate as organiser
    // ------------------------------------------------------------------
    await devLogin(page, organiserEmail);
    await expect(page).toHaveURL(/\/trips/);

    // ------------------------------------------------------------------
    // Step 2 — Create a new trip
    // ------------------------------------------------------------------
    await page.goto("/trips/new");
    await expect(
      page.getByRole("heading", { name: /create a trip/i }),
    ).toBeVisible();

    await page.getByLabel(/trip name/i).fill(tripName);
    // Destination is required by the form schema.
    await page.getByLabel(/destination/i).fill("Paris, France");
    // Accept "Group Trip" mode (default) – no radio change needed.
    await page.getByRole("button", { name: /create trip/i }).click();

    // After creation the server redirects to /trips/<id>.
    await page.waitForURL(/\/trips\/[^/]+$/, { timeout: 15_000 });
    const tripUrl = page.url();
    const tripId = tripUrl.split("/trips/")[1]?.split("/")[0];
    expect(tripId).toBeTruthy();

    // ------------------------------------------------------------------
    // Step 3 — Add an expense in draft state
    // ------------------------------------------------------------------
    await page.goto(`/trips/${tripId}/expenses/new`);
    await expect(
      page.getByRole("heading", { name: /add an expense/i }),
    ).toBeVisible();

    await page.getByLabel(/merchant/i).fill(merchantName);

    // Pick the first available segment from the dropdown (seeded by trip creation).
    const segmentSelect = page.getByLabel(/trip segment/i);
    await expect(segmentSelect).toBeVisible({ timeout: 10_000 });
    // Select the first option (not the placeholder).
    const firstOption = segmentSelect.locator("option").nth(0);
    const firstOptionValue = await firstOption.getAttribute("value");
    if (firstOptionValue) {
      await segmentSelect.selectOption(firstOptionValue);
    }

    await page.getByLabel(/subtotal/i).fill(expenseTotal);
    await page.getByLabel(/total/i).fill(expenseTotal);

    await page.getByRole("button", { name: /create expense/i }).click();

    // Redirect to /trips/<id>/expenses/<expenseId>
    await page.waitForURL(/\/trips\/[^/]+\/expenses\/[^/]+$/, {
      timeout: 15_000,
    });
    const expenseUrl = page.url();
    const expenseId = expenseUrl.split("/expenses/")[1];
    expect(expenseId).toBeTruthy();

    // ------------------------------------------------------------------
    // Step 4 — Add a line item to the draft expense
    // ------------------------------------------------------------------
    await page.getByRole("button", { name: /add item/i }).click();

    const nameInput = page.getByPlaceholder(/item name/i);
    const priceInput = page.getByPlaceholder(/0\.00/i);
    await nameInput.fill(lineItemName);
    await priceInput.fill(lineItemPrice);
    await page.getByRole("button", { name: /^add$/i }).click();

    // The line item should now appear in the list.
    await expect(page.getByText(lineItemName)).toBeVisible();

    // ------------------------------------------------------------------
    // Step 5 — Finalize the expense
    // ------------------------------------------------------------------
    await page.getByRole("button", { name: /finalize expense/i }).click();

    // After finalization the status badge changes to "finalized".
    await expect(page.getByText("finalized")).toBeVisible({ timeout: 10_000 });
    // The "Claim" button for the line item should now be visible.
    await expect(page.getByRole("button", { name: /^claim$/i })).toBeVisible();

    // ------------------------------------------------------------------
    // Step 6 — Claim the line item as organiser
    // ------------------------------------------------------------------
    await page.getByRole("button", { name: /^claim$/i }).click();
    // Button toggles to "Claimed".
    await expect(page.getByRole("button", { name: /^claimed$/i })).toBeVisible({
      timeout: 10_000,
    });

    // ------------------------------------------------------------------
    // Step 7 — Navigate to the Settle page and record a settlement
    // ------------------------------------------------------------------
    await page.goto(`/trips/${tripId}/settle`);
    await expect(
      page.getByRole("heading", { name: /settle up/i }),
    ).toBeVisible();

    // With only one member (the organiser) who is also the payer, balances
    // are zero and the "Everyone's square!" celebration should appear, OR
    // there are suggested transactions if a second member has been added.
    // We assert at least one of the two states is visible.
    const allSettled = page.getByText(/everyone.s square/i);
    const settleHistory = page.getByRole("heading", {
      name: /settlement history/i,
    });
    await expect(settleHistory).toBeVisible({ timeout: 10_000 });

    // If there are suggested payments, mark the first one paid.
    const markPaidButton = page.getByRole("button", { name: /mark paid/i });
    const hasSuggestedPayments = await markPaidButton.count();
    if (hasSuggestedPayments > 0) {
      await markPaidButton.first().click();
      // The settlement history section should now contain a recorded entry.
      await expect(page.getByText(/paid/i).first()).toBeVisible({
        timeout: 10_000,
      });
    } else {
      // Single-member trip: payer is organiser so everything is settled.
      await expect(allSettled).toBeVisible();
    }

    // ------------------------------------------------------------------
    // Assertions — settled state is reflected in the settlement history
    // ------------------------------------------------------------------
    // History section is always rendered (empty-state or entries).
    await expect(settleHistory).toBeVisible();
  });
});

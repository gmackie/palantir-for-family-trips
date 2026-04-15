import { expect, test } from "@playwright/test";

test.describe("Sign In Page", () => {
  test("offers magic-link and Discord sign-in", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /send magic link/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in with discord/i }),
    ).toBeVisible();
  });
});

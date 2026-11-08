import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  $fetch: vi.fn(),
  magicLink: { verify: vi.fn() },
  $store: { notify: vi.fn() },
}));
vi.mock("./auth", () => ({ authClient: auth }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("EXPO_PUBLIC_REVIEW_SIGN_IN", "true");
  auth.$fetch.mockResolvedValue({ data: { token: "one-use-token" } });
  auth.magicLink.verify.mockResolvedValue({ data: { user: { id: "demo" } } });
});

describe("review sign-in", () => {
  it("exchanges the token through the cookie-aware client and refreshes the session", async () => {
    const { signInForReview } = await import("./review-sign-in");
    await signInForReview(" Reviewer+Traveler@Sortey.app ");
    expect(auth.$fetch).toHaveBeenCalledWith("/dev/sign-in/magic-link", {
      method: "POST",
      body: { email: "reviewer+traveler@sortey.app" },
    });
    expect(auth.magicLink.verify).toHaveBeenCalledWith({
      query: { token: "one-use-token" },
    });
    expect(auth.$store.notify).toHaveBeenCalledWith("$sessionSignal");
  });

  it("never calls the bypass in an ordinary build", async () => {
    vi.stubEnv("EXPO_PUBLIC_REVIEW_SIGN_IN", "false");
    const { signInForReview } = await import("./review-sign-in");
    await expect(signInForReview("person@example.com")).rejects.toThrow(
      "unavailable",
    );
    expect(auth.$fetch).not.toHaveBeenCalled();
  });

  it("surfaces server denial without attempting verification", async () => {
    auth.$fetch.mockResolvedValue({ error: { message: "Demo accounts only" } });
    const { signInForReview } = await import("./review-sign-in");
    await expect(signInForReview("person@example.com")).rejects.toThrow(
      "Demo accounts only",
    );
    expect(auth.magicLink.verify).not.toHaveBeenCalled();
    expect(auth.$store.notify).not.toHaveBeenCalled();
  });

  it("does not report success when verification fails", async () => {
    auth.magicLink.verify.mockResolvedValue({
      error: { message: "Expired link" },
    });
    const { signInForReview } = await import("./review-sign-in");
    await expect(signInForReview("reviewer+delete@sortey.app")).rejects.toThrow(
      "Expired link",
    );
    expect(auth.$store.notify).not.toHaveBeenCalled();
  });
});

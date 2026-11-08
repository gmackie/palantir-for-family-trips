import { authClient } from "./auth";

export const reviewSignInEnabled =
  process.env.EXPO_PUBLIC_REVIEW_SIGN_IN === "true";

/** The server's explicit demo allowlist is the authorization boundary. */
export async function signInForReview(email: string) {
  if (!reviewSignInEnabled) throw new Error("Review sign-in is unavailable.");

  const { data, error } = await authClient.$fetch<{ token: string }>(
    "/dev/sign-in/magic-link",
    { method: "POST", body: { email: email.trim().toLowerCase() } },
  );
  if (error || !data?.token) {
    throw new Error(
      error?.message ?? "Review sign-in is unavailable. Please try again.",
    );
  }

  // No callbackURL: Better Auth returns JSON + Set-Cookie instead of a browser
  // redirect. expoClient persists that cookie in SecureStore for API requests.
  const verified = await authClient.magicLink.verify({
    query: { token: data.token },
  });
  if (verified.error) {
    throw new Error(
      verified.error.message ?? "Could not verify review sign-in.",
    );
  }
  // magic-link/verify is not one of the default client's session atom listeners.
  authClient.$store.notify("$sessionSignal");
}

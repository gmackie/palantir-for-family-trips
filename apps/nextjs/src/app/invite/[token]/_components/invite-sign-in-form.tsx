"use client";

import { Button } from "@sortey/ui/button";
import { Input } from "@sortey/ui/input";
import { startTransition, useState } from "react";

import { authClient } from "~/auth/client";

export function InviteSignInForm(props: {
  token: string;
  /**
   * Pre-known email for per-email invites (rendered read-only). Omit for share
   * links where the joiner enters their own email.
   */
  email?: string;
  /** Magic-link callback. Defaults to the per-email invite page. */
  callbackUrl?: string;
}) {
  const emailLocked = typeof props.email === "string";
  const [email, setEmail] = useState(props.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const callbackUrl = props.callbackUrl ?? `/invite/${props.token}`;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!email.trim()) return;
        setError(null);
        setIsPending(true);

        startTransition(async () => {
          try {
            await authClient.signIn.magicLink({
              email,
              callbackURL: callbackUrl,
            });
            setSubmitted(true);
          } catch (submissionError) {
            setError(
              submissionError instanceof Error
                ? submissionError.message
                : "Could not send magic link",
            );
          } finally {
            setIsPending(false);
          }
        });
      }}
    >
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={emailLocked}
          disabled={emailLocked}
          required
        />
      </div>

      <Button
        className="w-full"
        disabled={isPending || !email.trim()}
        type="submit"
      >
        {isPending ? "Sending..." : "Send sign-in link"}
      </Button>

      {submitted ? (
        <p className="text-sm text-muted-foreground">
          Check {email} for a sign-in link. After signing in you&apos;ll be
          redirected back here to continue.
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

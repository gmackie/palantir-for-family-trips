"use client";

import { Button } from "@gmacko/ui/button";
import { Input } from "@gmacko/ui/input";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { authClient } from "~/auth/client";

export function MagicLinkForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);

  function handleDevLogin() {
    setIsPending(true);
    window.location.href = `/api/dev/auto-login?email=${encodeURIComponent(email)}`;
  }

  async function handleMagicLink() {
    setError(null);
    setIsPending(true);

    try {
      await authClient.signIn.magicLink({
        email,
        callbackURL: "/",
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
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => {
          void handleDevLogin();
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
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>

      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? "Signing in..." : "Sign in"}
      </Button>

      <button
        type="button"
        onClick={() => startTransition(() => void handleMagicLink())}
        disabled={isPending || !email}
        className="text-muted-foreground hover:text-foreground w-full text-center text-xs underline transition-colors disabled:opacity-50"
      >
        Send email magic link instead
      </button>

      {submitted ? (
        <p className="text-sm text-muted-foreground">
          Check your email for a sign-in link.
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

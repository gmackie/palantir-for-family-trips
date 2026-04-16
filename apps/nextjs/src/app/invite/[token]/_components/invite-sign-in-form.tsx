"use client";

import { Button } from "@gmacko/ui/button";
import { Input } from "@gmacko/ui/input";
import { startTransition, useState } from "react";

import { authClient } from "~/auth/client";

export function InviteSignInForm(props: { email: string; token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setIsPending(true);

        startTransition(async () => {
          try {
            await authClient.signIn.magicLink({
              email: props.email,
              callbackURL: `/invite/${props.token}`,
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
          value={props.email}
          readOnly
          disabled
        />
      </div>

      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? "Sending..." : "Send sign-in link"}
      </Button>

      {submitted ? (
        <p className="text-sm text-muted-foreground">
          Check {props.email} for a sign-in link. After signing in you&apos;ll
          be redirected back here to accept the invite.
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

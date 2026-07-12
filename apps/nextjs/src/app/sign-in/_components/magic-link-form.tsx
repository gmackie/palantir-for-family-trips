"use client";

import { startTransition, useState } from "react";

import { authClient } from "~/auth/client";

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

export function MagicLinkForm() {
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
        callbackURL: "/trips",
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
          void handleMagicLink();
        });
      }}
    >
      <div className="space-y-2">
        <label className="text-xs font-semibold text-[#8B949E]" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="flex h-10 w-full rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 text-sm text-[#C9D1D9] placeholder-[#484F58] outline-none transition-colors focus:border-[#58A6FF]"
        />
      </div>

      <button
        className="flex h-10 w-full items-center justify-center rounded-[2px] border border-[#58A6FF] bg-[#58A6FF]/10 text-sm font-semibold text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20 disabled:opacity-50"
        disabled={isPending || !email}
        type="submit"
      >
        {isPending
          ? "Sending link..."
          : submitted
            ? "Link sent — check email"
            : "Send magic link"}
      </button>

      {isDev ? (
        <button
          type="button"
          onClick={() => startTransition(() => handleDevLogin())}
          disabled={isPending || !email}
          className="w-full text-center text-xs text-[#484F58] underline transition-colors hover:text-[#8B949E] disabled:opacity-50"
        >
          Dev auto-login (local only)
        </button>
      ) : null}

      {submitted ? (
        <p className="text-sm text-[#8B949E]">
          Check your email for a sign-in link from{" "}
          <span className="font-mono text-[#C9D1D9]">noreply@gmac.io</span>.
        </p>
      ) : null}
      {error ? <p className="text-sm text-[#F85149]">{error}</p> : null}
    </form>
  );
}

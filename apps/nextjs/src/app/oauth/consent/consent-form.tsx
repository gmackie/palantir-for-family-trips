"use client";

import { useEffect, useState } from "react";
import { z } from "zod/v4";

import {
  clientIdOf,
  redirectHost,
  requestedScopes,
  signedOAuthQuery,
} from "~/lib/oauth";

/** The provider's answers, parsed at this boundary. */
const PublicClient = z.object({ client_name: z.string().optional() });
const Redirect = z.object({ url: z.string() });
const OAuthError = z.object({ error_description: z.string() });

/** The provider's public view of a client: its name, for the consent screen. */
async function fetchClientName(clientId: string): Promise<string> {
  const response = await fetch(
    `/api/auth/oauth2/public-client?${new URLSearchParams({ client_id: clientId })}`,
    { credentials: "same-origin" },
  );
  const client = PublicClient.safeParse(
    await response.json().catch(() => null),
  );
  const name = client.success ? (client.data.client_name ?? "").trim() : "";
  return name === "" ? "An app" : name;
}

/** POSTs the decision; answers the URL the provider redirects to. */
async function postConsent(body: {
  accept: boolean;
  scope: string;
  oauth_query: string;
}): Promise<string> {
  const response = await fetch("/api/auth/oauth2/consent", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  const redirect = Redirect.safeParse(payload);
  if (response.ok && redirect.success) return redirect.data.url;
  const error = OAuthError.safeParse(payload);
  throw new Error(
    error.success
      ? error.data.error_description
      : `The authorization server answered ${response.status}.`,
  );
}

export function ConsentForm() {
  // The signed query must go back byte for byte: read it from the location.
  const [search, setSearch] = useState<string | null>(null);
  const [clientName, setClientName] = useState("An app");
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const current = window.location.search;
    setSearch(current);
    setSelected(requestedScopes(current).preselected);
    const clientId = clientIdOf(current);
    if (clientId !== null) {
      void fetchClientName(clientId).then(setClientName, () => undefined);
    }
  }, []);

  if (search === null) {
    return <p className="text-sm text-[#8B949E]">Loading…</p>;
  }

  const scopes = requestedScopes(search);

  const respond = async (accept: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      window.location.assign(
        await postConsent({
          accept,
          scope: [...selected, ...scopes.passthrough].join(" "),
          oauth_query: signedOAuthQuery(search),
        }),
      );
    } catch (failure) {
      setSubmitting(false);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not complete consent.",
      );
    }
  };

  return (
    <div className="flex flex-col gap-5 text-[#C9D1D9]">
      <p className="text-sm leading-6">
        <strong>{clientName}</strong> wants to connect to your Sortey account
        and will send you back to <code>{redirectHost(search)}</code>.
      </p>
      {scopes.offered.length === 0 ? (
        <p className="text-sm text-[#D29922]">
          This app asked for no permissions Sortey can grant.
        </p>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold uppercase text-[#58A6FF]">
            It may
          </legend>
          {scopes.offered.map((choice) => (
            <label
              key={choice.scope}
              className="flex items-start gap-3 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(choice.scope)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, choice.scope]
                      : current.filter((scope) => scope !== choice.scope),
                  )
                }
              />
              <span>
                {choice.description}
                <span className="block font-mono text-xs text-[#58A6FF]">
                  {choice.scope}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-[#F85149]">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          className="flex h-10 flex-1 items-center justify-center rounded-[2px] border border-[#58A6FF] bg-[#58A6FF]/10 text-sm font-semibold text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20 disabled:opacity-50"
          disabled={submitting || selected.length === 0}
          onClick={() => void respond(true)}
        >
          Allow
        </button>
        <button
          type="button"
          className="flex h-10 flex-1 items-center justify-center rounded-[2px] border border-[#21262D] bg-[#0D1117] text-sm font-semibold text-[#8B949E] transition-colors hover:border-[#484F58] hover:text-[#C9D1D9] disabled:opacity-50"
          disabled={submitting}
          onClick={() => void respond(false)}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

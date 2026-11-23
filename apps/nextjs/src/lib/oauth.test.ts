import { describe, expect, it } from "vitest";

import {
  authorizeUrl,
  redirectHost,
  requestedScopes,
  signedOAuthQuery,
  toQueryString,
} from "./oauth";

const signed =
  "?response_type=code&client_id=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5555%2Fcb&scope=sortey%3Aread+sortey%3Awrite+offline_access&state=s&exp=1&sig=abc";

describe("OAuth page helpers", () => {
  it("restarts the client's request without the provider's signature", () => {
    expect(authorizeUrl(signed)).toBe(
      "/api/auth/oauth2/authorize?response_type=code&client_id=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5555%2Fcb&scope=sortey%3Aread+sortey%3Awrite+offline_access&state=s",
    );
  });

  it("sends the signed query back unchanged", () => {
    expect(signedOAuthQuery(signed)).toBe(signed.slice(1));
  });

  it("offers grantable scopes, pre-ticks reads and passes offline_access through", () => {
    const scopes = requestedScopes(signed);
    expect(scopes.offered.map((choice) => choice.scope)).toEqual([
      "sortey:read",
      "sortey:write",
    ]);
    expect(scopes.preselected).toEqual(["sortey:read"]);
    expect(scopes.passthrough).toEqual(["offline_access"]);
  });

  it("names the redirect host and rebuilds Next's searchParams", () => {
    expect(redirectHost(signed)).toBe("127.0.0.1:5555");
    expect(redirectHost("?redirect_uri=nonsense")).toBe("an unknown address");
    expect(toQueryString({ a: "1", b: ["2", "3"], c: undefined })).toBe(
      "a=1&b=2&b=3",
    );
  });
});

import { memoryAdapter } from "better-auth/adapters/memory";
import { magicLink } from "better-auth/plugins/magic-link";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@sortey/db/client", () => ({ db: {} }));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () =>
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
}));

import {
  demoLoginAllowlist,
  initAuth,
} from "../../../../packages/auth/src/index";

afterEach(() => vi.unstubAllEnvs());

it("reads a late production allowlist, verifies once, and rejects other accounts", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DEMO_LOGIN_EMAILS", "");
  const auth = initAuth({
    baseUrl: "https://sortey.app",
    productionUrl: "https://sortey.app",
    secret: "review-test-secret-with-at-least-32-characters",
    devMagicLinkBypassEnabled: () => demoLoginAllowlist().length > 0,
    extraPlugins: [magicLink({ sendMagicLink: async () => {} })],
  });
  const mint = (email: string) =>
    auth.handler(
      new Request("https://sortey.app/api/auth/dev/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
  expect((await mint("reviewer+traveler@sortey.app")).status).toBe(403);
  // Worker bindings arrive after auth construction.
  vi.stubEnv("DEMO_LOGIN_EMAILS", "reviewer+traveler@sortey.app");
  expect((await mint("customer@example.com")).status).toBe(403);
  expect((await mint("someone@demo.preflight.app")).status).toBe(403);
  const response = await mint("reviewer+traveler@sortey.app");
  expect(response.status).toBe(200);
  const { token } = (await response.json()) as { token: string };
  const verify = () =>
    auth.handler(
      new Request(
        `https://sortey.app/api/auth/magic-link/verify?token=${token}`,
      ),
    );
  const verified = await verify();
  expect(verified.status).toBe(200);
  expect(verified.headers.get("set-cookie")).toContain("session_token");
  expect(await verified.json()).toMatchObject({
    user: { email: "reviewer+traveler@sortey.app" },
  });
  expect((await verify()).status).not.toBe(200);
  vi.stubEnv("DEMO_LOGIN_EMAILS", "");
  expect((await mint("reviewer+traveler@sortey.app")).status).toBe(403);
});

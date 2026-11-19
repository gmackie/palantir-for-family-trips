import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const association = JSON.parse(
  readFileSync(
    new URL(
      "../../public/.well-known/apple-app-site-association",
      import.meta.url,
    ),
    "utf8",
  ),
) as { applinks: { details: { appID: string; paths: string[] }[] } };

// Legacy AASA paths are evaluated in order; the first match wins.
function opensInApp(paths: string[], url: string) {
  const pathname = new URL(url).pathname;
  for (const rule of paths) {
    const excluded = rule.startsWith("NOT ");
    const pattern = excluded ? rule.slice(4) : rule;
    const matches = pattern.endsWith("*")
      ? pathname.startsWith(pattern.slice(0, -1))
      : pathname === pattern;
    if (matches) return !excluded;
  }
  return false;
}

describe("Sortey universal links", () => {
  it("covers production, development and Expo builds", () => {
    expect(association.applinks.details.map(({ appID }) => appID)).toEqual([
      "P4SWQXAB5H.com.gmacko.sortey",
      "P4SWQXAB5H.com.gmacko.sortey.dev",
      "P4SWQXAB5H.com.gmacko.sortey.expo",
    ]);
  });

  for (const { appID, paths } of association.applinks.details) {
    it(`${appID} leaves API verification in the browser`, () => {
      expect(paths[0]).toBe("NOT /api/*");
      for (const path of [
        "/api/auth/magic-link/verify?token=test&callbackURL=sortey%3A%2F%2F",
        "/api/auth/callback/apple",
        "/api/anything",
      ]) {
        expect(opensInApp(paths, `https://sortey.app${path}`)).toBe(false);
      }
      expect(opensInApp(paths, "https://sortey.app/invite/token")).toBe(true);
      expect(opensInApp(paths, "https://sortey.app/trip/123")).toBe(true);
    });
  }
});

import { describe, expect, it } from "vitest";

import { redirectSystemPath } from "../app/+native-intent";

describe("native image-share handoff", () => {
  it.each([
    true,
    false,
  ])("opens the app root for the captured handoff (initial=%s)", (initial) => {
    const path =
      "sortey-dev://dataUrl=sortey-devShareKey?nonce=5129C79C-DEA1-463F-B552-1898BD244127";
    expect(redirectSystemPath({ path, initial })).toBe("/");
  });

  it.each([
    "media",
    "file",
    "text",
    "weburl",
  ])("handles the native extension fragment %s", (kind) => {
    const path = `sortey-dev://dataUrl=sortey-devShareKey?nonce=5129C79C-DEA1-463F-B552-1898BD244127#${kind}`;
    expect(redirectSystemPath({ path, initial: false })).toBe("/");
  });

  it.each([
    "sortey",
    "sortey-dev",
    "sortey-expo",
  ])("handles the extension key for %s", (scheme) => {
    expect(
      redirectSystemPath({
        path: `${scheme}://dataUrl=${scheme}ShareKey`,
        initial: false,
      }),
    ).toBe("/");
  });

  it.each([
    "sortey-dev://?cookie=SYNTHETIC",
    "sortey-dev://trip/owned-trip",
    "/trip/owned-trip",
    "https://sortey.app/trip/owned-trip",
    "foreign://dataUrl=foreignShareKey",
    "sortey-dev://dataUrl=sorteyShareKey",
    "sortey-dev://dataUrl=sortey-devShareKey/foreign",
    "sortey-dev://dataUrl=sortey-devShareKey?cookie=SYNTHETIC",
    "sortey-dev://dataUrl=sortey-devShareKey?nonce=invalid",
    "",
  ])("preserves unrelated or malformed links: %s", (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });
});

import { describe, expect, it } from "vitest";

import { resolveAuthScheme } from "./auth-scheme";

describe("native authentication callback scheme", () => {
  it("uses the configured development, preview and production scheme", () => {
    for (const scheme of ["sortey-expo", "sortey-dev", "sortey"]) {
      expect(resolveAuthScheme(scheme)).toBe(scheme);
    }
  });

  it("uses the first configured scheme when Expo declares several", () => {
    expect(resolveAuthScheme(["sortey-expo", "exp+sortey"])).toBe(
      "sortey-expo",
    );
  });

  it("keeps the store scheme when native configuration has no scheme", () => {
    expect(resolveAuthScheme(undefined)).toBe("sortey");
    expect(resolveAuthScheme([])).toBe("sortey");
  });
});

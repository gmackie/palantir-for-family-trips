import { beforeEach, describe, expect, it } from "vitest";

import {
  assertDevAuthEnabled,
  createDevMagicLinkStore,
} from "./dev-magic-link";

describe("createDevMagicLinkStore", () => {
  let store: ReturnType<typeof createDevMagicLinkStore>;

  beforeEach(() => {
    store = createDevMagicLinkStore();
  });

  it("remembers the last magic link that was generated", () => {
    expect(store.getLast()).toBeNull();

    store.remember({
      email: "alex@example.com",
      url: "http://localhost:3000/api/auth/magic-link?token=abc",
    });

    expect(store.getLast()).toEqual({
      email: "alex@example.com",
      url: "http://localhost:3000/api/auth/magic-link?token=abc",
    });
  });

  it("overwrites the previous link when a new one is generated", () => {
    store.remember({
      email: "alex@example.com",
      url: "http://localhost:3000/api/auth/magic-link?token=abc",
    });
    store.remember({
      email: "sam@example.com",
      url: "http://localhost:3000/api/auth/magic-link?token=xyz",
    });

    expect(store.getLast()).toEqual({
      email: "sam@example.com",
      url: "http://localhost:3000/api/auth/magic-link?token=xyz",
    });
  });

  it("clears the remembered link", () => {
    store.remember({
      email: "alex@example.com",
      url: "http://localhost:3000/api/auth/magic-link?token=abc",
    });

    store.clear();

    expect(store.getLast()).toBeNull();
  });
});

describe("assertDevAuthEnabled", () => {
  it("allows development mode", () => {
    expect(() => assertDevAuthEnabled("development")).not.toThrow();
  });

  it("rejects non-development environments", () => {
    expect(() => assertDevAuthEnabled("production")).toThrow(
      /development only/i,
    );
  });
});

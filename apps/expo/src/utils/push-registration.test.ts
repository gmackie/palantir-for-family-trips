import { describe, expect, it } from "vitest";

import { createPushRegistration } from "./push-registration";

function fixture() {
  const calls: string[] = [];
  const dependencies = {
    async getToken() {
      calls.push("token");
      return "expo-token";
    },
    async register(token: string) {
      calls.push(token);
    },
  };
  return { calls, dependencies };
}

describe("authenticated push registration", () => {
  it("does no permission/token work signed out, then registers after sign-in", async () => {
    const registration = createPushRegistration();
    const { calls, dependencies } = fixture();
    await registration.start(null, dependencies).done;
    expect(calls).toEqual([]);
    await registration.start("traveler", dependencies).done;
    expect(calls).toEqual(["token", "expo-token"]);
  });

  it("cancels registration when the session changes during token acquisition", async () => {
    const registration = createPushRegistration();
    const { calls, dependencies } = fixture();
    let resolveToken = (_token: string) => {};
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const pending = registration.start("traveler", {
      ...dependencies,
      getToken: () => token,
    });
    pending.cancel();
    await registration.start(null, dependencies).done;
    resolveToken("stale-token");
    await pending.done;
    expect(calls).toEqual([]);
    await registration.start("member", dependencies).done;
    expect(calls).toEqual(["token", "expo-token"]);
  });

  it("registers once per signed-in user and registers again after sign-out", async () => {
    const registration = createPushRegistration();
    const { calls, dependencies } = fixture();
    await registration.start("traveler", dependencies).done;
    await registration.start("traveler", dependencies).done;
    expect(calls).toHaveLength(2);
    await registration.start("member", dependencies).done;
    expect(calls).toHaveLength(4);
    await registration.start(null, dependencies).done;
    await registration.start("member", dependencies).done;
    expect(calls).toHaveLength(6);
  });

  it("does not treat a rejected registration as completed", async () => {
    const registration = createPushRegistration();
    const { calls, dependencies } = fixture();
    await registration.start("traveler", {
      ...dependencies,
      async register() {
        throw new Error("offline");
      },
    }).done;
    await registration.start("traveler", dependencies).done;
    expect(calls).toEqual(["token", "token", "expo-token"]);
  });

  it("does not mark an old user registered after a newer account finishes", async () => {
    const registration = createPushRegistration();
    const { calls, dependencies } = fixture();
    let completeRequest = () => {};
    const request = new Promise<void>((resolve) => {
      completeRequest = resolve;
    });
    const old = registration.start("traveler", {
      ...dependencies,
      register: () => request,
    });
    await Promise.resolve();
    old.cancel();
    await registration.start("member", dependencies).done;
    completeRequest();
    await old.done;
    await registration.start("member", dependencies).done;
    expect(calls).toEqual(["token", "token", "expo-token"]);
  });

  it("does not register when notifications have no available token", async () => {
    const registration = createPushRegistration();
    const { calls, dependencies } = fixture();
    await registration.start("traveler", {
      ...dependencies,
      getToken: async () => null,
    }).done;
    expect(calls).toEqual([]);
    await registration.start("traveler", dependencies).done;
    expect(calls).toEqual(["token", "expo-token"]);
  });
});

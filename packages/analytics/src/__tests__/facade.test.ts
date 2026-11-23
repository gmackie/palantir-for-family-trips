import { describe, expect, it } from "vitest";

import type { ClientEvents, ServerEvent } from "../events";
import { type AnalyticsSink, createAnalytics, scrubProps } from "../facade";

type Call = readonly [string, ...ReadonlyArray<string | object>];

const recordingSink = (): AnalyticsSink & { calls: Array<Call> } => {
  const calls: Array<Call> = [];
  return {
    calls,
    track: (event, props) => calls.push(["track", event, props]),
    identify: (userId) => calls.push(["identify", userId]),
    reset: () => calls.push(["reset"]),
  };
};

describe("createAnalytics", () => {
  it("is a disabled no-op with no providers", () => {
    const analytics = createAnalytics<ClientEvents>([]);
    expect(analytics.enabled).toBe(false);
    expect(() => {
      analytics.trackEvent("invite_sent", { role: "member" });
      analytics.identifyUser("usr_1");
      analytics.syncUser(null);
      analytics.resetUser();
    }).not.toThrow();
  });

  it("dispatches every call to every provider", () => {
    const a = recordingSink();
    const b = recordingSink();
    const analytics = createAnalytics<ClientEvents>([a, b]);
    analytics.trackEvent("workspace_created", { source: "bootstrap" });
    analytics.identifyUser("usr_1");
    analytics.resetUser();
    const expected: Array<Call> = [
      ["track", "workspace_created", { source: "bootstrap" }],
      ["identify", "usr_1"],
      ["reset"],
    ];
    expect(a.calls).toEqual(expected);
    expect(b.calls).toEqual(expected);
  });

  it("keeps going when one provider throws", () => {
    const broken: AnalyticsSink = {
      track: () => {
        throw new Error("boom");
      },
      identify: () => {},
      reset: () => {},
    };
    const ok = recordingSink();
    const analytics = createAnalytics<ClientEvents>([broken, ok]);
    analytics.trackEvent("checkout_started", { plan: "pro" });
    expect(ok.calls).toEqual([["track", "checkout_started", { plan: "pro" }]]);
  });

  it("follows the session: identify once, reset on change and on sign-out", () => {
    const sink = recordingSink();
    const analytics = createAnalytics<ClientEvents>([sink]);
    analytics.syncUser(null);
    analytics.syncUser("usr_1");
    analytics.syncUser("usr_1");
    analytics.syncUser("usr_2");
    analytics.syncUser(null);
    expect(sink.calls).toEqual([
      ["identify", "usr_1"],
      ["reset"],
      ["identify", "usr_2"],
      ["reset"],
    ]);
  });

  it("never identifies by an email address", () => {
    const sink = recordingSink();
    createAnalytics<ClientEvents>([sink]).identifyUser("someone@example.com");
    expect(sink.calls).toEqual([]);
  });
});

describe("scrubProps", () => {
  it("drops PII-named keys and email-looking values at runtime", () => {
    expect(
      scrubProps({
        role: "admin",
        email: "a@b.co",
        user_name: "Ada",
        note: "x@y.io",
        count: 2,
      }),
    ).toEqual({ role: "admin", count: 2 });
  });
});

describe("event catalog types", () => {
  it("refuses PII properties and unknown events at compile time", () => {
    const analytics = createAnalytics<ClientEvents>([]);
    analytics.trackEvent("invite_sent", { role: "admin" });
    // @ts-expect-error an email is never an event property
    analytics.trackEvent("invite_sent", { role: "admin", email: "a@b.co" });
    analytics.trackEvent("workspace_created", {
      source: "settings",
      // @ts-expect-error a name is never an event property
      name: "x",
    });
    // @ts-expect-error not in the catalog
    analytics.trackEvent("made_up_event");
    // @ts-expect-error the role is an enum
    analytics.trackEvent("invite_sent", { role: "guest" });

    const signup: ServerEvent = {
      event: "user_signed_up",
      id: "signup:usr_1",
      distinctId: "usr_1",
      props: {},
    };
    const leaky: ServerEvent = {
      event: "subscription_activated",
      id: "stripe:evt_1",
      distinctId: "cus_1",
      // @ts-expect-error server events cannot carry an email either
      props: { transition: "created", email: "a@b.co" },
    };
    expect([signup.id, leaky.id]).toEqual(["signup:usr_1", "stripe:evt_1"]);
  });
});

describe("captureEvent and person properties", () => {
  it("captures an untyped event with scrubbed props, and drops an empty name", () => {
    const sink = recordingSink();
    const analytics = createAnalytics<ClientEvents>([sink]);
    analytics.captureEvent("legacy_clicked", {
      count: 2,
      email: "a@b.co",
      note: "mail me at a@b.co",
    });
    analytics.captureEvent("");
    analytics.captureEvent("bare");
    expect(sink.calls).toEqual([
      ["track", "legacy_clicked", { count: 2 }],
      ["track", "bare", {}],
    ]);
  });

  it("passes scrubbed person properties on identify", () => {
    const identified: Array<unknown> = [];
    const sink: AnalyticsSink = {
      track: () => {},
      identify: (userId, props) => identified.push([userId, props]),
      reset: () => {},
    };
    const analytics = createAnalytics<ClientEvents>([sink]);
    analytics.identifyUser("usr_1", { plan: "pro", email: "a@b.co" });
    analytics.resetUser();
    analytics.identifyUser("usr_2");
    expect(identified).toEqual([
      ["usr_1", { plan: "pro" }],
      ["usr_2", undefined],
    ]);
  });
});

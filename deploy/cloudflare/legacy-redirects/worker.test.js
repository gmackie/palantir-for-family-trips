import assert from "node:assert/strict";
import { test } from "node:test";
import { redirect } from "./worker.js";

test("GET keeps path and query and returns 301", () => {
  const res = redirect(
    new Request("https://sortie.gmac.io/trips/abc?tab=plan&x=1"),
  );
  assert.equal(res.status, 301);
  assert.equal(
    res.headers.get("location"),
    "https://sortey.app/trips/abc?tab=plan&x=1",
  );
});

test("root redirects to the root", () => {
  const res = redirect(new Request("https://trip.gmac.io/"));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://sortey.app/");
});

test("non-GET requests keep their method with 308", () => {
  const res = redirect(
    new Request("https://sortie.gmac.io/api/trpc/x", { method: "POST" }),
  );
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("location"), "https://sortey.app/api/trpc/x");
});

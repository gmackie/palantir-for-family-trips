// @ts-expect-error vitest is installed in sibling workspace test packages
import { describe, expect, it } from "vitest";

import { withHealthIdentity } from "./health-identity";

const commit = "926cfd0b457294391252102d733f9558f826d339";
const version = "5e6c7853-c4f6-4faa-bf3f-2f67662ad52a";
const spoofedCommit = "0000000000000000000000000000000000000000";
const spoofedVersion = "00000000-0000-4000-8000-000000000001";

const spoofedHeaders = {
  "x-fg-commit-sha": spoofedCommit,
  "x-fg-worker-version": spoofedVersion,
};
const request = (path: string) =>
  new Request(`https://sortey.test${path}`, { headers: spoofedHeaders });
const upstream = (status = 200) =>
  Response.json(
    { status: status === 200 ? "ready" : "not_ready" },
    {
      status,
      headers: { ...spoofedHeaders, "cache-control": "public, max-age=60" },
    },
  );
const validEnv = {
  FG_COMMIT_HASH: commit,
  FG_WORKER_VERSION: { id: version },
};

describe("withHealthIdentity", () => {
  it.each([
    "/api/health",
    "/api/health/ready",
    "/api/health/live",
    "/.well-known/forge-health",
  ])("sets identity from bindings on %s", async (path) => {
    const response = withHealthIdentity(request(path), validEnv, upstream());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(response.headers.get("x-fg-commit-sha")).toBe(commit);
    expect(response.headers.get("x-fg-worker-version")).toBe(version);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("preserves an unhealthy status while still reporting identity", () => {
    const response = withHealthIdentity(
      request("/api/health"),
      validEnv,
      upstream(503),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("x-fg-commit-sha")).toBe(commit);
  });

  it("strips spoofed values when no bindings are present", () => {
    const response = withHealthIdentity(request("/api/health"), {}, upstream());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-fg-commit-sha")).toBeNull();
    expect(response.headers.get("x-fg-worker-version")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    undefined,
    null,
    "",
    "short",
    `${commit}\n`,
    123,
  ])("omits invalid source identity (%s)", (value) => {
    const response = withHealthIdentity(
      request("/api/health"),
      { FG_COMMIT_HASH: value, FG_WORKER_VERSION: { id: version } },
      upstream(),
    );
    expect(response.headers.get("x-fg-commit-sha")).toBeNull();
    expect(response.headers.get("x-fg-worker-version")).toBe(version);
  });

  it.each([
    undefined,
    null,
    {},
    { id: "" },
    { id: "not-a-version" },
    { id: 123 },
    version,
  ])("omits invalid runtime identity (%s)", (value) => {
    const response = withHealthIdentity(
      request("/api/health"),
      { FG_COMMIT_HASH: commit, FG_WORKER_VERSION: value },
      upstream(),
    );
    expect(response.headers.get("x-fg-commit-sha")).toBe(commit);
    expect(response.headers.get("x-fg-worker-version")).toBeNull();
  });

  it.each([
    "/",
    "/api/other",
    "/api/healthz",
    "/api/health/ready/extra",
  ])("leaves non-health path %s untouched", (path) => {
    const original = upstream();
    const response = withHealthIdentity(request(path), validEnv, original);
    expect(response).toBe(original);
    expect(response.headers.get("x-fg-commit-sha")).toBe(spoofedCommit);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

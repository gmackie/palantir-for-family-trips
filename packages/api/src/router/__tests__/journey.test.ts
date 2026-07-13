import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/gmacko_test";

const { journeyRouter } = await import("../journey");

describe("journey router contract", () => {
  it("exposes the complete recorded-stop lifecycle", () => {
    expect(Object.keys(journeyRouter).sort()).toEqual(
      [
        "deleteStop",
        "list",
        "logStop",
        "moveStop",
        "retryRoute",
        "reverseGeocode",
        "updateStop",
      ].sort(),
    );
  });
});

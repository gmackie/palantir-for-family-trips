import { describe, expect, it } from "vitest";

import {
  assertSecureOtaUrl,
  InsecureOtaUrlError,
  isLoopbackUrl,
  otaCodeSigning,
  resolveOtaUrl,
} from "../../ota-config";

describe("assertSecureOtaUrl", () => {
  it("accepts HTTPS", () => {
    expect(() =>
      assertSecureOtaUrl("https://ota.example.com/sortey"),
    ).not.toThrow();
  });

  it("rejects plain HTTP on a LAN address", () => {
    // The actual hole: a device polling this while authenticated against prod
    // will run whatever a LAN peer answers with.
    expect(() =>
      assertSecureOtaUrl("http://192.168.1.20:4000/manifest"),
    ).toThrow(InsecureOtaUrlError);
    expect(() => assertSecureOtaUrl("http://ota.local/manifest")).toThrow(
      InsecureOtaUrlError,
    );
  });

  it("allows plain HTTP on loopback — that traffic never leaves the machine", () => {
    expect(() => assertSecureOtaUrl("http://localhost:4000")).not.toThrow();
    expect(() => assertSecureOtaUrl("http://127.0.0.1:4000")).not.toThrow();
  });

  it("rejects a malformed URL rather than passing it through", () => {
    expect(() => assertSecureOtaUrl("not-a-url")).toThrow(InsecureOtaUrlError);
    expect(() => assertSecureOtaUrl("")).toThrow(InsecureOtaUrlError);
  });

  it("names what to do in the error", () => {
    expect(() => assertSecureOtaUrl("http://10.0.0.5:4000")).toThrow(/HTTPS/);
  });
});

describe("isLoopbackUrl", () => {
  it("is not fooled by a loopback-looking hostname", () => {
    expect(isLoopbackUrl("http://localhost.evil.com")).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackUrl("http://localhost")).toBe(true);
  });
});

describe("resolveOtaUrl", () => {
  it("returns null when unset, selecting the EAS default", () => {
    expect(resolveOtaUrl({})).toBeNull();
  });

  it("validates whatever is configured", () => {
    expect(
      resolveOtaUrl({ PREFLIGHT_OTA_URL: "https://ota.example.com" }),
    ).toBe("https://ota.example.com");
    expect(() =>
      resolveOtaUrl({ PREFLIGHT_OTA_URL: "http://192.168.1.20:4000" }),
    ).toThrow(InsecureOtaUrlError);
  });
});

describe("otaCodeSigning", () => {
  it("is absent without a certificate, so unsigned manifests still work", () => {
    expect(otaCodeSigning({})).toEqual({});
  });

  it("emits the certificate and metadata when configured", () => {
    expect(
      otaCodeSigning({
        PREFLIGHT_OTA_CODE_SIGNING_CERT: "./certs/ota.pem",
        PREFLIGHT_OTA_CODE_SIGNING_KEY_ID: "preflight-2026",
      }),
    ).toEqual({
      codeSigningCertificate: "./certs/ota.pem",
      codeSigningMetadata: { keyid: "preflight-2026", alg: "rsa-v1_5-sha256" },
    });
  });

  it("defaults the key id and algorithm", () => {
    expect(
      otaCodeSigning({ PREFLIGHT_OTA_CODE_SIGNING_CERT: "./certs/ota.pem" }),
    ).toMatchObject({
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    });
  });
});

/**
 * OTA update endpoint policy.
 *
 * Preview device builds poll a Preflight-hosted update endpoint while holding
 * a session against the production API. Over plain HTTP on a shared LAN that
 * is a code-execution hole: anything that can answer for the host — ARP
 * spoofing, a rogue DHCP-assigned DNS, or simply squatting the address after a
 * lease change — serves a manifest the client will download and run.
 *
 * Two defences, both enforced here:
 *
 * 1. **Transport.** A non-loopback `http://` update URL is rejected outright.
 *    Loopback stays allowed because the simulator's own host is not on the LAN.
 * 2. **Signature.** When a code-signing certificate is configured, expo-updates
 *    verifies every manifest against it and refuses anything unsigned or signed
 *    by another key — which holds even if the transport is later downgraded.
 *
 * Rejecting at config time is deliberate: a build that would silently trust a
 * LAN peer should not be producible, and an OTA misconfiguration discovered on
 * the road is worthless.
 */

class InsecureOtaUrlError extends Error {
  /** @param {string} url */
  constructor(url) {
    super(
      `Refusing to build with a plain-HTTP OTA endpoint: ${url}\n` +
        "Any LAN peer that answers for this host can push arbitrary JS to the " +
        "device. Serve the endpoint over HTTPS, or point PREFLIGHT_OTA_URL at " +
        "localhost for simulator work.",
    );
    this.name = "InsecureOtaUrlError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True when a plain-HTTP URL is safe: the request never leaves the machine. */
/** @param {string} url @returns {boolean} */
function isLoopbackUrl(url) {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** @param {string} url */
function assertSecureOtaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new InsecureOtaUrlError(url);
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && isLoopbackUrl(url)) return;
  throw new InsecureOtaUrlError(url);
}

/**
 * Code-signing block for `updates`, when a certificate is configured. Returns
 * `{}` so it can always be spread — expo-updates simply does not verify
 * signatures when the key is absent.
 */
/** @param {Record<string, string | undefined>} [env] */
function otaCodeSigning(env = process.env) {
  const certificate = env.PREFLIGHT_OTA_CODE_SIGNING_CERT;
  if (!certificate) return {};
  return {
    codeSigningCertificate: certificate,
    codeSigningMetadata: {
      keyid: env.PREFLIGHT_OTA_CODE_SIGNING_KEY_ID ?? "main",
      alg: env.PREFLIGHT_OTA_CODE_SIGNING_ALG ?? "rsa-v1_5-sha256",
    },
  };
}

/** The resolved `updates.url`, validated. `null` selects the EAS default. */
/** @param {Record<string, string | undefined>} [env] @returns {string | null} */
function resolveOtaUrl(env = process.env) {
  const url = env.PREFLIGHT_OTA_URL;
  if (!url) return null;
  assertSecureOtaUrl(url);
  return url;
}

module.exports = {
  InsecureOtaUrlError,
  isLoopbackUrl,
  assertSecureOtaUrl,
  otaCodeSigning,
  resolveOtaUrl,
};

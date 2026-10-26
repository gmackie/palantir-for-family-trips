/**
 * Accept the HTTP(S), key, host and numeric project shape parsed by Sentry.
 * Build placeholders must never reach native telemetry initialization.
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function validSentryDsn(value) {
  if (typeof value !== "string") return undefined;
  const dsn = value.trim();
  if (
    !/^https?:\/\/\w+(?::\w*)?@(?:\[[:.%\w]+\]|[\w.-]+)(?::[0-9]+)?\/(?:[^\s?#]+\/)?[0-9]+$/.test(
      dsn,
    )
  ) {
    return undefined;
  }
  return dsn;
}

/**
 * @param {...(string | undefined)} candidates
 * @returns {string | undefined}
 */
function selectSentryDsn(...candidates) {
  for (const candidate of candidates) {
    const dsn = validSentryDsn(candidate);
    if (dsn) return dsn;
  }
  return undefined;
}

module.exports = { validSentryDsn, selectSentryDsn };

const PASSTHROUGH_KEYS = [
  "hyperdrive",
  "preview_urls",
  "route",
  "routes",
  "triggers",
  "workers_dev",
];

/**
 * @param {unknown} value
 */
function hasConfigValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return value !== undefined;
}

/**
 * @param {{
 *   buildConfig: Record<string, unknown>;
 *   sourceConfig: Record<string, unknown>;
 * }} input
 */
export function syncWranglerDeployConfig({ buildConfig, sourceConfig }) {
  const nextConfig = {
    ...buildConfig,
  };

  for (const key of PASSTHROUGH_KEYS) {
    const value = sourceConfig[key];
    if (hasConfigValue(value)) {
      nextConfig[key] = value;
    }
  }

  return nextConfig;
}

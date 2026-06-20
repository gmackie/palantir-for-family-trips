import { integrations } from "@sortey/config";

/**
 * Check if storage is enabled
 */
export function isStorageEnabled(): boolean {
  return integrations.storage.enabled;
}

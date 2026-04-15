// @ts-nocheck
export const PUBLISH_CONFIG = {
  visibilityMode: "public",
  liveExternalData: true,
};

export function isPublicMode() {
  return PUBLISH_CONFIG.visibilityMode === "public";
}

export function isLiveExternalDataEnabled() {
  return PUBLISH_CONFIG.liveExternalData !== false;
}

export interface DevMagicLinkRecord {
  email: string;
  url: string;
}

export function createDevMagicLinkStore() {
  let lastLink: DevMagicLinkRecord | null = null;

  return {
    remember(record: DevMagicLinkRecord) {
      lastLink = record;
    },
    getLast() {
      return lastLink;
    },
    clear() {
      lastLink = null;
    },
  };
}

export function assertDevAuthEnabled(nodeEnv: string | undefined) {
  if (nodeEnv !== "development") {
    throw new Error("Development only auth route");
  }
}

export const devMagicLinkStore = createDevMagicLinkStore();

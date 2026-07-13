import * as SecureStore from "expo-secure-store";

import {
  CAPTURE_OUTBOX_KEY,
  CaptureOutbox,
  type CaptureOutboxStorage,
} from "./capture-outbox";

const secureStorage: CaptureOutboxStorage = {
  get: () => SecureStore.getItemAsync(CAPTURE_OUTBOX_KEY),
  set: (value) => SecureStore.setItemAsync(CAPTURE_OUTBOX_KEY, value),
};

export const captureOutbox = new CaptureOutbox(secureStorage);

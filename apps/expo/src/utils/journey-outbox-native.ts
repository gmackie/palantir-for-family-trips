import * as SecureStore from "expo-secure-store";

import {
  JOURNEY_OUTBOX_KEY,
  JourneyOutbox,
  type JourneyOutboxStorage,
} from "./journey-outbox";

const secureStorage: JourneyOutboxStorage = {
  get: () => SecureStore.getItemAsync(JOURNEY_OUTBOX_KEY),
  set: (value) => SecureStore.setItemAsync(JOURNEY_OUTBOX_KEY, value),
};

export const journeyOutbox = new JourneyOutbox(secureStorage);

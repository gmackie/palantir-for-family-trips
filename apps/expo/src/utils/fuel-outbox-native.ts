import * as SecureStore from "expo-secure-store";

import {
  FUEL_OUTBOX_KEY,
  FuelOutbox,
  type FuelOutboxStorage,
} from "./fuel-outbox";

const secureStorage: FuelOutboxStorage = {
  get: () => SecureStore.getItemAsync(FUEL_OUTBOX_KEY),
  set: (value) => SecureStore.setItemAsync(FUEL_OUTBOX_KEY, value),
};

export const fuelOutbox = new FuelOutbox(secureStorage);

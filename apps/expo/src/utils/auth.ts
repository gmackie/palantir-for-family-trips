import { expoClient } from "@better-auth/expo/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import { getBaseUrl } from "./base-url";

export const authClient = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [
    expoClient({
      scheme: "sortey",
      storagePrefix: "expo",
      storage: SecureStore,
    }),
    magicLinkClient(),
  ],
});

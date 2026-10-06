import { expoClient } from "@better-auth/expo/client";
import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { resolveAuthScheme } from "./auth-scheme";
import { getBaseUrl } from "./base-url";

export const authClient = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [
    expoClient({
      scheme: resolveAuthScheme(Constants.expoConfig?.scheme),
      storagePrefix: "expo",
      storage: SecureStore,
    }),
    magicLinkClient(),
  ],
});

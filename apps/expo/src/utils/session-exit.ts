export const sessionStorageKeys = [
  "expo_cookie",
  "expo_session_data",
  "active_workspace_id",
] as const;

type SessionStorageKey = (typeof sessionStorageKeys)[number];

export interface SessionExitDependencies {
  signOut: () => Promise<void>;
  cancelQueries: () => Promise<void>;
  deleteSecureItem: (key: SessionStorageKey) => Promise<void>;
  clearSession: () => void;
  clearQueries: () => void;
  showSignIn: () => void;
}

/** Local logout must settle even when the server session is already invalid. */
export async function exitNativeSession(
  dependencies: SessionExitDependencies,
): Promise<"cleared" | "storage-error"> {
  try {
    await dependencies.signOut();
  } catch {
    // Deletion has already revoked the session; local cleanup still applies.
  }
  try {
    await dependencies.cancelQueries();
  } catch {
    // Clearing the query client below still removes its retained data.
  }
  const cleanup = await Promise.allSettled(
    sessionStorageKeys.map((key) => dependencies.deleteSecureItem(key)),
  );
  dependencies.clearSession();
  dependencies.clearQueries();
  dependencies.showSignIn();
  return cleanup.every((result) => result.status === "fulfilled")
    ? "cleared"
    : "storage-error";
}

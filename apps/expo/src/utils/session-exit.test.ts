import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { exitNativeSession, sessionStorageKeys } from "./session-exit";

function sessionBoundary() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["preferences"], { theme: "dark" });
  queryClient.setQueryData(["apiKeys"], [{ id: "private-key" }]);
  const storage = new Map<string, string>([
    ...sessionStorageKeys.map((key): [string, string] => [key, "private"]),
    ["locale", "en"],
  ]);
  const session = { data: "deleted-user", pending: true, refetching: true };
  const navigation = vi.fn(() => {
    expect(session).toEqual({ data: "", pending: false, refetching: false });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
  const dependencies = {
    signOut: vi.fn(async () => {}),
    cancelQueries: () => queryClient.cancelQueries(),
    deleteSecureItem: vi.fn(
      async (key: (typeof sessionStorageKeys)[number]) => {
        storage.delete(key);
      },
    ),
    clearSession: () => {
      session.data = "";
      session.pending = false;
      session.refetching = false;
    },
    clearQueries: () => queryClient.clear(),
    showSignIn: navigation,
  };
  return { queryClient, storage, dependencies, navigation };
}

describe("native session exit boundary", () => {
  it.each([
    false,
    true,
  ])("clears credentials, session and actual cached queries when signOut rejects=%s", async (rejects) => {
    const boundary = sessionBoundary();
    if (rejects) {
      boundary.dependencies.signOut = vi.fn(async () => {
        throw new Error("Deleted session already invalid");
      });
    }
    await expect(exitNativeSession(boundary.dependencies)).resolves.toBe(
      "cleared",
    );
    expect([...boundary.storage]).toEqual([["locale", "en"]]);
    expect(boundary.dependencies.deleteSecureItem.mock.calls).toEqual(
      sessionStorageKeys.map((key) => [key]),
    );
    expect(boundary.navigation).toHaveBeenCalledOnce();
  });

  it("aborts in-flight private queries before clearing the cache and navigating", async () => {
    const boundary = sessionBoundary();
    const events: string[] = [];
    const request = boundary.queryClient
      .fetchQuery({
        queryKey: ["slow-private-response"],
        queryFn: ({ signal }) =>
          new Promise<string>(() => {
            signal.addEventListener("abort", () => events.push("aborted"));
          }),
      })
      .catch(() => events.push("request-cancelled"));
    boundary.dependencies.showSignIn = vi.fn(() => {
      expect(events).toContain("aborted");
      boundary.navigation();
    });
    await exitNativeSession(boundary.dependencies);
    await request;
    expect(events).toContain("request-cancelled");
    expect(boundary.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it.each(
    sessionStorageKeys,
  )("still attempts every credential and clears memory/navigation if %s deletion fails", async (failedKey) => {
    const boundary = sessionBoundary();
    boundary.dependencies.deleteSecureItem = vi.fn(async (key) => {
      if (key === failedKey) throw new Error("SecureStore unavailable");
      boundary.storage.delete(key);
    });
    await expect(exitNativeSession(boundary.dependencies)).resolves.toBe(
      "storage-error",
    );
    expect(boundary.dependencies.deleteSecureItem).toHaveBeenCalledTimes(3);
    expect([...boundary.storage.keys()]).toEqual([failedKey, "locale"]);
    expect(boundary.navigation).toHaveBeenCalledOnce();
  });

  it("still clears data and navigates if query cancellation rejects", async () => {
    const boundary = sessionBoundary();
    boundary.dependencies.cancelQueries = async () => {
      throw new Error("Cancellation failed");
    };
    await expect(exitNativeSession(boundary.dependencies)).resolves.toBe(
      "cleared",
    );
    expect(boundary.navigation).toHaveBeenCalledOnce();
  });
});

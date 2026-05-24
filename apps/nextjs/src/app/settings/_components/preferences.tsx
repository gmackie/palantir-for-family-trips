"use client";

import { Label } from "@gmacko/ui/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTransition } from "react";

import { useTRPC } from "~/trpc/react";

export function PreferencesSection() {
  const [isPending, startTransition] = useTransition();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery(
    trpc.settings.getPreferences.queryOptions(),
  );

  const updatePreferences = useMutation(
    trpc.settings.updatePreferences.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.settings.getPreferences.queryKey(),
        });
      },
    }),
  );

  const handleNotificationToggle = (type: "email" | "push") => {
    if (!preferences) return;

    startTransition(() => {
      if (type === "email") {
        updatePreferences.mutate({
          emailNotifications: !preferences.emailNotifications,
        });
      } else {
        updatePreferences.mutate({
          pushNotifications: !preferences.pushNotifications,
        });
      }
    });
  };

  if (isLoading) {
    return (
      <section className="rounded-lg border p-6">
        <h2 className="mb-4 text-xl font-semibold">Preferences</h2>
        <div className="animate-pulse space-y-4">
          <div className="bg-muted h-10 rounded" />
          <div className="bg-muted h-10 rounded" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="mb-4 text-xl font-semibold">Preferences</h2>

      <div className="space-y-6">
        <div>
          <Label className="mb-2 block">Notifications</Label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preferences?.emailNotifications ?? true}
                onChange={() => handleNotificationToggle("email")}
                disabled={isPending}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>Email notifications</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preferences?.pushNotifications ?? true}
                onChange={() => handleNotificationToggle("push")}
                disabled={isPending}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>Push notifications</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

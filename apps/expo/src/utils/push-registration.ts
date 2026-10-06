interface PushRegistrationDependencies {
  getToken(): Promise<string | null>;
  register(token: string): Promise<void>;
}

export function createPushRegistration() {
  let registeredUserId: string | null = null;
  let generation = 0;

  return {
    start(userId: string | null, dependencies: PushRegistrationDependencies) {
      const current = ++generation;
      if (!userId) registeredUserId = null;
      const done = (async () => {
        if (!userId || registeredUserId === userId) return;
        try {
          const token = await dependencies.getToken();
          if (!token || current !== generation) return;
          await dependencies.register(token);
          if (current === generation) registeredUserId = userId;
        } catch {
          // A later session/effect attempt can retry a failed registration.
        }
      })();
      return {
        done,
        cancel() {
          if (current === generation) generation++;
        },
      };
    },
  };
}

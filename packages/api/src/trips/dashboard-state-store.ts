import { and, eq } from "@sortey/db";
import { tripMemberState } from "@sortey/db/schema";

import {
  createDefaultTripDashboardState,
  mergeTripDashboardState,
  type TripDashboardState,
  type TripDashboardStatePatch,
  tripDashboardStateSchema,
} from "./dashboard-state";

export type TripMemberStateStore = {
  findByTripAndUser(input: {
    tripId: string;
    userId: string;
  }): Promise<{ state: TripDashboardState; updatedAt: Date | null } | null>;
  upsert(input: {
    tripId: string;
    userId: string;
    state: TripDashboardState;
  }): Promise<{ state: TripDashboardState; updatedAt: Date | null }>;
};

function parseStoredState(raw: unknown): TripDashboardState {
  const parsed = tripDashboardStateSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return createDefaultTripDashboardState();
}

export function createTripMemberStateStore(db: unknown): TripMemberStateStore {
  return {
    findByTripAndUser: async ({ tripId, userId }) => {
      const [row] = (await (db as any)
        .select({
          state: tripMemberState.state,
          updatedAt: tripMemberState.updatedAt,
        })
        .from(tripMemberState)
        .where(
          and(
            eq(tripMemberState.tripId, tripId),
            eq(tripMemberState.userId, userId),
          ),
        )
        .limit(1)) as Array<{
        state: unknown;
        updatedAt: Date | null;
      }>;

      if (!row) return null;

      return {
        state: parseStoredState(row.state),
        updatedAt: row.updatedAt,
      };
    },

    upsert: async ({ tripId, userId, state }) => {
      const [row] = (await (db as any)
        .insert(tripMemberState)
        .values({
          tripId,
          userId,
          state,
        })
        .onConflictDoUpdate({
          target: [tripMemberState.tripId, tripMemberState.userId],
          set: {
            state,
            updatedAt: new Date(),
          },
        })
        .returning({
          state: tripMemberState.state,
          updatedAt: tripMemberState.updatedAt,
        })) as Array<{
        state: unknown;
        updatedAt: Date | null;
      }>;

      return {
        state: parseStoredState(row!.state),
        updatedAt: row!.updatedAt,
      };
    },
  };
}

export async function getTripDashboardState(
  store: TripMemberStateStore,
  input: {
    tripId: string;
    userId: string;
    legacyPatch?: Partial<TripDashboardState> | null;
  },
): Promise<TripDashboardState> {
  const existing = await store.findByTripAndUser({
    tripId: input.tripId,
    userId: input.userId,
  });

  if (existing) return existing.state;

  const initial = createDefaultTripDashboardState(
    input.legacyPatch ?? undefined,
  );

  const saved = await store.upsert({
    tripId: input.tripId,
    userId: input.userId,
    state: initial,
  });

  return saved.state;
}

export async function updateTripDashboardState(
  store: TripMemberStateStore,
  input: {
    tripId: string;
    userId: string;
    patch: TripDashboardStatePatch;
    legacyPatch?: Partial<TripDashboardState> | null;
  },
): Promise<TripDashboardState> {
  const current = await getTripDashboardState(store, {
    tripId: input.tripId,
    userId: input.userId,
    legacyPatch: input.legacyPatch,
  });

  const next = mergeTripDashboardState(current, input.patch);

  const saved = await store.upsert({
    tripId: input.tripId,
    userId: input.userId,
    state: next,
  });

  return saved.state;
}

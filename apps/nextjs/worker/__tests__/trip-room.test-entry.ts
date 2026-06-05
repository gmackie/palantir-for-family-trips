// Minimal worker entry for the TripRoom DO test harness. Re-exports only the
// Durable Object class (the `Env` import in trip-room.ts is type-only and is
// erased at runtime, so this does not pull in the vinext/otel app entry).
export { TripRoom } from "../trip-room";

// A no-op default fetch so the test worker is a valid module worker.
export default {
  fetch() {
    return new Response("trip-room test worker", { status: 200 });
  },
};

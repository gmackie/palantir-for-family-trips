// Minimal worker entry for the RateLimiter DO test harness. Re-exports only the
// Durable Object class.
export { RateLimiter } from "../rate-limiter";

// A no-op default fetch so the test worker is a valid module worker.
export default {
  fetch() {
    return new Response("rate-limiter test worker", { status: 200 });
  },
};

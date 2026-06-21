/**
 * A single van-system telemetry reading sourced from driftport.
 *
 * Mirrors driftport's `system.dashboard` row shape (one row per system+metric):
 * the latest value for a metric belonging to a van subsystem (power, climate,
 * water, solar). `readAt` is an ISO-8601 timestamp string.
 */
export type VanSystemReading = {
  /** Subsystem, e.g. "power", "climate", "water", "solar". */
  system: string;
  /** Metric within the subsystem, e.g. "battery_soc", "voltage". */
  metric: string;
  /** Numeric value of the reading. */
  value: number;
  /** Unit of the value, e.g. "%", "V", "W", "°F". */
  unit: string;
  /** ISO-8601 timestamp of when the reading was taken. */
  readAt: string;
};

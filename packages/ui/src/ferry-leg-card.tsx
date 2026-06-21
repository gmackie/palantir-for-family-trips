import { formatMoney } from "@sortey/validators/money";

/**
 * "Leave-by" gating attached to a ferry leg by the route planner. Mirrors the
 * planner's `AttachedFerry` shape: `leaveBy` is the deadline to depart the prior
 * stop, `nonDrivableMinutes` is crossing + arrival cutoff (does not consume the
 * driving budget). `null` when the planner could not compute a deadline.
 */
export interface FerryLeaveBy {
  leaveBy: Date | null;
  nonDrivableMinutes: number;
}

export interface FerryLegCardProps {
  operator?: string | null;
  departureTerminal?: string | null;
  arrivalTerminal?: string | null;
  /** Scheduled departure of the crossing. */
  scheduledDepartureAt?: Date | null;
  /** Crossing duration in minutes. */
  durationMinutes?: number | null;
  /** Total fare in integer minor units (cents). */
  fareCents?: number | null;
  /** ISO 4217 currency code; defaults to USD. */
  currency?: string;
  /** True if a vehicle space is reserved on the crossing. */
  vehicleReservation?: boolean;
  confirmationNumber?: string | null;
  /** Route-planner gating; `null` when no deadline could be computed. */
  ferry?: FerryLeaveBy | null;
  /** Renders skeleton placeholders instead of content. */
  loading?: boolean;
  className?: string;
}

const SURFACE = "#161B22";
const BORDER = "#21262D";
const TEXT = "#C9D1D9";
const MUTED = "#8B949E";
const WARNING = "#D29922";
const INFO = "#58A6FF";

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) {
    return `${m}m`;
  }
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function FerryLegCard({
  operator,
  departureTerminal,
  arrivalTerminal,
  scheduledDepartureAt,
  durationMinutes,
  fareCents,
  currency = "USD",
  vehicleReservation = false,
  confirmationNumber,
  ferry,
  loading = false,
  className,
}: FerryLegCardProps) {
  if (loading) {
    return (
      <div
        data-slot="ferry-leg-card"
        className={`w-full rounded-[4px] border p-4 ${className ?? ""}`}
        style={{ background: SURFACE, borderColor: BORDER }}
      >
        <div className="flex flex-col gap-3">
          <div
            className="h-3 w-24 animate-pulse rounded-[2px]"
            style={{ background: BORDER }}
          />
          <div
            className="h-4 w-48 animate-pulse rounded-[2px]"
            style={{ background: BORDER }}
          />
          <div
            className="h-3 w-32 animate-pulse rounded-[2px]"
            style={{ background: BORDER }}
          />
        </div>
      </div>
    );
  }

  const leaveBy = ferry?.leaveBy ?? null;

  return (
    <div
      data-slot="ferry-leg-card"
      className={`w-full rounded-[4px] border p-4 ${className ?? ""}`}
      style={{ background: SURFACE, borderColor: BORDER }}
    >
      {/* Header: operator + reservation badge */}
      <div className="flex items-start justify-between gap-2">
        <span
          className="inline-block rounded-[2px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: `${INFO}1a`, color: INFO }}
        >
          Ferry
        </span>
        {vehicleReservation && (
          <span
            className="inline-block rounded-[2px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ background: `${WARNING}1a`, color: WARNING }}
          >
            Vehicle reserved
          </span>
        )}
      </div>

      {operator && (
        <h3 className="mt-2 truncate text-sm font-bold" style={{ color: TEXT }}>
          {operator}
        </h3>
      )}

      {/* Terminals: Departure → Arrival */}
      <p className="mt-1 text-sm" style={{ color: TEXT }}>
        <span>{departureTerminal ?? "—"}</span>
        <span style={{ color: MUTED }}> → </span>
        <span>{arrivalTerminal ?? "—"}</span>
      </p>

      {/* Times: scheduled departure + leave-by (monospace, tabular) */}
      <dl className="mt-3 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: MUTED }}
          >
            Departs
          </dt>
          <dd
            className="font-mono text-sm tabular-nums"
            style={{ color: TEXT }}
          >
            {scheduledDepartureAt ? formatClock(scheduledDepartureAt) : "—:—"}
          </dd>
        </div>

        {leaveBy && (
          <div className="flex items-baseline justify-between gap-3">
            <dt
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: WARNING }}
            >
              Leave by
            </dt>
            <dd
              className="font-mono text-sm font-semibold tabular-nums"
              style={{ color: WARNING }}
            >
              {`Leave by ${formatClock(leaveBy)}`}
            </dd>
          </div>
        )}

        {typeof durationMinutes === "number" && (
          <div className="flex items-baseline justify-between gap-3">
            <dt
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              Crossing
            </dt>
            <dd
              className="font-mono text-sm tabular-nums"
              style={{ color: TEXT }}
            >
              {formatDuration(durationMinutes)}
            </dd>
          </div>
        )}

        {typeof fareCents === "number" && (
          <div className="flex items-baseline justify-between gap-3">
            <dt
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              Fare
            </dt>
            <dd
              className="font-mono text-sm tabular-nums"
              style={{ color: TEXT }}
            >
              {formatMoney(fareCents, currency)}
            </dd>
          </div>
        )}
      </dl>

      {confirmationNumber && (
        <p
          className="mt-3 border-t pt-2 text-[10px] uppercase tracking-wider"
          style={{ borderColor: BORDER, color: MUTED }}
        >
          Conf{" "}
          <span className="font-mono normal-case" style={{ color: TEXT }}>
            {confirmationNumber}
          </span>
        </p>
      )}
    </div>
  );
}

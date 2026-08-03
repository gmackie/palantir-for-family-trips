"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "~/trpc/react";

/**
 * Write affordances for a segment's lodging, transits, and transport groups.
 *
 * These procedures shipped and the page rendered `disabled` buttons beside
 * them — the whole write half of the feature was unreachable from either app
 * (found by `scripts/audit-orphans.ts`). The reads were fine, which is why it
 * went unnoticed: a lodging page that lists lodging looks like it works.
 *
 * Deliberately inline forms rather than dialogs: this page is a list of
 * segments, and a modal per segment is a worse fit than a form that opens in
 * place next to the thing it belongs to.
 */

const FIELD =
  "w-full rounded-[3px] border border-[#30363D] bg-[#0A0C10] px-2 py-1 text-sm text-[#C9D1D9] placeholder:text-[#484F58]";
const LABEL = "font-mono text-[10px] uppercase tracking-widest text-[#8B949E]";
const PRIMARY =
  "rounded-[3px] bg-[#58A6FF] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[#0A0C10] transition-colors hover:bg-[#79B8FF] disabled:opacity-50";
const GHOST =
  "rounded-[3px] border border-[#30363D] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#C9D1D9] transition-colors hover:bg-[#30363D]/40 disabled:opacity-50";

type Scope = { workspaceId: string; tripId: string; segmentId: string };

function useRefresh() {
  const router = useRouter();
  const qc = useQueryClient();
  // The page is a server component, so a refresh is what re-reads the lists.
  return () => {
    void qc.invalidateQueries();
    router.refresh();
  };
}

export function AddLodging(props: Scope) {
  const trpc = useTRPC();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const create = useMutation(
    trpc.lodging.createLodging.mutationOptions({
      onSuccess: () => {
        toast.success("Lodging added.");
        setOpen(false);
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!open) {
    return (
      <button type="button" className={GHOST} onClick={() => setOpen(true)}>
        Add lodging
      </button>
    );
  }

  return (
    <form
      className="mt-2 grid w-full gap-2 rounded-[4px] border border-[#30363D] bg-[#0D1117] p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const checkInAt = String(data.get("checkInAt") ?? "");
        const checkOutAt = String(data.get("checkOutAt") ?? "");
        if (!checkInAt || !checkOutAt) {
          toast.error("Check-in and check-out are both required.");
          return;
        }
        if (new Date(checkOutAt) <= new Date(checkInAt)) {
          // Caught here so the traveller sees it beside the field rather than
          // as a server error after the round trip.
          toast.error("Check-out must be after check-in.");
          return;
        }
        create.mutate({
          ...props,
          propertyName: String(data.get("propertyName") ?? "").trim(),
          address: String(data.get("address") ?? "").trim() || undefined,
          confirmationNumber:
            String(data.get("confirmationNumber") ?? "").trim() || undefined,
          checkInAt: new Date(checkInAt),
          checkOutAt: new Date(checkOutAt),
        });
      }}
    >
      <label className="sm:col-span-2">
        <span className={LABEL}>Property</span>
        <input name="propertyName" required maxLength={200} className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>Check in</span>
        <input
          name="checkInAt"
          type="datetime-local"
          required
          className={FIELD}
        />
      </label>
      <label>
        <span className={LABEL}>Check out</span>
        <input
          name="checkOutAt"
          type="datetime-local"
          required
          className={FIELD}
        />
      </label>
      <label>
        <span className={LABEL}>Address</span>
        <input name="address" className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>Confirmation</span>
        <input name="confirmationNumber" maxLength={100} className={FIELD} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={PRIMARY} disabled={create.isPending}>
          {create.isPending ? "Saving…" : "Save lodging"}
        </button>
        <button type="button" className={GHOST} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DeleteLodging(props: {
  workspaceId: string;
  tripId: string;
  lodgingId: string;
  propertyName: string;
}) {
  const trpc = useTRPC();
  const refresh = useRefresh();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation(
    trpc.lodging.deleteLodging.mutationOptions({
      onSuccess: () => {
        toast.success("Lodging removed.");
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  // Two-step rather than a browser confirm(): a dialog would block the whole
  // page, and this is a shared trip where someone else booked the room.
  if (!confirming) {
    return (
      <button
        type="button"
        className="font-mono text-[10px] uppercase tracking-wider text-[#8B949E] hover:text-[#F85149]"
        onClick={() => setConfirming(true)}
      >
        Remove
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={remove.isPending}
        className="font-mono text-[10px] uppercase tracking-wider text-[#F85149]"
        onClick={() =>
          remove.mutate({
            workspaceId: props.workspaceId,
            tripId: props.tripId,
            lodgingId: props.lodgingId,
          })
        }
      >
        Remove {props.propertyName}?
      </button>
      <button
        type="button"
        className="font-mono text-[10px] uppercase tracking-wider text-[#8B949E]"
        onClick={() => setConfirming(false)}
      >
        Keep
      </button>
    </span>
  );
}

export function AddTransit(
  props: Scope & { members: Array<{ userId: string; name: string }> },
) {
  const trpc = useTRPC();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const create = useMutation(
    trpc.lodging.createTransit.mutationOptions({
      onSuccess: () => {
        toast.success("Arrival added.");
        setOpen(false);
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!open) {
    return (
      <button type="button" className={GHOST} onClick={() => setOpen(true)}>
        Add transit
      </button>
    );
  }

  return (
    <form
      className="mt-2 grid w-full gap-2 rounded-[4px] border border-[#30363D] bg-[#0D1117] p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const scheduledAt = String(data.get("scheduledAt") ?? "");
        if (!scheduledAt) {
          toast.error("A scheduled time is required.");
          return;
        }
        create.mutate({
          ...props,
          userId: String(data.get("userId") ?? ""),
          direction: String(data.get("direction") ?? "arrival") as
            | "arrival"
            | "departure",
          transitType: String(data.get("transitType") ?? "flight") as "flight",
          carrier: String(data.get("carrier") ?? "").trim() || undefined,
          transitNumber:
            String(data.get("transitNumber") ?? "").trim() || undefined,
          departureStation:
            String(data.get("departureStation") ?? "").trim() || undefined,
          arrivalStation:
            String(data.get("arrivalStation") ?? "").trim() || undefined,
          scheduledAt: new Date(scheduledAt),
        });
      }}
    >
      <label>
        <span className={LABEL}>Traveller</span>
        <select name="userId" required className={FIELD}>
          {props.members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={LABEL}>Direction</span>
        <select name="direction" className={FIELD} defaultValue="arrival">
          <option value="arrival">Arrival</option>
          <option value="departure">Departure</option>
        </select>
      </label>
      <label>
        <span className={LABEL}>Type</span>
        <select name="transitType" className={FIELD} defaultValue="flight">
          <option value="flight">Flight</option>
          <option value="train">Train</option>
          <option value="bus">Bus</option>
          <option value="car">Car</option>
        </select>
      </label>
      <label>
        <span className={LABEL}>Scheduled</span>
        <input
          name="scheduledAt"
          type="datetime-local"
          required
          className={FIELD}
        />
      </label>
      <label>
        <span className={LABEL}>Carrier</span>
        <input name="carrier" maxLength={100} className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>Number</span>
        <input
          name="transitNumber"
          maxLength={50}
          placeholder="UA 1234"
          className={FIELD}
        />
      </label>
      <label>
        <span className={LABEL}>From</span>
        <input name="departureStation" maxLength={200} className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>To</span>
        <input name="arrivalStation" maxLength={200} className={FIELD} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={PRIMARY} disabled={create.isPending}>
          {create.isPending ? "Saving…" : "Save transit"}
        </button>
        <button type="button" className={GHOST} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AddTransportGroup(props: Scope) {
  const trpc = useTRPC();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const create = useMutation(
    trpc.lodging.createTransportGroup.mutationOptions({
      onSuccess: () => {
        toast.success("Transport group created.");
        setOpen(false);
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!open) {
    return (
      <button type="button" className={GHOST} onClick={() => setOpen(true)}>
        Add transport
      </button>
    );
  }

  return (
    <form
      className="mt-2 grid w-full gap-2 rounded-[4px] border border-[#30363D] bg-[#0D1117] p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        create.mutate({
          ...props,
          label: String(data.get("label") ?? "").trim(),
          transportType: String(data.get("mode") ?? "rideshare"),
          notes: String(data.get("notes") ?? "").trim() || undefined,
        } as never);
      }}
    >
      <label>
        <span className={LABEL}>Label</span>
        <input
          name="label"
          required
          maxLength={120}
          placeholder="Airport run, Friday"
          className={FIELD}
        />
      </label>
      <label>
        <span className={LABEL}>Mode</span>
        <select name="mode" className={FIELD} defaultValue="rideshare">
          <option value="rideshare">Rideshare</option>
          <option value="rental">Rental car</option>
          <option value="shuttle">Shuttle</option>
          <option value="transit">Public transit</option>
        </select>
      </label>
      <label className="sm:col-span-2">
        <span className={LABEL}>Notes</span>
        <input name="notes" className={FIELD} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={PRIMARY} disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create group"}
        </button>
        <button type="button" className={GHOST} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

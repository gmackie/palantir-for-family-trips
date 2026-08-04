"use client";

import { Button } from "@sortey/ui/button";
import { Input } from "@sortey/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "~/trpc/react";

/**
 * Edit one pin, holding the collaborative edit lock while the form is open.
 *
 * Pins could be created and deleted but never edited — `pins.update` had no
 * caller on any surface, and neither did the lock procedures guarding it. The
 * enforcement was already live: `pins.update` rejects a write when another
 * member holds an unexpired lock. So the machinery was complete and only the
 * form was missing.
 *
 * The lock is taken on open and released on save or cancel. It also carries a
 * server-side TTL (`editLockedUntil`), which is what makes this safe: a closed
 * tab or a dropped connection cannot strand a pin, because the lock expires on
 * its own. Release is a courtesy that returns the pin sooner — never the thing
 * correctness depends on.
 */
export function PinEditor(props: {
  workspaceId: string;
  tripId: string;
  pin: {
    id: string;
    title: string;
    notes?: string | null;
    lat: string;
    lng: string;
    attendeeUserIds?: string[];
  };
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const { pin } = props;
  const [title, setTitle] = useState(pin.title);
  const [notes, setNotes] = useState(pin.notes ?? "");
  const [locked, setLocked] = useState(false);
  const [attendees, setAttendees] = useState<string[]>(
    pin.attendeeUserIds ?? [],
  );
  const releasedRef = useRef(false);

  const scope = {
    workspaceId: props.workspaceId,
    tripId: props.tripId,
    pinId: pin.id,
  };

  const members = useQuery(
    trpc.trips.listMembers.queryOptions({
      workspaceId: props.workspaceId,
      tripId: props.tripId,
    }),
  );
  const saveAttendees = useMutation(
    trpc.pins.setAttendees.mutationOptions({
      onError: (error) => toast.error(error.message),
    }),
  );

  const acquire = useMutation(trpc.pins.acquireEditLock.mutationOptions({}));
  const release = useMutation(trpc.pins.releaseEditLock.mutationOptions({}));
  const update = useMutation(
    trpc.pins.update.mutationOptions({
      onSuccess: () => {
        toast.success("Pin updated.");
        finish();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  function finish() {
    // Guard against a double release: the effect cleanup also fires, and a
    // second call would take the lock somebody else may have just acquired.
    if (!releasedRef.current) {
      releasedRef.current = true;
      release.mutate(scope);
    }
    props.onClose();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: acquire once per pin
  useEffect(() => {
    let alive = true;
    acquire
      .mutateAsync(scope)
      .then(() => {
        if (alive) setLocked(true);
      })
      .catch((error: Error) => {
        // Somebody else is editing. Say so and close rather than presenting a
        // form whose save is guaranteed to be rejected.
        toast.error(error.message);
        props.onClose();
      });
    return () => {
      alive = false;
      if (!releasedRef.current) {
        releasedRef.current = true;
        release.mutate(scope);
      }
    };
  }, [pin.id]);

  if (!locked) {
    return (
      <p className="text-muted-foreground py-2 text-xs">Claiming the pin…</p>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border p-3">
      <Input
        value={title}
        placeholder="Title"
        onChange={(event) => setTitle(event.target.value)}
      />
      <Input
        value={notes}
        placeholder="Notes"
        onChange={(event) => setNotes(event.target.value)}
      />
      {(members.data ?? []).length > 0 && (
        <div className="space-y-1">
          <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
            Who is going
          </p>
          {(members.data ?? []).map((member) => (
            <label
              key={member.userId}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={attendees.includes(member.userId)}
                onChange={(event) =>
                  setAttendees((current) =>
                    event.target.checked
                      ? [...current, member.userId]
                      : current.filter((id) => id !== member.userId),
                  )
                }
              />
              {member.displayName ?? member.userId}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={update.isPending || title.trim().length === 0}
          onClick={() => {
            // Attendees live in their own table, so they save separately —
            // done first so a failure surfaces before the editor closes.
            saveAttendees.mutate({ ...scope, userIds: attendees });
            update.mutate({
              ...scope,
              title: title.trim(),
              // Empty clears the note; undefined would leave the old one and
              // read as a failed save.
              notes: notes.trim() || null,
            });
          }}
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={finish}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

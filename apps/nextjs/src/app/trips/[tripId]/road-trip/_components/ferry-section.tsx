"use client";

import type {
  FerryExtractedFields,
  FerryInputValues,
} from "@sortey/ui/ferry-input-form";
import { FerryInputForm } from "@sortey/ui/ferry-input-form";
import { FerryLegCard } from "@sortey/ui/ferry-leg-card";
import { toast } from "@sortey/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTRPC } from "~/trpc/react";

// Image MIME types the `ferries.extractFromImage` router accepts. Kept in sync
// with `ferryExtractInputSchema` server-side; narrowing here lets us drop a
// non-image file early with a clear message instead of round-tripping a reject.
const FERRY_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
type FerryImageMime = (typeof FERRY_IMAGE_MIME_TYPES)[number];

function isFerryImageMime(value: string): value is FerryImageMime {
  return (FERRY_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

const BORDER = "#21262D";
const SURFACE = "#0D1117";
const MUTED = "#8B949E";
const INFO = "#58A6FF";

/**
 * Read a `File` as base64 and strip the `data:<mime>;base64,` prefix so the API
 * receives the bare base64 payload its `imageBase64` input expects.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected file read result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Map the manual form's local datetime + cents values onto the shape
 * `ferries.create` expects (ISO-8601 offset datetime, `null`s for blanks).
 */
function toCreateInput(
  values: FerryInputValues,
  workspaceId: string,
  tripId: string,
) {
  const trimmed = (s: string) => {
    const t = s.trim();
    return t.length > 0 ? t : null;
  };
  return {
    workspaceId,
    tripId,
    operator: trimmed(values.operator),
    departureTerminal: trimmed(values.departureTerminal),
    arrivalTerminal: trimmed(values.arrivalTerminal),
    // `datetime-local` is wall-clock without zone; treat as local and emit an
    // offset-bearing ISO string so the `z.string().datetime({ offset: true })`
    // input on the router accepts it.
    scheduledDepartureAt:
      values.departureAt.length > 0
        ? new Date(values.departureAt).toISOString()
        : null,
    durationMinutes: values.durationMinutes,
    arrivalCutoffMinutes: values.arrivalCutoffMinutes,
    vehicleReservation: values.vehicleReservation,
    confirmationNumber: trimmed(values.confirmationNumber),
    fareCents: values.fareCents,
    currency: values.currency.toUpperCase(),
  };
}

export function FerrySection(props: { workspaceId: string; tripId: string }) {
  const { workspaceId, tripId } = props;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<FerryExtractedFields | null>(null);

  const listQuery = useQuery(
    trpc.ferries.listForTrip.queryOptions({ workspaceId, tripId }),
  );

  const extractMutation = useMutation(
    trpc.ferries.extractFromImage.mutationOptions(),
  );

  const createMutation = useMutation(
    trpc.ferries.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.ferries.pathFilter());
        setAdding(false);
        setExtracted(null);
        toast.success("Ferry added");
      },
      onError: () => {
        toast.error("Failed to add ferry");
      },
    }),
  );

  async function handleExtract(file: File) {
    if (!isFerryImageMime(file.type)) {
      toast.error("Couldn't read the ticket — enter manually");
      return;
    }
    const mimeType = file.type;
    setExtracting(true);
    try {
      const imageBase64 = await fileToBase64(file);
      const result = await extractMutation.mutateAsync({
        workspaceId,
        tripId,
        imageBase64,
        mimeType,
      });
      if (result.ok) {
        setExtracted({ ...result.booking });
      } else {
        toast.error("Couldn't read the ticket — enter manually");
      }
    } catch {
      toast.error("Couldn't read the ticket — enter manually");
    } finally {
      setExtracting(false);
    }
  }

  function handleSubmit(values: FerryInputValues) {
    createMutation.mutate(toCreateInput(values, workspaceId, tripId));
  }

  const crossings = listQuery.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          Ferries ({crossings.length})
        </h3>
        <button
          type="button"
          onClick={() => {
            setAdding((open) => !open);
            if (adding) setExtracted(null);
          }}
          className="rounded-[2px] border border-[#58A6FF]/30 bg-[#58A6FF]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#58A6FF] transition-colors hover:bg-[#58A6FF]/20"
          style={{ borderColor: `${INFO}4d` }}
        >
          {adding ? "Cancel" : "Add ferry"}
        </button>
      </div>

      {adding && (
        <FerryInputForm
          extracted={extracted}
          extracting={extracting}
          onExtract={(file) => void handleExtract(file)}
          onSubmit={handleSubmit}
        />
      )}

      {listQuery.isLoading ? (
        <div className="space-y-3">
          <FerryLegCard loading />
          <FerryLegCard loading />
        </div>
      ) : crossings.length > 0 ? (
        <div className="space-y-3">
          {crossings.map((c) => (
            <FerryLegCard
              key={c.id}
              operator={c.operator}
              departureTerminal={c.departureTerminal}
              arrivalTerminal={c.arrivalTerminal}
              scheduledDepartureAt={c.scheduledDepartureAt}
              durationMinutes={c.durationMinutes}
              fareCents={c.fareCents}
              currency={c.currency}
              vehicleReservation={c.vehicleReservation}
              confirmationNumber={c.confirmationNumber}
            />
          ))}
        </div>
      ) : (
        <p
          className="rounded-[2px] border px-3 py-4 text-center text-xs"
          style={{ background: SURFACE, borderColor: BORDER, color: MUTED }}
        >
          No ferry crossings yet.
        </p>
      )}
    </div>
  );
}

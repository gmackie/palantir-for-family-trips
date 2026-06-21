"use client";

import { useForm } from "@tanstack/react-form";
import { useEffect, useState } from "react";
import { Button } from "./button";
import { Field, FieldContent, FieldGroup, FieldLabel } from "./field";
import { Input } from "./input";

/**
 * Values collected by the manual ferry form. Times are local datetime-input
 * strings (`YYYY-MM-DDTHH:mm`); the parent converts to `Date`/cents before
 * calling `ferries.create`. Fare is entered as a decimal string and surfaced as
 * integer cents on submit.
 */
export interface FerryInputValues {
  operator: string;
  departureTerminal: string;
  arrivalTerminal: string;
  /** Local datetime-input string, e.g. "2026-07-09T14:05". */
  departureAt: string;
  durationMinutes: number | null;
  arrivalCutoffMinutes: number;
  fareCents: number | null;
  currency: string;
  vehicleReservation: boolean;
  confirmationNumber: string;
}

/**
 * Subset of fields the parent's `ferries.extractFromImage` returns. Passing a
 * fresh object pre-fills the manual fields for review before submit. `null`
 * fields are left as their current/default values.
 */
export interface FerryExtractedFields {
  operator?: string | null;
  departureTerminal?: string | null;
  arrivalTerminal?: string | null;
  /** ISO 8601 departure timestamp from OCR. */
  departureAt?: string | null;
  fareCents?: number | null;
  currency?: string | null;
  vehicleReservation?: boolean | null;
  confirmationNumber?: string | null;
}

export interface FerryInputFormProps {
  /** Pre-populate the form (e.g. when editing an existing crossing). */
  defaultValues?: Partial<FerryInputValues>;
  /**
   * Extracted fields from the parent's OCR call. When this changes to a
   * non-null value, the manual fields are pre-filled for review.
   */
  extracted?: FerryExtractedFields | null;
  /** True while the parent's `extractFromImage` call is in flight. */
  extracting?: boolean;
  /** Parent wires the actual `ferries.extractFromImage` tRPC call here. */
  onExtract?: (file: File) => void;
  /** Final submit; parent converts to the create-input shape and persists. */
  onSubmit: (values: FerryInputValues) => void;
  className?: string;
}

type Tab = "manual" | "scan";

const BORDER = "#21262D";
const MUTED = "#8B949E";
const INFO = "#58A6FF";

const EMPTY: FerryInputValues = {
  operator: "",
  departureTerminal: "",
  arrivalTerminal: "",
  departureAt: "",
  durationMinutes: null,
  arrivalCutoffMinutes: 30,
  fareCents: null,
  currency: "USD",
  vehicleReservation: false,
  confirmationNumber: "",
};

/** ISO 8601 (or partial) → `datetime-local` input value. */
function toDatetimeLocal(iso: string): string {
  // Trim seconds/zone for the input; keep "YYYY-MM-DDTHH:mm".
  return iso.slice(0, 16);
}

export function FerryInputForm({
  defaultValues,
  extracted,
  extracting = false,
  onExtract,
  onSubmit,
  className,
}: FerryInputFormProps) {
  const [tab, setTab] = useState<Tab>("manual");
  const [file, setFile] = useState<File | null>(null);

  const form = useForm({
    defaultValues: { ...EMPTY, ...defaultValues },
    onSubmit: ({ value }) => onSubmit(value),
  });

  // When the parent returns OCR fields, pre-fill the manual tab for review.
  useEffect(() => {
    if (!extracted) {
      return;
    }
    if (extracted.operator != null) {
      form.setFieldValue("operator", extracted.operator);
    }
    if (extracted.departureTerminal != null) {
      form.setFieldValue("departureTerminal", extracted.departureTerminal);
    }
    if (extracted.arrivalTerminal != null) {
      form.setFieldValue("arrivalTerminal", extracted.arrivalTerminal);
    }
    if (extracted.departureAt != null) {
      form.setFieldValue("departureAt", toDatetimeLocal(extracted.departureAt));
    }
    if (extracted.fareCents != null) {
      form.setFieldValue("fareCents", extracted.fareCents);
    }
    if (extracted.currency != null) {
      form.setFieldValue("currency", extracted.currency);
    }
    if (extracted.vehicleReservation != null) {
      form.setFieldValue("vehicleReservation", extracted.vehicleReservation);
    }
    if (extracted.confirmationNumber != null) {
      form.setFieldValue("confirmationNumber", extracted.confirmationNumber);
    }
    setTab("manual");
  }, [extracted, form]);

  return (
    <div
      data-slot="ferry-input-form"
      className={`w-full rounded-[4px] border p-4 ${className ?? ""}`}
      style={{ background: "#161B22", borderColor: BORDER }}
    >
      {/* Tabs */}
      <div
        role="tablist"
        className="flex border-b"
        style={{ borderColor: BORDER }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manual"}
          onClick={() => setTab("manual")}
          className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
          style={{
            color: tab === "manual" ? INFO : MUTED,
            borderBottom: `2px solid ${tab === "manual" ? INFO : "transparent"}`,
          }}
        >
          Manual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "scan"}
          onClick={() => setTab("scan")}
          className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
          style={{
            color: tab === "scan" ? INFO : MUTED,
            borderBottom: `2px solid ${tab === "scan" ? INFO : "transparent"}`,
          }}
        >
          Scan ticket
        </button>
      </div>

      {tab === "scan" ? (
        <div className="mt-4 flex flex-col gap-3">
          <Field>
            <FieldContent>
              <FieldLabel htmlFor="ferry-scan-file">
                Ferry booking image
              </FieldLabel>
            </FieldContent>
            <Input
              id="ferry-scan-file"
              type="file"
              accept="image/*"
              disabled={extracting}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Button
            type="button"
            disabled={!file || extracting}
            onClick={() => {
              if (file) {
                onExtract?.(file);
              }
            }}
          >
            {extracting ? "Extracting…" : "Extract"}
          </Button>
          <p className="text-xs" style={{ color: MUTED }}>
            Extracted fields pre-fill the Manual tab for review before saving.
          </p>
        </div>
      ) : (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field
              name="operator"
              children={(field) => (
                <Field>
                  <FieldContent>
                    <FieldLabel htmlFor={field.name}>Operator</FieldLabel>
                  </FieldContent>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Washington State Ferries"
                  />
                </Field>
              )}
            />

            <Field orientation="responsive">
              <form.Field
                name="departureTerminal"
                children={(field) => (
                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>
                        Departure terminal
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Edmonds"
                    />
                  </Field>
                )}
              />
              <form.Field
                name="arrivalTerminal"
                children={(field) => (
                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>
                        Arrival terminal
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Kingston"
                    />
                  </Field>
                )}
              />
            </Field>

            <form.Field
              name="departureAt"
              children={(field) => (
                <Field>
                  <FieldContent>
                    <FieldLabel htmlFor={field.name}>
                      Scheduled departure
                    </FieldLabel>
                  </FieldContent>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="datetime-local"
                    className="font-mono tabular-nums"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            />

            <Field orientation="responsive">
              <form.Field
                name="durationMinutes"
                children={(field) => (
                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>
                        Crossing duration (min)
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="number"
                      inputMode="numeric"
                      className="font-mono tabular-nums"
                      value={field.state.value ?? ""}
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                      placeholder="30"
                    />
                  </Field>
                )}
              />
              <form.Field
                name="arrivalCutoffMinutes"
                children={(field) => (
                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>
                        Arrival cutoff (min)
                      </FieldLabel>
                    </FieldContent>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="number"
                      inputMode="numeric"
                      className="font-mono tabular-nums"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(Number(e.target.value))
                      }
                      placeholder="30"
                    />
                  </Field>
                )}
              />
            </Field>

            <Field orientation="responsive">
              <form.Field
                name="fareCents"
                children={(field) => (
                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>Fare</FieldLabel>
                    </FieldContent>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      className="font-mono tabular-nums"
                      value={
                        field.state.value == null
                          ? ""
                          : (field.state.value / 100).toFixed(2)
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(
                          e.target.value === ""
                            ? null
                            : Math.round(Number(e.target.value) * 100),
                        )
                      }
                      placeholder="16.75"
                    />
                  </Field>
                )}
              />
              <form.Field
                name="currency"
                children={(field) => (
                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor={field.name}>Currency</FieldLabel>
                    </FieldContent>
                    <Input
                      id={field.name}
                      name={field.name}
                      maxLength={3}
                      className="font-mono uppercase"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(e.target.value.toUpperCase())
                      }
                      placeholder="USD"
                    />
                  </Field>
                )}
              />
            </Field>

            <form.Field
              name="confirmationNumber"
              children={(field) => (
                <Field>
                  <FieldContent>
                    <FieldLabel htmlFor={field.name}>
                      Confirmation number
                    </FieldLabel>
                  </FieldContent>
                  <Input
                    id={field.name}
                    name={field.name}
                    className="font-mono"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="WSF-12345"
                  />
                </Field>
              )}
            />

            <form.Field
              name="vehicleReservation"
              children={(field) => (
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor={field.name}>
                      Vehicle reservation
                    </FieldLabel>
                  </FieldContent>
                  <input
                    id={field.name}
                    name={field.name}
                    type="checkbox"
                    checked={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.checked)}
                    style={{ accentColor: INFO }}
                  />
                </Field>
              )}
            />
          </FieldGroup>

          <Button type="submit" className="mt-4 w-full">
            Save ferry
          </Button>
        </form>
      )}
    </div>
  );
}

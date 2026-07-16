"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "./button";

const BORDER = "#21262D";
const MUTED = "#8B949E";
const INFO = "#58A6FF";
const SUCCESS = "#3FB950";
const WARN = "#D29922";
const DANGER = "#F85149";
const SURFACE = "#0D1117";
const CARD = "#161B22";

/** Line items revealed as OCR completes (for progressive preview). */
export interface ReceiptUploadLineItem {
  name: string;
  quantity: number;
  lineTotalCents: number;
}

/** Extracted totals shown in the success / review state. */
export interface ReceiptUploadExtracted {
  merchant?: string;
  currency?: string;
  subtotalCents?: number;
  taxCents?: number;
  tipCents?: number;
  totalCents?: number;
  lineItems?: ReceiptUploadLineItem[];
  needsReview?: boolean;
  warnings?: string[];
}

export type ReceiptUploadStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "empty";

export interface ReceiptUploadProps {
  /** Controlled selected file (optional — parent can leave unmanaged). */
  file?: File | null;
  /** Preview URL for the selected / captured image. */
  previewUrl?: string | null;
  /** Current pipeline status. Defaults to idle. */
  status?: ReceiptUploadStatus;
  /** True while OCR is in flight (alias for status="loading"). */
  scanning?: boolean;
  /** Error message when status is "error". */
  error?: string | null;
  /** Short status note under the header (success / review guidance). */
  statusNote?: string | null;
  /** Extracted fields for progressive reveal after a successful scan. */
  extracted?: ReceiptUploadExtracted | null;
  /** Called when the user picks or drops an image. */
  onFileSelect: (file: File) => void;
  /** Optional clear / retake handler. */
  onClear?: () => void;
  disabled?: boolean;
  className?: string;
  /** Accept attribute for the file input. */
  accept?: string;
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Receipt capture surface for web: drag-drop, gallery pick, and rear-camera
 * capture. Parent owns OCR / storage; this component is presentation + file
 * selection only. Progressive OCR-pending skeleton reveals merchant → totals →
 * line items as `extracted` is populated.
 */
export function ReceiptUpload({
  file = null,
  previewUrl = null,
  status,
  scanning = false,
  error = null,
  statusNote = null,
  extracted = null,
  onFileSelect,
  onClear,
  disabled = false,
  className,
  accept = "image/*",
}: ReceiptUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const resolvedStatus: ReceiptUploadStatus =
    status ??
    (scanning
      ? "loading"
      : error
        ? "error"
        : extracted
          ? "success"
          : file || previewUrl
            ? "idle"
            : "empty");

  // Object URL for a controlled File when the parent doesn't pass previewUrl.
  useEffect(() => {
    if (previewUrl) {
      setLocalPreview(null);
      return;
    }
    if (!file) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, previewUrl]);

  const imageSrc = previewUrl ?? localPreview;
  const isBusy = resolvedStatus === "loading" || disabled;

  function pickFile(next: File | undefined | null) {
    if (!next || isBusy) return;
    if (!next.type.startsWith("image/")) return;
    onFileSelect(next);
  }

  const lineItems = extracted?.lineItems ?? [];
  const hasTotals =
    extracted &&
    (extracted.subtotalCents != null ||
      extracted.taxCents != null ||
      extracted.tipCents != null ||
      extracted.totalCents != null);

  return (
    <div
      data-slot="receipt-upload"
      className={`w-full rounded-[4px] border p-4 ${className ?? ""}`}
      style={{
        background: CARD,
        borderColor:
          resolvedStatus === "error"
            ? `${DANGER}55`
            : resolvedStatus === "loading"
              ? `${INFO}55`
              : resolvedStatus === "success"
                ? extracted?.needsReview
                  ? `${WARN}55`
                  : `${SUCCESS}40`
                : BORDER,
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p
            className="text-[10px] font-black uppercase tracking-[0.2em]"
            style={{
              color:
                resolvedStatus === "error"
                  ? DANGER
                  : resolvedStatus === "success" && extracted?.needsReview
                    ? WARN
                    : INFO,
            }}
          >
            {resolvedStatus === "loading"
              ? "Reading receipt"
              : resolvedStatus === "error"
                ? "Scan failed"
                : resolvedStatus === "success"
                  ? extracted?.needsReview
                    ? "Review required"
                    : "Receipt scanned"
                  : "Scan receipt"}
          </p>
          <p className="text-xs" style={{ color: MUTED }}>
            {statusNote ??
              (resolvedStatus === "loading"
                ? "Extracting merchant, amounts, tax, tip, and line items…"
                : resolvedStatus === "error"
                  ? (error ?? "Couldn't read the receipt — enter manually.")
                  : "Snap or upload a receipt to auto-fill merchant, amounts, and items.")}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {(file || imageSrc || extracted) && onClear ? (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={onClear}
            >
              Clear
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {resolvedStatus === "loading"
              ? "Scanning…"
              : file || imageSrc
                ? "Replace"
                : "Scan receipt"}
          </Button>
        </div>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        capture="environment"
        className="sr-only"
        disabled={isBusy}
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          // Allow re-selecting the same file.
          e.target.value = "";
        }}
      />

      {/* Drop zone / preview */}
      <label
        htmlFor={inputId}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!isBusy) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
        className="mt-4 flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed p-4 transition-colors"
        style={{
          borderColor: dragging ? INFO : BORDER,
          background: dragging ? `${INFO}10` : SURFACE,
          opacity: isBusy ? 0.7 : 1,
          pointerEvents: isBusy ? "none" : "auto",
        }}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt="Receipt preview"
            className="max-h-40 w-full rounded-[2px] object-contain"
          />
        ) : resolvedStatus === "loading" ? (
          <OcrPendingSkeleton />
        ) : (
          <>
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: MUTED }}
            >
              Drop image, or click to open camera / gallery
            </span>
            <span className="text-[11px]" style={{ color: MUTED }}>
              JPEG, PNG, WebP, GIF
            </span>
          </>
        )}
      </label>

      {/* Progressive extraction reveal */}
      {(resolvedStatus === "loading" || extracted) && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <RevealField
              label="Merchant"
              loading={resolvedStatus === "loading" && !extracted?.merchant}
              value={extracted?.merchant}
            />
            <RevealField
              label="Currency"
              loading={resolvedStatus === "loading" && !extracted?.currency}
              value={extracted?.currency}
              mono
            />
          </div>

          {(resolvedStatus === "loading" || hasTotals) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <RevealField
                label="Subtotal"
                loading={
                  resolvedStatus === "loading" &&
                  extracted?.subtotalCents == null
                }
                value={
                  extracted?.subtotalCents != null
                    ? `$${centsToDollars(extracted.subtotalCents)}`
                    : undefined
                }
                mono
              />
              <RevealField
                label="Tax"
                loading={
                  resolvedStatus === "loading" && extracted?.taxCents == null
                }
                value={
                  extracted?.taxCents != null
                    ? `$${centsToDollars(extracted.taxCents)}`
                    : undefined
                }
                mono
              />
              <RevealField
                label="Tip"
                loading={
                  resolvedStatus === "loading" && extracted?.tipCents == null
                }
                value={
                  extracted?.tipCents != null
                    ? `$${centsToDollars(extracted.tipCents)}`
                    : undefined
                }
                mono
              />
              <RevealField
                label="Total"
                loading={
                  resolvedStatus === "loading" && extracted?.totalCents == null
                }
                value={
                  extracted?.totalCents != null
                    ? `$${centsToDollars(extracted.totalCents)}`
                    : undefined
                }
                mono
              />
            </div>
          )}

          {(resolvedStatus === "loading" || lineItems.length > 0) && (
            <div
              className="rounded-[4px] border p-3"
              style={{ borderColor: BORDER, background: SURFACE }}
            >
              <p
                className="text-[10px] font-black uppercase tracking-[0.2em]"
                style={{ color: MUTED }}
              >
                {resolvedStatus === "loading" && lineItems.length === 0
                  ? "Line items…"
                  : `Line items (${lineItems.length})`}
              </p>
              {resolvedStatus === "loading" && lineItems.length === 0 ? (
                <div className="mt-2 space-y-2">
                  <SkeletonBar width="70%" />
                  <SkeletonBar width="55%" />
                  <SkeletonBar width="60%" />
                </div>
              ) : (
                <ul className="mt-2 space-y-1">
                  {lineItems.map((item, i) => (
                    <li
                      key={`${item.name}-${i}`}
                      className="flex justify-between text-xs"
                      style={{ color: "#C9D1D9" }}
                    >
                      <span className="truncate pr-2">
                        {item.quantity > 1 ? `${item.quantity}× ` : ""}
                        {item.name}
                      </span>
                      <span
                        className="tabular-nums"
                        style={{
                          color: MUTED,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        ${centsToDollars(item.lineTotalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {extracted?.currency &&
            extracted.currency.toUpperCase() !== "USD" && (
              <p
                className="rounded-[4px] border px-3 py-2 text-xs"
                style={{
                  borderColor: `${WARN}55`,
                  background: `${WARN}12`,
                  color: WARN,
                }}
              >
                This receipt appears to be in {extracted.currency.toUpperCase()}
                . Settlement only works within a single currency.
              </p>
            )}

          {extracted?.warnings && extracted.warnings.length > 0 && (
            <ul className="space-y-1">
              {extracted.warnings.map((w) => (
                <li key={w} className="text-xs" style={{ color: WARN }}>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RevealField({
  label,
  value,
  loading,
  mono,
}: {
  label: string;
  value?: string;
  loading?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className="rounded-[4px] border px-3 py-2"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <p
        className="text-[10px] font-black uppercase tracking-[0.16em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>
      {loading ? (
        <div className="mt-1.5">
          <SkeletonBar width="80%" />
        </div>
      ) : (
        <p
          className="mt-0.5 truncate text-sm"
          style={{
            color: "#C9D1D9",
            fontVariantNumeric: mono ? "tabular-nums" : undefined,
            fontFamily: mono
              ? "ui-monospace, SFMono-Regular, Menlo, monospace"
              : undefined,
          }}
        >
          {value && value.length > 0 ? value : "—"}
        </p>
      )}
    </div>
  );
}

function SkeletonBar({ width }: { width: string }) {
  return (
    <div
      className="h-3 animate-pulse rounded-[2px]"
      style={{ width, background: BORDER }}
    />
  );
}

function OcrPendingSkeleton() {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3 py-2">
      <div
        className="h-8 w-8 animate-pulse rounded-full"
        style={{ background: `${INFO}33` }}
      />
      <SkeletonBar width="50%" />
      <SkeletonBar width="70%" />
      <p className="text-[11px]" style={{ color: MUTED }}>
        Extracting line items, tax, and tip…
      </p>
    </div>
  );
}

"use client";

import { Button } from "@sortey/ui/button";
import { toast } from "@sortey/ui/toast";
import { useRef, useState } from "react";

interface ImportResult {
  imported: number;
  skipped: number;
  catCounts: Record<string, number>;
}

/**
 * Upload the user's OWN iOverlander CSV export. Licensing: iOverlander data
 * can't be redistributed, so each user brings their own copy — the backend
 * scopes every row to this workspace and de-dupes, so re-uploading is safe.
 */
export function PoiUpload({
  workspaceId,
  tripId,
}: {
  workspaceId: string;
  tripId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("workspaceId", workspaceId);
      form.append("tripId", tripId);
      const res = await fetch("/api/poi/ioverlander", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setResult(json);
      toast.success(`Imported ${json.imported.toLocaleString()} places`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const topCats = result
    ? Object.entries(result.catCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[#21262D] bg-[#0D1117] p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-[#8B949E]">
        Overnight parking (iOverlander)
      </div>
      <p className="text-sm text-[#8B949E]">
        Upload your own iOverlander CSV export to power legal overnight parking,
        water, dump &amp; propane stops on this trip. iOverlander data
        can&apos;t be shared between users, so bring your own copy — we scope it
        to your workspace and skip duplicates.{" "}
        <a
          href="https://www.ioverlander.com/countries/places_by_country"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#58A6FF] hover:underline"
        >
          Export from iOverlander →
        </a>
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Importing…" : "Upload iOverlander CSV"}
        </Button>
      </div>

      {result && (
        <div className="flex flex-col gap-2 border-t border-[#21262D] pt-3">
          <div className="font-mono text-xs text-[#3FB950]">
            ✅ {result.imported.toLocaleString()} places imported
            {result.skipped > 0
              ? ` · ${result.skipped.toLocaleString()} skipped (bad coords)`
              : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topCats.map(([cat, n]) => (
              <span
                key={cat}
                className="rounded-md border border-[#21262D] px-2 py-1 font-mono text-xs text-[#C9D1D9]"
              >
                {cat.replace(/_/g, " ")} · {n.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

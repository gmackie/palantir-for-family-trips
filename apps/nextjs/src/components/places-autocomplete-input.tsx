"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useRef } from "react";

declare global {
  // eslint-disable-next-line no-var
  var __placesLoaderConfigured: boolean | undefined;
}

export interface PlacesAutocompleteInputProps {
  name: string;
  label?: string;
  defaultValue?: string;
  defaultLat?: string;
  defaultLng?: string;
  placeholder?: string;
  required?: boolean;
  apiKey: string;
}

export function PlacesAutocompleteInput({
  name,
  label,
  defaultValue,
  defaultLat,
  defaultLng,
  placeholder,
  required,
  apiKey,
}: PlacesAutocompleteInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!apiKey || !containerRef.current) return;

    let cancelled = false;
    let element: google.maps.places.PlaceAutocompleteElement | null = null;

    async function init() {
      try {
        if (!globalThis.__placesLoaderConfigured) {
          setOptions({ key: apiKey });
          globalThis.__placesLoaderConfigured = true;
        }

        await importLibrary("places");
        if (cancelled || !containerRef.current) return;

        element = new google.maps.places.PlaceAutocompleteElement({
          includedPrimaryTypes: ["(cities)"],
        });

        element.name = name;
        element.placeholder = placeholder ?? "";
        element.noInputIcon = true;
        if (defaultValue) element.value = defaultValue;

        containerRef.current.appendChild(element);

        element.addEventListener("gmp-select", async (e) => {
          const place = e.placePrediction.toPlace();
          await place.fetchFields({
            fields: ["formattedAddress", "location"],
          });

          if (latRef.current && place.location)
            latRef.current.value = String(place.location.lat());
          if (lngRef.current && place.location)
            lngRef.current.value = String(place.location.lng());
        });
      } catch {
        // Silently fail — container stays empty, hidden inputs still work
      }
    }

    void init();

    return () => {
      cancelled = true;
      element?.remove();
    };
  }, [apiKey, name, placeholder, defaultValue]);

  return (
    <div className="space-y-1">
      {label && (
        <label className="text-[10px] font-black uppercase tracking-[0.15em] text-[#8B949E]">
          {label}
        </label>
      )}
      <div ref={containerRef} className="gmp-autocomplete-container">
        {/* Fallback for SSR / before JS loads */}
        <noscript>
          <input
            name={name}
            type="text"
            defaultValue={defaultValue}
            placeholder={placeholder}
            required={required}
            className="h-11 w-full rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 text-sm text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#58A6FF]"
          />
        </noscript>
      </div>
      <input
        ref={latRef}
        type="hidden"
        name={`${name}Lat`}
        defaultValue={defaultLat ?? ""}
      />
      <input
        ref={lngRef}
        type="hidden"
        name={`${name}Lng`}
        defaultValue={defaultLng ?? ""}
      />
    </div>
  );
}

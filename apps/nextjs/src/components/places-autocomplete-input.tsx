"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useRef } from "react";

/** Shared flag so setOptions is only called once per page load. */
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
  const inputRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    if (!apiKey || !inputRef.current) return;

    let cancelled = false;

    async function init() {
      try {
        if (!globalThis.__placesLoaderConfigured) {
          setOptions({ key: apiKey });
          globalThis.__placesLoaderConfigured = true;
        }

        const placesLib = (await importLibrary(
          "places",
        )) as google.maps.PlacesLibrary;

        if (cancelled || !inputRef.current) return;

        const autocomplete = new placesLib.Autocomplete(inputRef.current, {
          types: ["(cities)"],
          fields: ["formatted_address", "geometry", "name"],
        });

        autocompleteRef.current = autocomplete;

        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (!place.geometry?.location) return;

          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();

          if (latRef.current) latRef.current.value = String(lat);
          if (lngRef.current) lngRef.current.value = String(lng);

          // Update visible input with the formatted address
          if (inputRef.current) {
            inputRef.current.value =
              place.formatted_address ?? place.name ?? "";
          }
        });
      } catch {
        // Silently fail -- the input still works as a plain text field
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={name}
          className="text-[10px] font-black uppercase tracking-[0.15em] text-[#8B949E]"
        >
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={name}
        name={name}
        type="text"
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        className="h-11 w-full rounded-[2px] border border-[#21262D] bg-[#0D1117] px-3 text-sm text-[#C9D1D9] placeholder-[#484F58] outline-none focus:border-[#58A6FF]"
      />
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

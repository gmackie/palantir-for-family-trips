"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@sortey/ui/field";

import { PlacesAutocompleteInput } from "~/components/places-autocomplete-input";

export function DestinationPicker(props: {
  defaultValue?: string;
  googleMapsApiKey: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="destinationName">Destination</FieldLabel>
      <FieldContent>
        <PlacesAutocompleteInput
          name="destinationName"
          defaultValue={props.defaultValue}
          placeholder="Milan, Italy"
          required
          apiKey={props.googleMapsApiKey}
        />
        <FieldDescription>
          Start typing a city name to see autocomplete suggestions.
        </FieldDescription>
      </FieldContent>
    </Field>
  );
}

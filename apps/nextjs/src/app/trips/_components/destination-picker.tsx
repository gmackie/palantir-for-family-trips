import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@gmacko/ui/field";
import { Input } from "@gmacko/ui/input";

export function DestinationPicker(props: { defaultValue?: string }) {
  return (
    <Field>
      <FieldLabel htmlFor="destinationName">Destination</FieldLabel>
      <FieldContent>
        <Input
          id="destinationName"
          name="destinationName"
          defaultValue={props.defaultValue}
          placeholder="Milan, Italy"
          required
        />
        <FieldDescription>
          Start with a text destination so the trip can be created before the
          map tools land.
        </FieldDescription>
      </FieldContent>
    </Field>
  );
}

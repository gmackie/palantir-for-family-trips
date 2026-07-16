import { z } from "zod/v4";

const tripDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const coordinateStringSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(Number(v)), "Invalid coordinate")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const CreateTripFormSchema = z.object({
  destinationName: z.string().trim().min(1, "Destination is required"),
  destinationLat: coordinateStringSchema,
  destinationLng: coordinateStringSchema,
  endDate: tripDateSchema,
  groupMode: z.boolean().default(false),
  name: z.string().trim().min(1, "Trip name is required"),
  tripMode: z.enum(["destination", "roadtrip"]).default("destination"),
  startDate: tripDateSchema,
  tz: z.string().trim().min(1).default("UTC"),
});

export type CreateTripFormInput = z.infer<typeof CreateTripFormSchema>;

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Parse create-trip form fields.
 * groupMode accepts either radio values ("true"/"false") or a checkbox ("on").
 */
export function parseCreateTripFormData(
  formData: FormData,
): CreateTripFormInput {
  const groupModeRaw = readText(formData, "groupMode");
  const groupMode =
    groupModeRaw === "true" ||
    groupModeRaw === "on" ||
    groupModeRaw === "1" ||
    formData.get("groupMode") === "on";

  const parsed = CreateTripFormSchema.safeParse({
    name: readText(formData, "name"),
    tripMode: readText(formData, "tripMode") || "destination",
    destinationName: readText(formData, "destinationName"),
    destinationLat: readText(formData, "destinationNameLat") || undefined,
    destinationLng: readText(formData, "destinationNameLng") || undefined,
    startDate: readText(formData, "startDate") || undefined,
    endDate: readText(formData, "endDate") || undefined,
    tz: readText(formData, "tz") || "UTC",
    groupMode,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid trip form");
  }

  return parsed.data;
}

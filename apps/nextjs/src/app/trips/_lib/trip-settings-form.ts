import { z } from "zod/v4";

const tripDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const TripSettingsFormSchema = z.object({
  claimMode: z.enum(["organizer", "tap"]),
  destinationName: z.string().trim().min(1, "Destination is required"),
  endDate: tripDateSchema,
  groupMode: z.boolean().default(false),
  name: z.string().trim().min(1, "Trip name is required"),
  startDate: tripDateSchema,
  tz: z.string().trim().min(1).default("UTC"),
});

export type TripSettingsFormInput = z.infer<typeof TripSettingsFormSchema>;

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function parseTripSettingsFormData(
  formData: FormData,
): TripSettingsFormInput {
  const parsed = TripSettingsFormSchema.safeParse({
    name: readText(formData, "name"),
    destinationName: readText(formData, "destinationName"),
    startDate: readText(formData, "startDate") || undefined,
    endDate: readText(formData, "endDate") || undefined,
    tz: readText(formData, "tz") || "UTC",
    groupMode: formData.get("groupMode") === "on",
    claimMode: readText(formData, "claimMode") || "organizer",
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid trip settings");
  }

  return parsed.data;
}

import { z } from "zod/v4";

const tripDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const CreateTripFormSchema = z.object({
  destinationName: z.string().trim().min(1, "Destination is required"),
  endDate: tripDateSchema,
  name: z.string().trim().min(1, "Trip name is required"),
  startDate: tripDateSchema,
  tz: z.string().trim().min(1).default("UTC"),
});

export type CreateTripFormInput = z.infer<typeof CreateTripFormSchema>;

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function parseCreateTripFormData(
  formData: FormData,
): CreateTripFormInput {
  const parsed = CreateTripFormSchema.safeParse({
    name: readText(formData, "name"),
    destinationName: readText(formData, "destinationName"),
    startDate: readText(formData, "startDate") || undefined,
    endDate: readText(formData, "endDate") || undefined,
    tz: readText(formData, "tz") || "UTC",
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid trip form");
  }

  return parsed.data;
}

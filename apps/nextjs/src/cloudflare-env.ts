import { z } from "zod/v4";

export const cloudflareEnvSchema = z.object({
  APP_ENV: z
    .enum(["development", "staging", "production"])
    .default("production"),
});

export type CloudflareEnv = z.infer<typeof cloudflareEnvSchema>;

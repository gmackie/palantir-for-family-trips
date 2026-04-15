import { z } from "zod/v4";

export const cloudflareEnvSchema = z.object({
  APP_ENV: z
    .enum(["development", "staging", "production"])
    .default("production"),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  CLOUDFLARE_API_TOKEN: z.string().min(1),
});

export type CloudflareEnv = z.infer<typeof cloudflareEnvSchema>;

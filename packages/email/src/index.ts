declare const process: { env: Record<string, string | undefined> };

import { integrations } from "@sortey/config";
import { Resend } from "resend";

let resendClient: Resend | null = null;

export interface EmailConfig {
  apiKey: string;
  from: string;
}

export function initEmail(config: EmailConfig): Resend | null {
  if (!integrations.email.enabled) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(config.apiKey);
  }

  return resendClient;
}

export function getEmailClient(): Resend | null {
  if (!integrations.email.enabled) {
    return null;
  }
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      resendClient = new Resend(apiKey);
    }
  }
  return resendClient;
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
}

/**
 * Send an email
 */
export async function sendEmail(
  params: SendEmailParams,
  defaultFrom: string,
): Promise<{ id: string } | null> {
  const client = getEmailClient();
  if (!client) {
    console.log("[Email disabled] Cannot send email:", params.subject);
    return null;
  }

  const result = await client.emails.send({
    from: params.from ?? defaultFrom,
    to: params.to,
    subject: params.subject,
    html: params.html ?? "",
    text: params.text ?? "",
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return { id: result.data?.id ?? "" };
}

export { Resend };

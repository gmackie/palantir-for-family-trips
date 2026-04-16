import { type NextRequest, NextResponse } from "next/server";

import { devMagicLinkStore } from "~/auth/dev-magic-link";
import { auth } from "~/auth/server";

async function handleAutoLogin(request: NextRequest, email: string) {
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  devMagicLinkStore.clear();

  await auth.api.signInMagicLink({
    headers: request.headers,
    body: {
      email,
      callbackURL: "/trips",
    },
  });

  const magicLink = devMagicLinkStore.getLast()?.url;
  if (!magicLink) {
    return NextResponse.json(
      { error: "Magic link was not generated — email provider may not be configured" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(magicLink);
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  return handleAutoLogin(request, email);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  return handleAutoLogin(request, email);
}

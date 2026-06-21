import { type NextRequest, NextResponse } from "next/server";

import { assertDevAuthEnabled, devMagicLinkStore } from "~/auth/dev-magic-link";
import { auth } from "~/auth/server";
import { env } from "~/env";

async function handleAutoLogin(request: NextRequest, email: string) {
  // Development-only: never expose session creation / magic-link side effects
  // outside dev (matches /api/dev/last-magic-link). 404 to avoid advertising it.
  try {
    assertDevAuthEnabled(env.NODE_ENV);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
      {
        error:
          "Magic link was not generated — email provider may not be configured",
      },
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

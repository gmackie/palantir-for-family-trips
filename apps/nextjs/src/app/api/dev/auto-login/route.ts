import { NextResponse } from "next/server";
import { assertDevAuthEnabled, devMagicLinkStore } from "~/auth/dev-magic-link";
import { auth } from "~/auth/server";
import { env } from "~/env";

export async function POST(request: Request) {
  try {
    assertDevAuthEnabled(env.NODE_ENV);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    callbackURL?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const callbackURL =
    typeof body?.callbackURL === "string" && body.callbackURL.length > 0
      ? body.callbackURL
      : "/";

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  devMagicLinkStore.clear();

  await auth.api.signInMagicLink({
    headers: request.headers,
    body: {
      email,
      callbackURL,
    },
  });

  const magicLink = devMagicLinkStore.getLast()?.url;
  if (!magicLink) {
    return NextResponse.json(
      { error: "Magic link was not generated" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(magicLink);
}

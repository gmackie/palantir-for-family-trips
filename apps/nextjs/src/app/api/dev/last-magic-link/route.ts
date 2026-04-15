import { NextResponse } from "next/server";

import { assertDevAuthEnabled, devMagicLinkStore } from "~/auth/dev-magic-link";
import { env } from "~/env";

export async function GET() {
  try {
    assertDevAuthEnabled(env.NODE_ENV);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    url: devMagicLinkStore.getLast()?.url ?? null,
    email: devMagicLinkStore.getLast()?.email ?? null,
  });
}

# ForgeGraph Environment Manifest

Secrets to configure per stage via `forge secret set <key> <value>`.

## Required (all stages)

| Key | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://app:secret@postgres.internal:5432/trip` | Managed by ForgeGraph Postgres addon |
| `AUTH_SECRET` | `<random 64+ char string>` | Better Auth session signing. Generate with `openssl rand -base64 48` |
| `AUTH_DISCORD_ID` | `placeholder-for-magic-link-only` | Required by template auth config. Placeholder OK if only using magic links. |
| `AUTH_DISCORD_SECRET` | `placeholder-for-magic-link-only` | Same as above |

## Required for features

| Key | Feature | Notes |
|---|---|---|
| `RESEND_API_KEY` | Email (magic links, invites) | From resend.com. Domain must be verified. |
| `ANTHROPIC_API_KEY` | Receipt OCR | Claude Sonnet 4.6 vision. ~$0.01-0.04/receipt. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Map views | Restrict by HTTP referer in GCP console |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Styled maps | Optional, for custom map styling |
| `PUSHER_APP_ID` | Realtime claiming | From pusher.com |
| `PUSHER_KEY` | Realtime claiming | |
| `PUSHER_SECRET` | Realtime claiming | |
| `PUSHER_CLUSTER` | Realtime claiming | e.g. `us2` |
| `NEXT_PUBLIC_PUSHER_KEY` | Client-side realtime | Same as PUSHER_KEY |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Client-side realtime | Same as PUSHER_CLUSTER |

## Optional

| Key | Feature |
|---|---|
| `SENTRY_AUTH_TOKEN` | Error monitoring |
| `SENTRY_ORG` | Error monitoring |
| `NEXT_PUBLIC_SENTRY_DSN` | Client error reporting |
| `UPLOADTHING_TOKEN` | Production receipt storage (replaces local disk) |

## Secret rotation

1. Generate new value
2. `forge secret set <key> <new-value> --stage staging`
3. `forge deploy create staging --wait`
4. Verify staging works (sign in, upload receipt, etc.)
5. `forge secret set <key> <new-value> --stage production`
6. `forge deploy create production --wait`
7. Revoke old value at the provider (Resend, Anthropic, etc.)

## Staging smoke test

After first deploy:
1. Open staging URL
2. Sign in via magic link (check email delivery, not console)
3. Create a workspace + trip
4. Upload a receipt → verify OCR extracts line items
5. Claim items → verify realtime sync
6. Settle → verify Venmo deep-link renders
7. Check `forge logs trip staging --follow` for errors

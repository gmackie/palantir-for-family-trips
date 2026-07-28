# ForgeGraph Environment Manifest

Secrets to configure per stage via `forge secret set <key> <value>`.

## Required (all stages)

| Key | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://app:secret@postgres.internal:5432/trip` | Managed by ForgeGraph Postgres addon |
| `AUTH_SECRET` | `<random 64+ char string>` | Better Auth session signing. Generate with `openssl rand -base64 48` |
| `RESEND_API_KEY` | `re_...` | Email delivery for magic links and trip invites. Domain must be verified. |

## Required for features

| Key | Feature | Notes |
|---|---|---|
| `RESEND_API_KEY` | Email (magic links, invites) | From resend.com. Domain must be verified. |
| `ANTHROPIC_API_KEY` | Receipt OCR + Corridor Cast scripts | Claude Sonnet 4.6 (vision for receipts; text for episode scripts). ~$0.01-0.04/receipt; cast jobs fail at the script stage without it. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Map views | Restrict by HTTP referer in GCP console |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | Styled maps | Optional, for custom map styling |
| `PUSHER_APP_ID` | Realtime claiming | From pusher.com |
| `PUSHER_KEY` | Realtime claiming | |
| `PUSHER_SECRET` | Realtime claiming | |
| `PUSHER_CLUSTER` | Realtime claiming | e.g. `us2` |
| `NEXT_PUBLIC_PUSHER_KEY` | Client-side realtime | Same as PUSHER_KEY |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Client-side realtime | Same as PUSHER_CLUSTER |
| `ELEVENLABS_API_KEY` | Corridor Cast TTS | From elevenlabs.io. Voices Tonight's Episode; synthesis only starts after the script read gate. |

## Optional

| Key | Feature |
|---|---|
| `SENTRY_AUTH_TOKEN` | Error monitoring |
| `SENTRY_ORG` | Error monitoring |
| `NEXT_PUBLIC_SENTRY_DSN` | Client error reporting |
| `UPLOADTHING_TOKEN` | Production receipt storage (replaces local disk) |
| `ELEVENLABS_VOICE_ID_DEFAULT` | Corridor Cast narrator voice (falls back to a built-in voice id) |
| `ELEVENLABS_TTS_MODEL` | Corridor Cast TTS model override (default `eleven_turbo_v2_5`) |
| `CAST_SCRIPT_MODEL` | Corridor Cast script model override (default `claude-sonnet-4-6`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Optional Google sign-in |
| `AUTH_APPLE_ID` / `AUTH_APPLE_SECRET` | Optional Apple sign-in |

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

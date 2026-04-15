# Local Development

## Prerequisites

- Node.js 24+ (`nvm use` or `fnm use` — `.nvmrc` is in the repo root)
- pnpm 10+ (`corepack enable` activates it)
- Docker (for local Postgres)

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres
docker compose up -d postgres

# 3. Configure environment
cp .env.example .env
# Fill in required values:
#   DATABASE_URL (default works with docker-compose Postgres)
#   AUTH_SECRET (any random string for local dev)
#   AUTH_DISCORD_ID / AUTH_DISCORD_SECRET (placeholders OK if only using magic links)

# 4. Run doctor to verify
pnpm doctor

# 5. Run database migrations
pnpm db:migrate

# 6. Seed the database
pnpm db:seed

# 7. Start the dev server
pnpm dev:next
```

**Success indicator:** `http://localhost:3000` shows the template landing page. `http://localhost:3000/demo` shows the Palantir dashboard.

## DEV_MODE=local

Set `DEV_MODE=local` in `.env` to enable zero-cost local iteration:
- **Email**: magic links logged to console (no Resend API key needed)
- **Storage**: receipt images saved to `.data/receipts/` (no S3/UploadThing needed)
- **OCR**: `MockOCRProvider` reads canned JSON from `packages/api/src/ocr/__fixtures__/*.json` (no Anthropic API key needed)

## Common Commands

| Command | What it does |
|---|---|
| `pnpm dev:next` | Start Next.js dev server |
| `pnpm dev:mobile` | Start Expo dev server |
| `pnpm db:studio` | Open Drizzle Studio (DB browser) |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Seed dev data |
| `pnpm -F @gmacko/nextjs storybook` | Start Storybook on :6006 |
| `pnpm -F @gmacko/nextjs e2e` | Run Playwright e2e tests |
| `pnpm -F @gmacko/nextjs e2e --headed` | Run e2e tests with visible browser |
| `pnpm turbo run typecheck` | Typecheck all workspaces |
| `pnpm turbo run build` | Build all workspaces |
| `pnpm format:check` | Check formatting (Biome) |
| `pnpm doctor` | Verify environment setup |

## Env Vars Reference

### Required for basic dev
- `DATABASE_URL` — Postgres connection string
- `AUTH_SECRET` — Better Auth session secret
- `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` — placeholder values OK for magic-link-only dev

### Required for specific features (add when you reach that phase)
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `NEXT_PUBLIC_GOOGLE_MAP_ID` — Phase 5 (map)
- `ANTHROPIC_API_KEY` — Phase 3 (receipt OCR, unless using DEV_MODE=local)
- `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` — Phase 3 (realtime claiming)
- `RESEND_API_KEY` — Phase 7 (production email delivery)

### Dev bypass
- `DEV_MODE=local` — unified local dev toggle (see above)
- `SKIP_ENV_VALIDATION=1` — skip env validation for builds without all vars set
- `/api/dev/auto-login` — auto-creates a session for a given email (Phase 1, dev only)

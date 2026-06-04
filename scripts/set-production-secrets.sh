#!/bin/bash
# Sets wrangler secrets for the sortey.app production worker.
# Run from apps/nextjs/ or pass --config flag.
#
# Usage:
#   cd apps/nextjs
#   bash ../../scripts/set-production-secrets.sh
#
# Reads from .env in the repo root. Each secret is only set if
# the env var is non-empty AND passes a sanity check.
#
# NOTE: OAuth/Apple canonical values live in ForgeGraph secrets
# (GOOGLE_CLIENT_ID/SECRET, APPLE_*). This script only sets what is
# present in .env; missing keys are skipped (never overwritten with junk).

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

cd "$REPO_ROOT/apps/nextjs"

set_secret() {
  local key="$1"
  local value
  value=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
  # Strip surrounding quotes and leading/trailing whitespace.
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  value="$(printf '%s' "$value" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

  if [ -z "$value" ]; then
    echo "  Skip $key (not in .env)"
    return
  fi
  # Reject obvious CLI help/usage text — this is what corrupted the secrets
  # previously (wrangler's own --help output got piped into the secret).
  if printf '%s' "$value" | grep -qiE -- '--version|--help|Show version|\[boolean\]|Usage:'; then
    echo "  ✗ REFUSING $key — value looks like CLI help text, not a secret"
    return
  fi
  # printf (not echo) so no trailing newline is appended to the secret value.
  printf '%s' "$value" | npx wrangler secret put "$key" >/dev/null 2>&1
  echo "  Set $key (len=${#value})"
}

echo "Setting production secrets for sortey-app..."
echo ""

# Email
set_secret RESEND_API_KEY

# OCR
set_secret GOOGLE_AI_API_KEY

# Google OAuth
set_secret AUTH_GOOGLE_ID
set_secret AUTH_GOOGLE_SECRET

# Apple OAuth
set_secret AUTH_APPLE_ID
set_secret AUTH_APPLE_SECRET
set_secret AUTH_APPLE_BUNDLE_ID

echo ""
echo "Done. Current secrets:"
npx wrangler secret list

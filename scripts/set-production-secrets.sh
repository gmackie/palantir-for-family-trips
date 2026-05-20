#!/bin/bash
# Sets wrangler secrets for sortie.gmac.io production worker.
# Run from apps/nextjs/ or pass --config flag.
#
# Usage:
#   cd apps/nextjs
#   bash ../../scripts/set-production-secrets.sh
#
# Reads from .env in the repo root. Each secret is only set if
# the env var is non-empty.

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
  if [ -n "$value" ]; then
    echo "$value" | npx wrangler secret put "$key" 2>&1
    echo "  Set $key"
  else
    echo "  Skip $key (not in .env)"
  fi
}

echo "Setting production secrets for sortie-gmac-io..."
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

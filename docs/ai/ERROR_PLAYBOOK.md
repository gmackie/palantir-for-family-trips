# Error Playbook

What the user sees, what the developer sees, and how to recover.

## Contents

| Failure class | Phase | User-visible message | Log shape | Recoverable? |
|---|---|---|---|---|
| Magic link delivery failure | 1 | "Couldn't send the sign-in link. Try again." | `[auth] magic_link_send_failed: {email, error}` | Yes (retry) |
| Magic link expired | 1 | "This link has expired. Request a new one." | `[auth] magic_link_expired: {token}` | Yes (new link) |
| OCR timeout (Claude API) | 3 | "Receipt processing is taking longer than usual. You can enter details manually." | `[ocr] timeout: {expenseId, duration_ms}` | Yes (manual entry) |
| OCR rate limit (Claude 429) | 3 | "Too many receipts at once. Try again in a minute." | `[ocr] rate_limited: {retry_after_s}` | Yes (auto-retry) |
| OCR low confidence | 3 | "We couldn't read some fields clearly. Please review and correct." | `[ocr] low_confidence: {expenseId, confidence, fields}` | Yes (manual edit) |
| Storage upload failure | 3 | "Upload failed. Check your connection and try again." | `[storage] upload_failed: {error, size_bytes}` | Yes (retry) |
| Claim conflict (tap-to-claim) | 3 | "This item was also claimed by {name}. It's now shared between you." | `[claim] auto_shared: {lineItemId, userIds}` | N/A (auto-resolved) |
| Settlement double-submit | 4 | Silently deduped (idempotency key) | `[settlement] dedupe: {idempotencyKey}` | N/A (handled) |
| Google Maps load failure | 5 | "Map couldn't load. Check your API key." | `[maps] load_failed: {error}` | Yes (reload page) |
| Pin edit lock held | 5 | "Someone else is editing this pin. Try again in a few seconds." | `[pin] lock_held: {pinId, lockedBy, expiresIn_s}` | Yes (wait + retry) |
| Flight tracking unavailable | 2 | "Live tracking unavailable for this flight." | `[transit] tracking_unavailable: {carrier, number}` | No (manual update) |

## Adding new entries

When implementing a new failure path, add a row to this table with:
1. The user-visible toast/banner copy
2. The structured log line shape (for Sentry/Loki)
3. Whether it's recoverable and how

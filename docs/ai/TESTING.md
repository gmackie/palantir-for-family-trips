# Testing

## Frameworks

- **Unit tests**: Vitest (configured per-package, e.g., `packages/db/vitest.config.ts`, `packages/api/vitest.config.ts`)
- **E2E tests**: Playwright (configured in `apps/nextjs/playwright.config.ts`)
- **Component tests**: Storybook test-runner against built Storybook

## Running tests

### Unit tests (Vitest)

```bash
# All unit tests
pnpm -F @gmacko/api test

# Single test file
pnpm -F @gmacko/api test src/calc/expense-shares.test.ts

# Watch mode
pnpm -F @gmacko/api test --watch

# With coverage
pnpm -F @gmacko/api test --coverage
```

### E2E tests (Playwright)

```bash
# All e2e tests (headless)
pnpm -F @gmacko/nextjs e2e

# Single spec
pnpm -F @gmacko/nextjs e2e -g "create trip"

# With visible browser
pnpm -F @gmacko/nextjs e2e --headed

# Interactive UI mode (best for debugging)
pnpm -F @gmacko/nextjs e2e:ui

# Generate trace for debugging
pnpm -F @gmacko/nextjs e2e --trace on
# Open trace: npx playwright show-trace test-results/<test>/trace.zip
```

### Storybook

```bash
# Dev mode
pnpm -F @gmacko/nextjs storybook

# Build for CI
pnpm -F @gmacko/nextjs storybook:build
```

## Claude API Mocking

For tests that would call the Anthropic API (receipt OCR):

```typescript
// Use MockOCRProvider in tests
// packages/api/src/ocr/mock-provider.ts reads from:
// packages/api/src/ocr/__fixtures__/*.json
// keyed by image hash

// To run with live OCR (costs money):
// RUN_LIVE_OCR=1 pnpm -F @gmacko/api test
```

TODO: Add `vi.mock` recipe for `@anthropic-ai/sdk` after Phase 3.

## Magic Link Testing

For Playwright tests that need authentication:

```typescript
// In dev, use the auto-login bypass:
// POST /api/dev/auto-login?email=test@example.com
// Returns a session cookie without sending an email
```

TODO: Add Playwright helper after Phase 1.

## Multi-user Testing

For tap-to-claim and realtime scenarios:

```typescript
// Use browser.newContext() for the second user
const userA = await browser.newContext();
const userB = await browser.newContext();
// Both interact with the same expense
```

TODO: Add full recipe after Phase 3.

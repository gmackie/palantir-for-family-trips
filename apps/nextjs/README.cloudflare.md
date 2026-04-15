# Cloudflare Workers Lane

This app now includes an experimental `vinext` lane for Cloudflare Workers.

## Commands

```bash
cd apps/nextjs
pnpm with-env wrangler deploy

pnpm --filter @gmacko/nextjs dev:vinext
pnpm --filter @gmacko/nextjs build:vinext
pnpm --filter @gmacko/nextjs deploy:cloudflare:staging
pnpm --filter @gmacko/nextjs deploy:cloudflare:production
```

## Auth

- Default local path: run `pnpm dlx wrangler login` once and reuse the OAuth session.
- Optional CI/non-interactive path: provide `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

## Domain

- The intended production custom domain is `trip.gmac.io`.
- The Worker config lives in `apps/nextjs/wrangler.jsonc`.
- `wrangler deploy` now uses that config directly, including the `trip.gmac.io` custom-domain route and the vinext build hook.

## Notes

- This lane is experimental and should not replace the default ForgeGraph + Nix path by accident.
- `build:vinext` prebuilds the Next app's workspace dependencies before invoking `vinext`.

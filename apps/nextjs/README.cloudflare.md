# Cloudflare Workers Lane

This app now includes an experimental `vinext` lane for Cloudflare Workers.

## Commands

```bash
pnpm --filter @gmacko/nextjs dev:vinext
pnpm --filter @gmacko/nextjs build:vinext
pnpm --filter @gmacko/nextjs deploy:cloudflare:staging
pnpm --filter @gmacko/nextjs deploy:cloudflare:production
```

## Required Env

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Domain

- The intended production custom domain is `trip.gmac.io`.
- The Worker config lives in `apps/nextjs/wrangler.jsonc`.
- Attach the custom domain in Cloudflare once the first Worker deploy succeeds.

## Notes

- This lane is experimental and should not replace the default ForgeGraph + Nix path by accident.
- `build:vinext` prebuilds the Next app's workspace dependencies before invoking `vinext`.

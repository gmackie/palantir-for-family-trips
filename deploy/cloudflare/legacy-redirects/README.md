# Legacy host redirects

`sortie.gmac.io` (Worker `sortie-gmac-io`) and `trip.gmac.io` (Worker `trip-gmac-io`) served
pre-rebrand builds of this app. Both Workers now run `worker.js`, which redirects every request
to the same path and query on `https://sortey.app` (301 for GET/HEAD, 308 for other methods).

This directory is outside the pnpm workspace on purpose: it has no dependencies.

```sh
npx wrangler deploy -c deploy/cloudflare/legacy-redirects/wrangler.sortie.jsonc
npx wrangler deploy -c deploy/cloudflare/legacy-redirects/wrangler.trip.jsonc
node --test deploy/cloudflare/legacy-redirects/worker.test.js
```

The deploy also clears the old `sortie-gmac-io` five-minute cron; `sortey-app` runs the same cron.
Rollback: `npx wrangler rollback <version-id> --name <worker>` using the version IDs on SORTEY-31.

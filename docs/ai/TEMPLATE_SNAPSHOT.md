# Template Snapshot

Adopted from `../create-gmacko-app` on 2026-04-15.

## Upstream SHA

```
ffa23059355857e042f90f2977ac05b4bdea39c0
```

## What was inherited

Everything in the template tree:
- `apps/nextjs`, `apps/expo`, `apps/tanstack-start`
- `packages/*` (26 packages)
- `tooling/*` (typescript, tailwind, vitest, github, openapi-generator)
- Root config: `turbo.json`, `pnpm-workspace.yaml`, `biome.json`, `lefthook.yml`, `docker-compose.yml`, `Dockerfile`, `.github/workflows/*`
- `.claude/skills/*` (gstack suite + project skills)

## What was overridden

- `DESIGN.md` — our Palantir design system (replaces template default)
- `LICENSE` — our license
- `CLAUDE.md` — appended project-specific architecture decisions
- `docs/ai/*` — our planning artifacts
- `docs/screenshots/*` — our dashboard screenshots

## Sync procedure

To pull updates from the upstream template:
1. `git -C ../create-gmacko-app log --oneline -5` — check what's new
2. `rsync -a --exclude='.git' --exclude='node_modules' --exclude='.turbo' --exclude='dist' --exclude='.next' --dry-run ../create-gmacko-app/ ./` — preview changes
3. Review the diff carefully. Our overrides (DESIGN.md, CLAUDE.md, docs/) should NOT be overwritten.
4. Apply: remove `--dry-run` from the rsync
5. `pnpm install && pnpm turbo run build` — verify
6. Update this file with the new SHA

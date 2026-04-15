# Cookbook

Worked examples for common tasks in this monorepo. Follow these patterns exactly — they match the template conventions.

## Contents

1. [Adding a tRPC router](#1-adding-a-trpc-router)
2. [Adding a Drizzle table](#2-adding-a-drizzle-table)
3. [Adding a shadcn primitive](#3-adding-a-shadcn-primitive)
4. [Writing a Storybook story](#4-writing-a-storybook-story)
5. [Using the trip auth guard](#5-using-the-trip-auth-guard)

---

## 1. Adding a tRPC router

TODO: Fill in after Phase 2 establishes the guard pattern. Will include:
- File location: `packages/api/src/router/<name>.ts`
- Root registration in `packages/api/src/root.ts`
- Procedure with `protectedProcedure` / `workspaceProcedure` / `tripProcedure`
- Calling from RSC (`apps/nextjs/src/trpc/server.tsx`)
- Calling from client component (`apps/nextjs/src/trpc/react.tsx`)

## 2. Adding a Drizzle table

TODO: Fill in after Phase 2. Will include:
- File location: `packages/db/src/schema.ts`
- Functional `pgTable` syntax: `pgTable("name", (t) => ({ ... }))`
- `drizzle-zod` integration: `createInsertSchema`
- Migration: `pnpm db:generate && pnpm db:migrate`
- Seed: `packages/db/src/seed.ts`

## 3. Adding a shadcn primitive

```bash
pnpm -F @gmacko/ui ui-add <name>
# e.g., pnpm -F @gmacko/ui ui-add tabs
```

After adding:
1. Add barrel export in `packages/ui/src/index.ts`
2. Add subpath export in `packages/ui/package.json`:
   ```json
   "./tabs": "./src/tabs.tsx"
   ```

## 4. Writing a Storybook story

Stories live next to components in `packages/ui/src/`. Convention:

```tsx
// packages/ui/src/my-component.stories.tsx
import { MyComponent } from "./my-component";

const meta = {
  title: "Dashboard/MyComponent",
  component: MyComponent,
  tags: ["autodocs"],
  args: {
    // default prop values
  },
};

export default meta;

export const Default = {};

export const Empty = {
  args: { items: [] },
};

export const Loading = {
  args: { loading: true },
};
```

Run Storybook: `pnpm -F @gmacko/nextjs storybook`

## 5. Using the trip auth guard

TODO: Fill in after Phase 2 establishes the `tripProcedure` middleware chain. Will include:
- `protectedProcedure` → `workspaceProcedure(wsId)` → `tripProcedure(tripId)`
- How to access `ctx.workspaceId`, `ctx.tripId`, `ctx.tripRole`
- Example: a trip-scoped query
- Example: an organizer-only mutation

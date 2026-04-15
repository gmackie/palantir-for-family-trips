# Claude Code Instructions

Read [`AGENTS.md`](./AGENTS.md) first for the shared repo conventions used by Codex, Claude Code, and OpenCode.

## gstack

- Use the vendored gstack suite in `.claude/skills/gstack` for Claude Code slash commands.
- Use `.claude/skills/create-gmacko-app-workflow` for template-specific repo conventions before making structural assumptions.
- Use `/browse` for web browsing and browser QA. Do not use `mcp__claude-in-chrome__*`.
- Available gstack commands in this repo include `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/retro`, `/debug`, and `/document-release`.
- If the gstack commands are missing or stale, run `cd .claude/skills/gstack && ./setup`.

## Claude-Specific Workflow

1. Use `superpowers:brainstorming` to turn the raw product idea into a first-pass proposal in `docs/ai/INITIAL_PROPOSAL.md`.
2. Run `/plan-ceo-review` to sharpen the problem statement, audience, and scope before implementation starts.
3. Run `/plan-eng-review` to turn the approved proposal into the implementation plan in `docs/ai/IMPLEMENTATION_PLAN.md`.
4. Run `/design-consultation` to establish the design philosophy for the app and write `DESIGN.md`.

If the repo was scaffolded with the optional SaaS bootstrap pack, run that flow after `pnpm bootstrap:local`:

1. `/office-hours`
2. `/autoplan` if available from your user-level gstack install
3. `/design-consultation`
4. the generated [`docs/ai/BOOTSTRAP_PLAYBOOK.md`](./docs/ai/BOOTSTRAP_PLAYBOOK.md), which splits guidance into `Claude-only`, `Codex`, and `OpenCode` sections and adds feature-aware follow-ups for the selected SaaS layers
5. the local follow-up skills in `.claude/skills/bootstrap-saas`, `.claude/skills/launch-landing-page`, `.claude/skills/setup-stripe-billing`, `.claude/skills/bootstrap-expo-app`, and `.claude/skills/test-mobile-with-maestro`

## UI Workflow

- Use Storybook for isolated UI work with `pnpm --filter @gmacko/nextjs storybook`.
- Add or update stories in `packages/ui/src/**/*.stories.tsx` when shared components change.

## Project: Group Trip Command Center

### Design System
Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

### Planning Artifacts
- `docs/ai/INITIAL_PROPOSAL.md` — product proposal
- `docs/ai/IMPLEMENTATION_PLAN.md` — phased execution plan (source of truth for all phases)
- `docs/ai/AUTOPLAN_REVIEW.md` — /autoplan review findings and decisions
- `docs/ai/TEMPLATE_SNAPSHOT_SHA.txt` — upstream template commit

### Architecture Decisions (settled)
- **Workspace ⊃ Trip ⊃ Segments**: Workspace = long-lived group, Trip = bounded event, Segment = one stop
- **Auth guards**: tRPC middleware chain (`protectedProcedure → workspaceProcedure → tripProcedure`), NOT helper functions
- **Both apps**: `apps/nextjs` (dashboard) + `apps/expo` (mobile capture), shared tRPC backend
- **Realtime**: `@gmacko/realtime` (Pusher) for tap-to-claim, polling as fallback
- **Storage**: Extend `@gmacko/storage`, do NOT create parallel storage code
- **Currency**: Stored per expense, settlement refuses mixed currencies

### Development Rules
- Maintain high information density in the Palantir dashboard aesthetic
- Use semantic colors strictly for status
- Ensure all numerical data uses monospace fonts for alignment
- Keep the UI responsive but optimized for large dashboard displays
- Every `segmentId` on expenses and pins is NOT nullable — segments all the way down
- Trip lifecycle: planning → confirmed → active → completed

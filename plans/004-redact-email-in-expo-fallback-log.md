# Plan 004: Stop logging user email addresses in the expo session fallback path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ba3457d..HEAD -- packages/api/src/trpc.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (log-line change only)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ba3457d`, 2026-06-12

## Why this matters

The expo session-fallback path in the tRPC context logs the authenticated
user's email address in plaintext on every hit. That writes PII into
production logs (Cloudflare Workers logs and anything aggregating them), which
is unnecessary — the user id identifies the session just as well for
debugging and is not PII of the same sensitivity.

## Current state

Relevant file:

- `packages/api/src/trpc.ts` — tRPC context creation; the expo fallback
  session validation logs the email at line 143.

The code as it exists today (`trpc.ts:135-150`):

```ts
      const [userRow] = await db
        .select()
        .from(user)
        .where(eq(user.id, sessionRow.userId))
        .limit(1);

      if (!userRow) continue;

      console.log(`[expo-fallback] session valid for ${userRow.email}`);
      return {
        user: {
          id: userRow.id,
          ...
```

Note the `return` object legitimately includes the email (the app needs it in
the session context) — only the `console.log` line is the problem.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `pnpm -F @sortey/api typecheck`  | exit 0, no errors   |
| Tests     | `pnpm -F @sortey/api test`       | all pass            |
| Lint      | `pnpm -F @sortey/api lint`       | exit 0              |

## Scope

**In scope** (the only file you should modify):
- `packages/api/src/trpc.ts` (log lines in the expo-fallback block only)

**Out of scope** (do NOT touch, even though they look related):
- The session context return shape — the email there is consumed by the apps.
- The fallback auth mechanism itself.
- Other `console.log` calls outside the expo-fallback block.

## Git workflow

- Branch off the current branch; name like `advisor/004-redact-email-log`.
- Commit style: conventional commits, e.g.
  `fix(api): log user id instead of email in expo session fallback`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the email with the user id in the log line

Change line 143 to:

```ts
      console.log(`[expo-fallback] session valid for user ${userRow.id}`);
```

### Step 2: Sweep the surrounding block for other PII logs

Run `grep -n "expo-fallback" packages/api/src/trpc.ts` and inspect every hit:
any other log in that block interpolating `email`, `name`, or a token value
gets the same treatment (id only). Do not touch logs outside this block.

**Verify**: `grep -n "userRow.email" packages/api/src/trpc.ts` → matches only
inside the returned session object, none inside a `console.log`/template
string passed to a logger.

### Step 3: Gate

**Verify**: `pnpm -F @sortey/api typecheck` → exit 0;
`pnpm -F @sortey/api test` → all pass; `pnpm -F @sortey/api lint` → exit 0.

## Test plan

No new tests: this is a log-string change with no behavioral surface to
assert. The done-criteria grep is the regression check.

## Done criteria

- [ ] `grep -n "console.log" packages/api/src/trpc.ts` shows no line interpolating an email address
- [ ] `pnpm -F @sortey/api typecheck` exits 0
- [ ] `pnpm -F @sortey/api test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `trpc.ts:143` doesn't match the excerpt (drift).
- You find a log line writing a session **token** value (not just email) —
  that is a more serious finding; report it rather than silently fixing.

## Maintenance notes

- Convention going forward: log user **ids**, never emails/names/tokens. A
  future structured-logging pass (`@sortey/logging` exists in the workspace)
  could enforce this centrally; deferred.

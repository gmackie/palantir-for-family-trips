import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { UserRole } from "./auth-schema";
import type { TenancyMode } from "./schema";

export interface DatabaseSessionContext {
  tenancyMode: TenancyMode;
  userId: string;
  userEmail?: string | null;
  workspaceId?: string | null;
  platformRole?: UserRole | null;
}

type SessionExecutor = {
  execute(query: SQL): Promise<unknown>;
};

type TransactionCapable<TTx extends SessionExecutor = SessionExecutor> = {
  transaction<T>(callback: (tx: TTx) => Promise<T>): Promise<T>;
};

export function getDatabaseSessionSettings(
  context: DatabaseSessionContext,
): Record<string, string> {
  return {
    "app.platform_role": context.platformRole ?? "user",
    "app.tenancy_mode": context.tenancyMode,
    "app.user_email": context.userEmail ?? "",
    "app.user_id": context.userId,
    "app.workspace_id": context.workspaceId ?? "",
  };
}

export function buildEnableRlsStatement(tableName: string): string {
  return `alter table "${tableName}" enable row level security;`;
}

function buildWorkspaceScopedReadPredicate(input: {
  tableName: string;
  workspaceColumn?: string;
  membershipTable?: string;
}) {
  const workspaceColumn = input.workspaceColumn ?? "workspace_id";
  const membershipTable = input.membershipTable ?? "workspace_membership";

  return `exists (
  select 1
  from "${membershipTable}" membership
  where membership.workspace_id = "${input.tableName}"."${workspaceColumn}"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
)`;
}

function buildWorkspaceScopedMutationPredicate(input: {
  tableName: string;
  workspaceColumn?: string;
  membershipTable?: string;
}) {
  const workspaceColumn = input.workspaceColumn ?? "workspace_id";
  const membershipTable = input.membershipTable ?? "workspace_membership";

  return `exists (
  select 1
  from "${membershipTable}" membership
  where membership.workspace_id = "${input.tableName}"."${workspaceColumn}"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
)`;
}

export function buildWorkspaceSelectPolicyStatement(input: {
  tableName: string;
  policyName: string;
  workspaceColumn?: string;
  membershipTable?: string;
  additionalReadPredicate?: string;
}): string {
  const readPredicate = buildWorkspaceScopedReadPredicate(input);
  const combinedReadPredicate = input.additionalReadPredicate
    ? `(${readPredicate})
  or (${input.additionalReadPredicate})`
    : readPredicate;

  return `create policy "${input.policyName}" on "${input.tableName}"
for select
using (${combinedReadPredicate});`;
}

export function buildWorkspaceMutationPolicyStatements(input: {
  tableName: string;
  policyPrefix: string;
  workspaceColumn?: string;
  membershipTable?: string;
}): string[] {
  const mutationPredicate = buildWorkspaceScopedMutationPredicate(input);

  return [
    `create policy "${input.policyPrefix}_insert" on "${input.tableName}"
for insert
with check (${mutationPredicate});`,
    `create policy "${input.policyPrefix}_update" on "${input.tableName}"
for update
using (${mutationPredicate})
with check (${mutationPredicate});`,
    `create policy "${input.policyPrefix}_delete" on "${input.tableName}"
for delete
using (${mutationPredicate});`,
  ];
}

export function buildWorkspaceBootstrapInsertPolicyStatement(input: {
  tableName: "workspace";
  policyName: string;
}) {
  return `create policy "${input.policyName}" on "${input.tableName}"
for insert
with check (
  not exists (select 1 from "workspace")
  and current_setting('app.workspace_id', true) = ''
  and "${input.tableName}"."owner_user_id" = current_setting('app.user_id', true)
);`;
}

export function buildWorkspaceMembershipBootstrapInsertPolicyStatement(input: {
  policyName: string;
}) {
  return `create policy "${input.policyName}" on "workspace_membership"
for insert
with check (
  current_setting('app.workspace_id', true) = ''
  and "workspace_membership"."user_id" = current_setting('app.user_id', true)
  and exists (
    select 1
    from "workspace" bootstrap_workspace
    where bootstrap_workspace.id = "workspace_membership"."workspace_id"
      and bootstrap_workspace.owner_user_id = current_setting('app.user_id', true)
  )
  and not exists (
    select 1
    from "workspace_membership" existing_membership
    where existing_membership.workspace_id = "workspace_membership"."workspace_id"
  )
);`;
}

export function buildWorkspaceMembershipInviteAcceptInsertPolicyStatement(input: {
  policyName: string;
}) {
  return `create policy "${input.policyName}" on "workspace_membership"
for insert
with check (
  current_setting('app.workspace_id', true) = ''
  and "workspace_membership"."user_id" = current_setting('app.user_id', true)
  and exists (
    select 1
    from "workspace_invite_allowlist" invite
    where invite.workspace_id = "workspace_membership"."workspace_id"
      and invite.email = current_setting('app.user_email', true)
      and invite.role = "workspace_membership"."role"
  )
);`;
}

/**
 * Mobile/web onboarding: settings.joinDefaultWorkspace inserts the caller as a
 * member of application_settings.initial_workspace_id. No same-table subquery.
 */
export function buildWorkspaceMembershipDefaultJoinInsertPolicyStatement(input: {
  policyName: string;
}) {
  return `create policy "${input.policyName}" on "workspace_membership"
for insert
with check (
  "workspace_membership"."user_id" = current_setting('app.user_id', true)
  and exists (
    select 1
    from "application_settings" settings
    where settings.initial_workspace_id is not null
      and settings.initial_workspace_id = "workspace_membership"."workspace_id"
  )
);`;
}

export function buildApplicationSettingsPublicReadPolicyStatement(input: {
  policyName: string;
}) {
  return `create policy "${input.policyName}" on "application_settings"
for select
using (
  coalesce(current_setting('app.user_id', true), '') = ''
  or coalesce(current_setting('app.user_id', true), '') <> ''
);`;
}

export function buildApplicationSettingsAdminMutationPolicyStatements(input: {
  policyPrefix: string;
}) {
  const adminPredicate = `current_setting('app.platform_role', true) = 'admin'`;

  return [
    `create policy "${input.policyPrefix}_insert" on "application_settings"
for insert
with check (${adminPredicate});`,
    `create policy "${input.policyPrefix}_update" on "application_settings"
for update
using (${adminPredicate})
with check (${adminPredicate});`,
    `create policy "${input.policyPrefix}_delete" on "application_settings"
for delete
using (${adminPredicate});`,
  ];
}

export function buildWorkspacePublicBootstrapSelectPolicyStatement(input: {
  policyName: string;
}) {
  return `create policy "${input.policyName}" on "workspace"
for select
using (
  coalesce(current_setting('app.user_id', true), '') = ''
  and not exists (
    select 1
    from "application_settings" bootstrap_settings
    where bootstrap_settings.setup_completed_at is not null
  )
);`;
}

export function buildWorkspaceInviteAccessPolicyStatements(): string[] {
  const readPredicate = `${buildWorkspaceScopedReadPredicate({
    tableName: "workspace_invite_allowlist",
  })}
  or "workspace_invite_allowlist"."email" = current_setting('app.user_email', true)`;
  const mutationPredicate = buildWorkspaceScopedMutationPredicate({
    tableName: "workspace_invite_allowlist",
  });
  const deletePredicate = `(${mutationPredicate})
  or "workspace_invite_allowlist"."email" = current_setting('app.user_email', true)`;

  return [
    `create policy "workspace_invite_allowlist_workspace_select" on "workspace_invite_allowlist"
for select
using (${readPredicate});`,
    `create policy "workspace_invite_allowlist_workspace_insert" on "workspace_invite_allowlist"
for insert
with check (${mutationPredicate});`,
    `create policy "workspace_invite_allowlist_workspace_update" on "workspace_invite_allowlist"
for update
using (${mutationPredicate})
with check (${mutationPredicate});`,
    `create policy "workspace_invite_allowlist_workspace_delete" on "workspace_invite_allowlist"
for delete
using (${deletePredicate});`,
  ];
}

// --- D1 (SQLite) migration note --------------------------------------------
// Cloudflare D1 is SQLite: it has NO row-level security, no `set_config`/session
// GUCs, and no interactive multi-statement transactions. The Postgres RLS
// session-context machinery below is therefore inert on D1 — attempting the
// `set_config(...)` calls (or wrapping them in `database.transaction(...)`)
// throws "no such function: set_config" / a D1 transaction error and would 500
// every authenticated request.
//
// On D1, tenant isolation relies on the APPLICATION-LEVEL authorization checks
// in the routers/guards (workspace + trip membership lookups), not DB-layer RLS.
// The policy-builder helpers above are retained unchanged for the Postgres
// deployment path and the RLS unit tests. See the D1 migration report.
const IS_D1 = true;

export async function applyDatabaseSessionContext(
  executor: SessionExecutor,
  context: DatabaseSessionContext,
): Promise<void> {
  if (IS_D1) {
    // No-op on D1/SQLite — session GUCs do not exist.
    return;
  }

  const settings = getDatabaseSessionSettings(context);

  for (const [key, value] of Object.entries(settings)) {
    await executor.execute(sql`select set_config(${key}, ${value}, true)`);
  }
}

export async function withDatabaseSessionContext<
  TTx extends SessionExecutor,
  TResult,
>(
  database: TransactionCapable<TTx>,
  context: DatabaseSessionContext,
  callback: (tx: TTx) => Promise<TResult>,
): Promise<TResult> {
  if (IS_D1) {
    // No transaction / no set_config on D1; run the callback against the base
    // database. App-level authorization still enforces tenant boundaries.
    return callback(database as unknown as TTx);
  }

  return database.transaction(async (tx) => {
    await applyDatabaseSessionContext(tx, context);
    return callback(tx);
  });
}

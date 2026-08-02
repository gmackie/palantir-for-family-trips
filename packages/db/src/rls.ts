import { sql } from "drizzle-orm";

import {
  buildApplicationSettingsAdminMutationPolicyStatements,
  buildApplicationSettingsPublicReadPolicyStatement,
  buildEnableRlsStatement,
  buildWorkspaceBootstrapInsertPolicyStatement,
  buildWorkspaceInviteAccessPolicyStatements,
  buildWorkspaceMembershipBootstrapInsertPolicyStatement,
  buildWorkspaceMembershipDefaultJoinInsertPolicyStatement,
  buildWorkspaceMembershipInviteAcceptInsertPolicyStatement,
  buildWorkspaceMutationPolicyStatements,
  buildWorkspacePublicBootstrapSelectPolicyStatement,
  buildWorkspaceSelectPolicyStatement,
} from "./tenant";

export const workspaceRlsTargets = [
  { tableName: "workspace", workspaceColumn: "id" },
  { tableName: "workspace_membership", workspaceColumn: "workspace_id" },
  {
    tableName: "workspace_invite_allowlist",
    workspaceColumn: "workspace_id",
  },
  { tableName: "workspace_subscription", workspaceColumn: "workspace_id" },
  { tableName: "workspace_usage_rollup", workspaceColumn: "workspace_id" },
  { tableName: "trip", workspaceColumn: "workspace_id" },
] as const;

/**
 * Trip child tables reference `trip_id` and inherit workspace scope from their
 * parent trip row. The policy predicate joins through `trip` to check workspace
 * membership.
 */
export const tripChildRlsTargets = [
  { tableName: "trip_segment", tripColumn: "trip_id" },
  { tableName: "trip_member", tripColumn: "trip_id" },
  { tableName: "trip_member_state", tripColumn: "trip_id" },
  { tableName: "trip_invite", tripColumn: "trip_id" },
  { tableName: "segment_member", parentTable: "trip_segment" },
  // Expenses live on trips (not segments directly for the join, but they
  // have trip_id set so the standard trip-join works).
  { tableName: "expense", tripColumn: "trip_id" },
  // Later trip-domain tables (owned by trip_app in prod).
  { tableName: "journey_stop", tripColumn: "trip_id" },
  { tableName: "trip_message", tripColumn: "trip_id" },
  { tableName: "ferry_crossing", tripColumn: "trip_id" },
  { tableName: "fuel_log", tripColumn: "trip_id" },
  { tableName: "gps_track_point", tripColumn: "trip_id" },
  { tableName: "trip_share", tripColumn: "trip_id" },
  { tableName: "trip_anchor", tripColumn: "trip_id" },
  { tableName: "trip_day", tripColumn: "trip_id" },
  { tableName: "van_state_reading", tripColumn: "trip_id" },
  { tableName: "member_location", tripColumn: "trip_id" },
  { tableName: "cast_episode_job", tripColumn: "trip_id" },
  { tableName: "cast_episode", tripColumn: "trip_id" },
  { tableName: "cast_grounding_brief", tripColumn: "trip_id" },
] as const;

/**
 * Tables that reference an expense and inherit workspace scope by joining
 * expense → trip → workspace.
 */
export const expenseChildRlsTargets = [
  { tableName: "receipt_image", expenseColumn: "expense_id" },
  { tableName: "line_item", expenseColumn: "expense_id" },
  { tableName: "line_item_claim", parentTable: "line_item" },
] as const;

function buildTripChildReadPredicate(input: {
  tableName: string;
  tripColumn?: string;
  parentTable?: string;
}) {
  if (input.parentTable === "trip_segment") {
    return `exists (
  select 1
  from "trip_segment" segment
  join "trip" trip on trip.id = segment.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where segment.id = "${input.tableName}"."segment_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
)`;
  }

  const tripColumn = input.tripColumn ?? "trip_id";
  return `exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "${input.tableName}"."${tripColumn}"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
)`;
}

function buildTripChildMutationPredicate(input: {
  tableName: string;
  tripColumn?: string;
  parentTable?: string;
}) {
  if (input.parentTable === "trip_segment") {
    return `exists (
  select 1
  from "trip_segment" segment
  join "trip" trip on trip.id = segment.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where segment.id = "${input.tableName}"."segment_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
)`;
  }

  const tripColumn = input.tripColumn ?? "trip_id";
  return `exists (
  select 1
  from "trip" trip
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where trip.id = "${input.tableName}"."${tripColumn}"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
)`;
}

function buildTripChildPolicyStatements(target: {
  tableName: string;
  tripColumn?: string;
  parentTable?: string;
}) {
  const readPredicate = buildTripChildReadPredicate(target);
  const mutationPredicate = buildTripChildMutationPredicate(target);
  const selectPolicyName = `${target.tableName}_workspace_select`;
  const insertPolicyName = `${target.tableName}_workspace_insert`;
  const updatePolicyName = `${target.tableName}_workspace_update`;
  const deletePolicyName = `${target.tableName}_workspace_delete`;

  return [
    buildEnableRlsStatement(target.tableName),
    buildForceRlsStatement(target.tableName),
    buildDropPolicyStatement(target.tableName, selectPolicyName),
    buildDropPolicyStatement(target.tableName, insertPolicyName),
    buildDropPolicyStatement(target.tableName, updatePolicyName),
    buildDropPolicyStatement(target.tableName, deletePolicyName),
    `create policy "${selectPolicyName}" on "${target.tableName}"
for select
using (${readPredicate});`,
    `create policy "${insertPolicyName}" on "${target.tableName}"
for insert
with check (${mutationPredicate});`,
    `create policy "${updatePolicyName}" on "${target.tableName}"
for update
using (${mutationPredicate})
with check (${mutationPredicate});`,
    `create policy "${deletePolicyName}" on "${target.tableName}"
for delete
using (${mutationPredicate});`,
  ];
}

/**
 * Expense-child tables (receipt_image, line_item, line_item_claim) inherit
 * workspace scope by joining through expense → trip → workspace_membership.
 * line_item_claim chains: claim → line_item → expense → trip → workspace.
 */
function buildExpenseChildReadPredicate(input: {
  tableName: string;
  expenseColumn?: string;
  parentTable?: string;
}) {
  if (input.parentTable === "line_item") {
    return `exists (
  select 1
  from "line_item" li
  join "expense" expense on expense.id = li.expense_id
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where li.id = "${input.tableName}"."line_item_id"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
)`;
  }

  const expenseColumn = input.expenseColumn ?? "expense_id";
  return `exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "${input.tableName}"."${expenseColumn}"
    and membership.user_id = current_setting('app.user_id', true)
    and (
      current_setting('app.workspace_id', true) = ''
      or membership.workspace_id::text = current_setting('app.workspace_id', true)
    )
)`;
}

function buildExpenseChildMutationPredicate(input: {
  tableName: string;
  expenseColumn?: string;
  parentTable?: string;
}) {
  if (input.parentTable === "line_item") {
    return `exists (
  select 1
  from "line_item" li
  join "expense" expense on expense.id = li.expense_id
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where li.id = "${input.tableName}"."line_item_id"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
)`;
  }

  const expenseColumn = input.expenseColumn ?? "expense_id";
  return `exists (
  select 1
  from "expense" expense
  join "trip" trip on trip.id = expense.trip_id
  join "workspace_membership" membership on membership.workspace_id = trip.workspace_id
  where expense.id = "${input.tableName}"."${expenseColumn}"
    and membership.user_id = current_setting('app.user_id', true)
    and current_setting('app.workspace_id', true) <> ''
    and membership.workspace_id::text = current_setting('app.workspace_id', true)
)`;
}

function buildExpenseChildPolicyStatements(target: {
  tableName: string;
  expenseColumn?: string;
  parentTable?: string;
}) {
  const readPredicate = buildExpenseChildReadPredicate(target);
  const mutationPredicate = buildExpenseChildMutationPredicate(target);
  const selectPolicyName = `${target.tableName}_workspace_select`;
  const insertPolicyName = `${target.tableName}_workspace_insert`;
  const updatePolicyName = `${target.tableName}_workspace_update`;
  const deletePolicyName = `${target.tableName}_workspace_delete`;

  return [
    buildEnableRlsStatement(target.tableName),
    buildForceRlsStatement(target.tableName),
    buildDropPolicyStatement(target.tableName, selectPolicyName),
    buildDropPolicyStatement(target.tableName, insertPolicyName),
    buildDropPolicyStatement(target.tableName, updatePolicyName),
    buildDropPolicyStatement(target.tableName, deletePolicyName),
    `create policy "${selectPolicyName}" on "${target.tableName}"
for select
using (${readPredicate});`,
    `create policy "${insertPolicyName}" on "${target.tableName}"
for insert
with check (${mutationPredicate});`,
    `create policy "${updatePolicyName}" on "${target.tableName}"
for update
using (${mutationPredicate})
with check (${mutationPredicate});`,
    `create policy "${deletePolicyName}" on "${target.tableName}"
for delete
using (${mutationPredicate});`,
  ];
}

type SqlExecutor = {
  execute(statement: unknown): Promise<unknown>;
};

function buildForceRlsStatement(tableName: string) {
  return `alter table "${tableName}" force row level security;`;
}

function buildDropPolicyStatement(tableName: string, policyName: string) {
  return `drop policy if exists "${policyName}" on "${tableName}";`;
}

/**
 * Non-recursive policies for workspace_membership.
 *
 * Under FORCE RLS, any policy predicate that re-queries `workspace_membership`
 * re-enters policy evaluation and Postgres raises 42P17 ("infinite recursion
 * detected in policy for relation workspace_membership"). That includes the
 * tempting "peer workspace" pattern:
 *
 *   workspace_id IN (SELECT workspace_id FROM workspace_membership WHERE user_id = …)
 *
 * Own-row predicates are the only safe inline form: they never re-scan the
 * table. App queries that need membership already filter by the session
 * `user_id` (list my workspaces, resolve access). Peer-member listing and
 * admin role changes must go through SECURITY DEFINER helpers (or BYPASSRLS)
 * if/when needed — never through same-table policy subqueries.
 *
 * Other tables' policies may still JOIN `workspace_membership` for "is the
 * current user a member of this workspace?" — those subqueries only need the
 * caller's own rows, which this select policy allows.
 */
export function buildWorkspaceMembershipPolicyStatements(): string[] {
  const tableName = "workspace_membership";
  const selectName = `${tableName}_workspace_select`;
  const insertName = `${tableName}_workspace_insert`;
  const updateName = `${tableName}_workspace_update`;
  const deleteName = `${tableName}_workspace_delete`;
  const bootstrapName = `${tableName}_bootstrap_insert`;
  const inviteAcceptName = `${tableName}_invite_accept_insert`;
  const defaultJoinName = `${tableName}_default_join_insert`;

  // Direct column compares only — no subquery against workspace_membership.
  const ownRow = `"${tableName}"."user_id" = current_setting('app.user_id', true)`;
  const platformAdmin = `current_setting('app.platform_role', true) = 'admin'`;
  const ownOrAdmin = `(${ownRow}) or (${platformAdmin})`;

  return [
    buildEnableRlsStatement(tableName),
    buildForceRlsStatement(tableName),
    buildDropPolicyStatement(tableName, selectName),
    buildDropPolicyStatement(tableName, insertName),
    buildDropPolicyStatement(tableName, updateName),
    buildDropPolicyStatement(tableName, deleteName),
    buildDropPolicyStatement(tableName, bootstrapName),
    buildDropPolicyStatement(tableName, inviteAcceptName),
    buildDropPolicyStatement(tableName, defaultJoinName),
    `create policy "${selectName}" on "${tableName}"
for select
using (${ownOrAdmin});`,
    // Generic insert disabled — only bootstrap / invite-accept / default-join.
    // Keep a drop for the old generic insert name so re-apply is clean.
    `create policy "${updateName}" on "${tableName}"
for update
using (${ownOrAdmin})
with check (${ownOrAdmin});`,
    `create policy "${deleteName}" on "${tableName}"
for delete
using (${ownOrAdmin});`,
    buildWorkspaceMembershipBootstrapInsertPolicyStatement({
      policyName: bootstrapName,
    }),
    buildWorkspaceMembershipInviteAcceptInsertPolicyStatement({
      policyName: inviteAcceptName,
    }),
    buildWorkspaceMembershipDefaultJoinInsertPolicyStatement({
      policyName: defaultJoinName,
    }),
  ];
}

export function buildWorkspaceRlsStatements() {
  const workspaceStatements = workspaceRlsTargets.flatMap((target) => {
    if (target.tableName === "workspace_membership") {
      return buildWorkspaceMembershipPolicyStatements();
    }

    const selectPolicyName = `${target.tableName}_workspace_select`;
    const mutationPolicyPrefix = `${target.tableName}_workspace`;
    const mutationPolicyNames = [
      `${mutationPolicyPrefix}_insert`,
      `${mutationPolicyPrefix}_update`,
      `${mutationPolicyPrefix}_delete`,
    ];
    const tableStatements = [
      buildEnableRlsStatement(target.tableName),
      buildForceRlsStatement(target.tableName),
      buildDropPolicyStatement(target.tableName, selectPolicyName),
      ...mutationPolicyNames.map((policyName) =>
        buildDropPolicyStatement(target.tableName, policyName),
      ),
      buildWorkspaceSelectPolicyStatement({
        tableName: target.tableName,
        policyName: selectPolicyName,
        workspaceColumn: target.workspaceColumn,
      }),
      ...buildWorkspaceMutationPolicyStatements({
        tableName: target.tableName,
        policyPrefix: mutationPolicyPrefix,
        workspaceColumn: target.workspaceColumn,
      }),
    ];

    if (target.tableName === "workspace") {
      const bootstrapPolicyName = "workspace_bootstrap_insert";
      const publicBootstrapSelectPolicyName =
        "workspace_public_bootstrap_select";
      return [
        ...tableStatements,
        buildDropPolicyStatement(target.tableName, bootstrapPolicyName),
        buildDropPolicyStatement(
          target.tableName,
          publicBootstrapSelectPolicyName,
        ),
        buildWorkspaceBootstrapInsertPolicyStatement({
          tableName: "workspace",
          policyName: bootstrapPolicyName,
        }),
        buildWorkspacePublicBootstrapSelectPolicyStatement({
          policyName: publicBootstrapSelectPolicyName,
        }),
      ];
    }

    if (target.tableName === "workspace_invite_allowlist") {
      const policyNames = [
        "workspace_invite_allowlist_workspace_select",
        "workspace_invite_allowlist_workspace_insert",
        "workspace_invite_allowlist_workspace_update",
        "workspace_invite_allowlist_workspace_delete",
      ];

      return [
        buildEnableRlsStatement(target.tableName),
        buildForceRlsStatement(target.tableName),
        ...policyNames.map((policyName) =>
          buildDropPolicyStatement(target.tableName, policyName),
        ),
        ...buildWorkspaceInviteAccessPolicyStatements(),
      ];
    }

    return tableStatements;
  });

  const tripChildStatements = tripChildRlsTargets.flatMap((target) =>
    buildTripChildPolicyStatements(target),
  );

  const expenseChildStatements = expenseChildRlsTargets.flatMap((target) =>
    buildExpenseChildPolicyStatements(target),
  );

  const applicationSettingsPolicyPrefix = "application_settings_platform_admin";

  return [
    ...workspaceStatements,
    ...tripChildStatements,
    ...expenseChildStatements,
    buildEnableRlsStatement("application_settings"),
    buildForceRlsStatement("application_settings"),
    buildDropPolicyStatement(
      "application_settings",
      "application_settings_public_read",
    ),
    buildDropPolicyStatement(
      "application_settings",
      `${applicationSettingsPolicyPrefix}_insert`,
    ),
    buildDropPolicyStatement(
      "application_settings",
      `${applicationSettingsPolicyPrefix}_update`,
    ),
    buildDropPolicyStatement(
      "application_settings",
      `${applicationSettingsPolicyPrefix}_delete`,
    ),
    buildApplicationSettingsPublicReadPolicyStatement({
      policyName: "application_settings_public_read",
    }),
    ...buildApplicationSettingsAdminMutationPolicyStatements({
      policyPrefix: applicationSettingsPolicyPrefix,
    }),
  ];
}

export type ApplyWorkspaceRlsResult = {
  applied: number;
  skipped: number;
  errors: Array<{ statement: string; message: string }>;
};

function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  let cur: unknown = error;
  // Walk cause chain (Drizzle wraps PostgresError as cause).
  for (let i = 0; i < 4; i++) {
    if (
      typeof cur === "object" &&
      cur &&
      "cause" in cur &&
      (cur as { cause: unknown }).cause
    ) {
      cur = (cur as { cause: unknown }).cause;
      if (cur instanceof Error) parts.push(cur.message);
      else if (typeof cur === "object" && cur && "message" in cur) {
        parts.push(String((cur as { message: unknown }).message));
      }
      continue;
    }
    break;
  }
  return parts.join(" | ");
}

/**
 * Apply all workspace/trip RLS statements. Continues past ownership /
 * insufficient-privilege errors (e.g. tables still owned by `postgres`) so a
 * partial apply still lands policies on tables the app role owns.
 */
export async function applyWorkspaceRls(
  executor?: SqlExecutor,
): Promise<ApplyWorkspaceRlsResult> {
  const resolvedExecutor =
    executor ?? ((await import("./client")).db as unknown as SqlExecutor);

  const result: ApplyWorkspaceRlsResult = {
    applied: 0,
    skipped: 0,
    errors: [],
  };

  for (const statement of buildWorkspaceRlsStatements()) {
    try {
      await resolvedExecutor.execute(sql.raw(statement));
      result.applied += 1;
    } catch (error) {
      const message = extractErrorMessage(error);
      const isPrivilege =
        /must be owner|permission denied|insufficient_privilege|42501/i.test(
          message,
        );
      if (isPrivilege) {
        result.skipped += 1;
        result.errors.push({ statement: statement.slice(0, 120), message });
        continue;
      }
      throw error;
    }
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyWorkspaceRls(undefined)
    .then((result) => {
      console.log(
        `Applied workspace RLS policies. ok=${result.applied} skipped=${result.skipped}`,
      );
      if (result.errors.length > 0) {
        console.warn("Skipped statements (ownership/privilege):");
        for (const err of result.errors) {
          console.warn(`- ${err.message}`);
          console.warn(`  ${err.statement}…`);
        }
      }
      // Non-zero only when nothing applied and everything failed hard — skipped
      // ownership gaps are expected on mixed-owner DBs.
      if (result.applied === 0 && result.skipped === 0) {
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("Failed to apply workspace RLS policies.", error);
      process.exit(1);
    });
}

import { sql } from "drizzle-orm";

import {
  buildApplicationSettingsAdminMutationPolicyStatements,
  buildApplicationSettingsPublicReadPolicyStatement,
  buildEnableRlsStatement,
  buildWorkspaceBootstrapInsertPolicyStatement,
  buildWorkspaceInviteAccessPolicyStatements,
  buildWorkspaceMembershipBootstrapInsertPolicyStatement,
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
  { tableName: "trip_invite", tripColumn: "trip_id" },
  { tableName: "segment_member", parentTable: "trip_segment" },
  // Expenses live on trips (not segments directly for the join, but they
  // have trip_id set so the standard trip-join works).
  { tableName: "expense", tripColumn: "trip_id" },
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

export function buildWorkspaceRlsStatements() {
  const workspaceStatements = workspaceRlsTargets.flatMap((target) => {
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
        additionalReadPredicate:
          target.tableName === "workspace_membership"
            ? `exists (
  select 1
  from "workspace_membership" current_membership
  where current_membership.workspace_id = "workspace_membership"."workspace_id"
    and current_membership.user_id = current_setting('app.user_id', true)
    and current_membership.role in ('owner', 'admin')
    and current_setting('app.workspace_id', true) <> ''
    and current_membership.workspace_id::text = current_setting('app.workspace_id', true)
)`
            : undefined,
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

    if (target.tableName === "workspace_membership") {
      const bootstrapPolicyName = "workspace_membership_bootstrap_insert";
      const inviteAcceptPolicyName =
        "workspace_membership_invite_accept_insert";
      return [
        ...tableStatements,
        buildDropPolicyStatement(target.tableName, bootstrapPolicyName),
        buildDropPolicyStatement(target.tableName, inviteAcceptPolicyName),
        buildWorkspaceMembershipBootstrapInsertPolicyStatement({
          policyName: bootstrapPolicyName,
        }),
        buildWorkspaceMembershipInviteAcceptInsertPolicyStatement({
          policyName: inviteAcceptPolicyName,
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

export async function applyWorkspaceRls(executor?: SqlExecutor) {
  const resolvedExecutor =
    executor ?? ((await import("./client")).db as unknown as SqlExecutor);

  for (const statement of buildWorkspaceRlsStatements()) {
    await resolvedExecutor.execute(sql.raw(statement));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyWorkspaceRls(undefined)
    .then(() => {
      console.log("Applied workspace RLS policies.");
    })
    .catch((error) => {
      console.error("Failed to apply workspace RLS policies.", error);
      process.exit(1);
    });
}

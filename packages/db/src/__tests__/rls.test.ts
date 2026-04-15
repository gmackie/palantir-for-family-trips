import { describe, expect, it, vi } from "vitest";

import {
  applyWorkspaceRls,
  buildWorkspaceRlsStatements,
  tripChildRlsTargets,
  workspaceRlsTargets,
} from "../rls";

describe("workspace RLS rollout", () => {
  it("tracks the workspace-owned tables that should receive RLS", () => {
    expect(workspaceRlsTargets).toEqual([
      { tableName: "workspace", workspaceColumn: "id" },
      { tableName: "workspace_membership", workspaceColumn: "workspace_id" },
      {
        tableName: "workspace_invite_allowlist",
        workspaceColumn: "workspace_id",
      },
      { tableName: "workspace_subscription", workspaceColumn: "workspace_id" },
      { tableName: "workspace_usage_rollup", workspaceColumn: "workspace_id" },
      { tableName: "trip", workspaceColumn: "workspace_id" },
    ]);
  });

  it("tracks trip child tables that inherit workspace scope via join", () => {
    expect(tripChildRlsTargets).toEqual([
      { tableName: "trip_segment", tripColumn: "trip_id" },
      { tableName: "trip_member", tripColumn: "trip_id" },
      { tableName: "trip_invite", tripColumn: "trip_id" },
      { tableName: "segment_member", parentTable: "trip_segment" },
    ]);
  });

  it("builds RLS policies for trip child tables that join through trip.workspace_id", () => {
    const statements = buildWorkspaceRlsStatements();

    for (const target of tripChildRlsTargets) {
      expect(
        statements.some((s) =>
          s.includes(`create policy "${target.tableName}_workspace_select"`),
        ),
      ).toBe(true);
      expect(
        statements.some((s) =>
          s.includes(`create policy "${target.tableName}_workspace_insert"`),
        ),
      ).toBe(true);
    }

    // segment_member policy must join through trip_segment then trip
    const segmentMemberSelect = statements.find((s) =>
      s.includes('create policy "segment_member_workspace_select"'),
    );
    expect(segmentMemberSelect).toMatch(/trip_segment/);
    expect(segmentMemberSelect).toMatch(/trip/);
  });

  it("builds enable, force, and policy statements for each workspace table", () => {
    const statements = buildWorkspaceRlsStatements();

    expect(statements).toContain(
      'alter table "workspace" enable row level security;',
    );
    expect(statements).toContain(
      'alter table "workspace" force row level security;',
    );
    expect(
      statements.some((statement) =>
        statement.includes('create policy "workspace_workspace_select"'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          'create policy "workspace_usage_rollup_workspace_insert"',
        ),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('create policy "workspace_bootstrap_insert"'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          'create policy "workspace_membership_bootstrap_insert"',
        ),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes(
          'alter table "application_settings" enable row level security;',
        ),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('create policy "application_settings_public_read"'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('create policy "workspace_public_bootstrap_select"'),
      ),
    ).toBe(true);
  });

  it("applies every generated statement through the database executor", async () => {
    const execute = vi.fn(async () => undefined);

    await applyWorkspaceRls({ execute });

    expect(execute).toHaveBeenCalledTimes(buildWorkspaceRlsStatements().length);
  });
});

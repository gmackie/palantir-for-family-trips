import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { user } from "../auth-schema";
import {
  memberLocations,
  tripInvites,
  tripMembers,
  workspaceInviteAllowlist,
  workspaceMembership,
} from "../schema";

describe("account deletion foreign keys", () => {
  for (const [table, columnName, migration] of [
    [tripMembers, "user_id", "0000_misty_wrecking_crew.sql"],
    [tripInvites, "invited_by_user_id", "0000_misty_wrecking_crew.sql"],
    [workspaceMembership, "user_id", "0000_misty_wrecking_crew.sql"],
    [
      workspaceInviteAllowlist,
      "invited_by_user_id",
      "0000_misty_wrecking_crew.sql",
    ],
    [memberLocations, "user_id", "0007_tired_wallop.sql"],
  ] as const) {
    const config = getTableConfig(table);
    it(`cascades user deletion to ${config.name} in schema and migration`, () => {
      const foreignKey = config.foreignKeys.find((key) => {
        const reference = key.reference();
        return (
          reference.foreignTable === user &&
          reference.columns.some(
            (column) =>
              column.name.replace(
                /[A-Z]/g,
                (letter) => `_${letter.toLowerCase()}`,
              ) === columnName,
          )
        );
      });
      expect(foreignKey).toBeDefined();
      expect(foreignKey?.onDelete).toBe("cascade");

      const sql = readFileSync(
        new URL(`../../drizzle/${migration}`, import.meta.url),
        "utf8",
      );
      const statement = sql
        .split(";")
        .find(
          (statement) =>
            statement.includes(`ALTER TABLE "${config.name}" ADD CONSTRAINT`) &&
            statement.includes(`FOREIGN KEY ("${columnName}")`),
        );
      expect(statement).toContain(
        'REFERENCES "public"."user"("id") ON DELETE cascade',
      );
    });
  }
});

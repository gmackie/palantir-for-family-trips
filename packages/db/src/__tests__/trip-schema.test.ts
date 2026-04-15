import { getTableConfig } from "drizzle-orm/pg-core";
// @ts-expect-error vitest is installed in sibling workspace test packages
import { describe, expect, it } from "vitest";

import {
  segmentMembers,
  tripClaimModeEnum,
  tripInvites,
  tripMemberRoleEnum,
  tripMembers,
  tripSegments,
  tripStatusEnum,
  trips,
} from "../schema";

describe("Trip workspace schema", () => {
  it("tracks trip lifecycle and claiming defaults separately from workspace roles", () => {
    expect(tripStatusEnum).toEqual([
      "planning",
      "confirmed",
      "active",
      "completed",
    ]);
    expect(tripClaimModeEnum).toEqual(["organizer", "tap"]);
    expect(tripMemberRoleEnum).toEqual(["organizer", "member"]);
    expect(trips.workspaceId).toBeDefined();
    expect(trips.status).toBeDefined();
    expect(trips.claimMode).toBeDefined();
    expect(trips.tz).toBeDefined();
  });

  it("models trips as segments all the way down", () => {
    expect(tripSegments.tripId).toBeDefined();
    expect(tripSegments.sortOrder).toBeDefined();
    expect(segmentMembers.segmentId).toBeDefined();
    expect(segmentMembers.userId).toBeDefined();
  });

  it("keeps trip membership and invites unique per trip", () => {
    const memberConfig = getTableConfig(tripMembers);
    const inviteConfig = getTableConfig(tripInvites);
    const segmentMemberConfig = getTableConfig(segmentMembers);

    expect(tripMembers.tripId).toBeDefined();
    expect(tripMembers.userId).toBeDefined();
    expect(tripInvites.tripId).toBeDefined();
    expect(tripInvites.email).toBeDefined();
    expect(tripInvites.token).toBeDefined();

    expect(
      memberConfig.uniqueConstraints.map((constraint) => constraint.getName()),
    ).toContain("trip_members_trip_user_unique");
    expect(
      inviteConfig.uniqueConstraints.map((constraint) => constraint.getName()),
    ).toContain("trip_invites_trip_email_unique");
    expect(
      segmentMemberConfig.uniqueConstraints.map((constraint) =>
        constraint.getName(),
      ),
    ).toContain("segment_members_segment_user_unique");
  });
});

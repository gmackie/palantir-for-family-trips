import { and, eq } from "@gmacko/db";
import { db as defaultDb } from "@gmacko/db/client";
import { workspace, workspaceMembership } from "@gmacko/db/schema";

type Database = typeof defaultDb;

function slugifyBase(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

/**
 * Ensures the user has at least one workspace membership. If they don't,
 * creates a personal workspace owned by them and provisions their
 * "owner" membership.
 *
 * Idempotent: calling multiple times for the same user returns the
 * existing workspace without mutating.
 *
 * Handles the race where two concurrent sign-ins both try to bootstrap
 * by catching unique-constraint violations and re-reading.
 */
export async function ensurePersonalWorkspace(input: {
  userId: string;
  userName: string;
  userEmail: string;
  db?: Database;
}): Promise<{
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  created: boolean;
}> {
  const db = input.db ?? defaultDb;

  const existingMembership = await db.query.workspaceMembership.findFirst({
    where: eq(workspaceMembership.userId, input.userId),
    orderBy: (membership, { asc }) => [
      asc(membership.createdAt),
      asc(membership.id),
    ],
  });

  if (existingMembership) {
    const existingWorkspace = await db.query.workspace.findFirst({
      where: eq(workspace.id, existingMembership.workspaceId),
    });

    if (existingWorkspace) {
      return {
        workspaceId: existingWorkspace.id,
        workspaceSlug: existingWorkspace.slug,
        workspaceName: existingWorkspace.name,
        created: false,
      };
    }
  }

  const displayName =
    input.userName?.trim() ||
    input.userEmail.split("@")[0] ||
    "Personal workspace";
  const workspaceName = `${displayName}'s workspace`;
  const baseSlug = slugifyBase(displayName);
  const slug = await uniqueSlugForUser({
    db,
    userId: input.userId,
    baseSlug,
  });

  try {
    const createdWorkspace = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(workspace)
        .values({
          name: workspaceName,
          slug,
          ownerUserId: input.userId,
        })
        .returning({
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        });

      if (!created) {
        throw new Error("Failed to create personal workspace");
      }

      await tx.insert(workspaceMembership).values({
        workspaceId: created.id,
        userId: input.userId,
        role: "owner",
      });

      return created;
    });

    return {
      workspaceId: createdWorkspace.id,
      workspaceSlug: createdWorkspace.slug,
      workspaceName: createdWorkspace.name,
      created: true,
    };
  } catch (error) {
    // Race condition: another concurrent call bootstrapped first.
    // Re-read and return the existing workspace.
    const membership = await db.query.workspaceMembership.findFirst({
      where: eq(workspaceMembership.userId, input.userId),
      orderBy: (membership, { asc }) => [
        asc(membership.createdAt),
        asc(membership.id),
      ],
    });

    if (!membership) {
      throw error;
    }

    const existingWorkspace = await db.query.workspace.findFirst({
      where: eq(workspace.id, membership.workspaceId),
    });

    if (!existingWorkspace) {
      throw error;
    }

    return {
      workspaceId: existingWorkspace.id,
      workspaceSlug: existingWorkspace.slug,
      workspaceName: existingWorkspace.name,
      created: false,
    };
  }
}

async function uniqueSlugForUser(input: {
  db: Database;
  userId: string;
  baseSlug: string;
}): Promise<string> {
  const { db, userId, baseSlug } = input;
  const candidates = [baseSlug, `${baseSlug}-${userId.slice(0, 6)}`];

  for (const candidate of candidates) {
    const conflict = await db.query.workspace.findFirst({
      where: and(eq(workspace.slug, candidate)),
    });
    if (!conflict) {
      return candidate;
    }
  }

  return `${baseSlug}-${userId.slice(0, 6)}-${Date.now().toString(36)}`;
}

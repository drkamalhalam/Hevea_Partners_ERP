import { Router } from "express";
import {
  db,
  usersTable,
  userProjectAssignmentsTable,
  projectNomineesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { UpsertMeBody, UpdateMyProfileBody } from "@workspace/api-zod";

const router = Router();

async function buildProfile(clerkUserId: string) {
  const [userRow] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  const assignments = userRow
    ? await db
        .select()
        .from(userProjectAssignmentsTable)
        .where(eq(userProjectAssignmentsTable.userId, userRow.id))
    : [];

  const activeAssignments = assignments.filter((a) => !a.revokedAt);

  // ── Nominee completeness check (developer role only) ────────────────────
  // A developer must register a nominee for each project they are assigned
  // to in the "developer" project role.  If any are missing, profileComplete
  // is false and the missing project IDs are returned for the UI to surface.
  let missingNomineeProjectIds: string[] = [];

  if (userRow?.role === "developer") {
    const developerProjectIds = activeAssignments
      .filter((a) => a.projectRole === "developer")
      .map((a) => a.projectId);

    if (developerProjectIds.length > 0) {
      const nominees = await db
        .select({ projectId: projectNomineesTable.projectId })
        .from(projectNomineesTable)
        .where(
          and(
            inArray(projectNomineesTable.projectId, developerProjectIds),
            eq(projectNomineesTable.isActive, true),
          ),
        );

      const nominatedSet = new Set(nominees.map((n) => n.projectId));
      missingNomineeProjectIds = developerProjectIds.filter(
        (id) => !nominatedSet.has(id),
      );
    }
  }

  const profileComplete = missingNomineeProjectIds.length === 0;

  return {
    clerkUserId,
    role: userRow?.role ?? "employee",
    displayName: userRow?.displayName ?? null,
    email: userRow?.email ?? null,
    phone: userRow?.phone ?? null,
    address: userRow?.address ?? null,
    avatarUrl: userRow?.avatarUrl ?? null,
    idDocumentUrl: userRow?.idDocumentUrl ?? null,
    isActive: userRow?.isActive ?? true,
    profileComplete,
    missingNomineeProjectIds,
    assignedProjectIds: activeAssignments.map((a) => a.projectId),
    projectAssignments: activeAssignments.map((a) => ({
      assignmentId: a.id,
      projectId: a.projectId,
      projectRole: a.projectRole ?? null,
    })),
    createdAt: (userRow?.createdAt ?? new Date()).toISOString(),
  };
}

// GET /me — current user profile
router.get("/", async (req, res) => {
  try {
    res.json(await buildProfile(req.userId!));
  } catch (err) {
    req.log.error({ err }, "Failed to get user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /me — upsert current user (auto-called on first login by RoleContext)
router.put("/", async (req, res) => {
  try {
    const parsed = UpsertMeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { role, displayName, email, phone, address } = parsed.data;

    await db
      .insert(usersTable)
      .values({ clerkUserId: req.userId!, role, displayName, email, phone, address })
      .onConflictDoUpdate({
        target: usersTable.clerkUserId,
        set: {
          displayName,
          email,
          ...(phone !== undefined && { phone }),
          ...(address !== undefined && { address }),
          updatedAt: new Date(),
        },
      });

    res.json(await buildProfile(req.userId!));
  } catch (err) {
    req.log.error({ err }, "Failed to upsert user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /me/profile — update own profile fields (name, phone, address, avatar)
router.patch("/profile", async (req, res) => {
  try {
    const parsed = UpdateMyProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const updates = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(updates).length > 0) {
      await db
        .update(usersTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(usersTable.clerkUserId, req.userId!));
    }

    res.json(await buildProfile(req.userId!));
  } catch (err) {
    req.log.error({ err }, "Failed to update profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

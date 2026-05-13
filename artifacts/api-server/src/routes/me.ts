import { Router } from "express";
import { db, usersTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
          // Only update phone/address if provided (don't wipe existing values)
          ...(phone !== undefined && { phone }),
          ...(address !== undefined && { address }),
          updatedAt: new Date(),
        },
        // Note: role is NOT updated on conflict — admin must change roles via /users/:id/role
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

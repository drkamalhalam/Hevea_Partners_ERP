import { Router } from "express";
import { db, userRolesTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpsertMeBody } from "@workspace/api-zod";

const router = Router();

async function buildProfile(userId: string) {
  const [role] = await db
    .select()
    .from(userRolesTable)
    .where(eq(userRolesTable.clerkUserId, userId))
    .limit(1);

  const assignments = await db
    .select()
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.clerkUserId, userId));

  return {
    clerkUserId: userId,
    role: role?.role ?? "employee",
    displayName: role?.displayName ?? null,
    email: role?.email ?? null,
    assignedProjectIds: assignments.map((a) => a.projectId),
    createdAt: (role?.createdAt ?? new Date()).toISOString(),
  };
}

// GET /me — current user profile (requireAuth applied globally in index.ts)
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

    const { role, displayName, email } = parsed.data;

    await db
      .insert(userRolesTable)
      .values({ clerkUserId: req.userId!, role, displayName, email })
      .onConflictDoUpdate({
        target: userRolesTable.clerkUserId,
        set: { displayName, email, updatedAt: new Date() },
        // Note: role is NOT updated on conflict — admin must change roles via /users/:id/role
      });

    res.json(await buildProfile(req.userId!));
  } catch (err) {
    req.log.error({ err }, "Failed to upsert user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

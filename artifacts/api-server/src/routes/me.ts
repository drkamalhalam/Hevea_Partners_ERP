import { Router } from "express";
import { db, usersTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpsertMeBody } from "@workspace/api-zod";

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

  return {
    clerkUserId,
    role: userRow?.role ?? "employee",
    displayName: userRow?.displayName ?? null,
    email: userRow?.email ?? null,
    assignedProjectIds: assignments
      .filter((a) => !a.revokedAt)
      .map((a) => a.projectId),
    createdAt: (userRow?.createdAt ?? new Date()).toISOString(),
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
      .insert(usersTable)
      .values({ clerkUserId: req.userId!, role, displayName, email })
      .onConflictDoUpdate({
        target: usersTable.clerkUserId,
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

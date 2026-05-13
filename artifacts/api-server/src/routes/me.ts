import { Router } from "express";
import { getAuth } from "@clerk/express";
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

router.get("/", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(await buildProfile(userId));
  } catch (err) {
    req.log.error({ err }, "Failed to get user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = UpsertMeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { role, displayName, email } = parsed.data;

    await db
      .insert(userRolesTable)
      .values({ clerkUserId: userId, role, displayName, email })
      .onConflictDoUpdate({
        target: userRolesTable.clerkUserId,
        set: { role, displayName, email, updatedAt: new Date() },
      });

    res.json(await buildProfile(userId));
  } catch (err) {
    req.log.error({ err }, "Failed to upsert user profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

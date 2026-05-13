import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, userRolesTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateUserRoleBody, AssignUserToProjectBody } from "@workspace/api-zod";

const router = Router();

// GET /users — list all users
router.get("/", async (req, res) => {
  try {
    const roles = await db.select().from(userRolesTable).orderBy(userRolesTable.createdAt);
    const assignments = await db.select().from(userProjectAssignmentsTable);

    const profiles = roles.map((r) => ({
      clerkUserId: r.clerkUserId,
      role: r.role,
      displayName: r.displayName,
      email: r.email,
      assignedProjectIds: assignments
        .filter((a) => a.clerkUserId === r.clerkUserId)
        .map((a) => a.projectId),
      createdAt: r.createdAt.toISOString(),
    }));

    res.json(profiles);
  } catch (err) {
    req.log.error({ err }, "Failed to list users");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /users/:clerkUserId/role — update a user's role
router.put("/:clerkUserId/role", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = UpdateUserRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { clerkUserId } = req.params;

    await db
      .insert(userRolesTable)
      .values({ clerkUserId, role: parsed.data.role })
      .onConflictDoUpdate({
        target: userRolesTable.clerkUserId,
        set: { role: parsed.data.role, updatedAt: new Date() },
      });

    const [updated] = await db
      .select()
      .from(userRolesTable)
      .where(eq(userRolesTable.clerkUserId, clerkUserId))
      .limit(1);

    const assignments = await db
      .select()
      .from(userProjectAssignmentsTable)
      .where(eq(userProjectAssignmentsTable.clerkUserId, clerkUserId));

    res.json({
      clerkUserId: updated.clerkUserId,
      role: updated.role,
      displayName: updated.displayName,
      email: updated.email,
      assignedProjectIds: assignments.map((a) => a.projectId),
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update user role");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /users/:clerkUserId/projects — assign user to project
router.post("/:clerkUserId/projects", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = AssignUserToProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { clerkUserId } = req.params;
    const { projectId } = parsed.data;

    await db
      .insert(userProjectAssignmentsTable)
      .values({ clerkUserId, projectId })
      .onConflictDoNothing();

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to assign user to project");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

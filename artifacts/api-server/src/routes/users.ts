import { Router } from "express";
import { db, usersTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { UpdateUserRoleBody, AssignUserToProjectBody } from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

async function buildUserProfile(clerkUserId: string) {
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
    clerkUserId: userRow?.clerkUserId ?? clerkUserId,
    role: userRow?.role ?? "employee",
    displayName: userRow?.displayName ?? null,
    email: userRow?.email ?? null,
    assignedProjectIds: assignments
      .filter((a) => !a.revokedAt)
      .map((a) => a.projectId),
    createdAt: (userRow?.createdAt ?? new Date()).toISOString(),
  };
}

// GET /users — admin only
router.get("/", requireRole("admin"), async (req, res) => {
  try {
    const users = await db
      .select()
      .from(usersTable)
      .orderBy(usersTable.createdAt);

    const assignments = await db.select().from(userProjectAssignmentsTable);

    const profiles = users.map((u) => ({
      clerkUserId: u.clerkUserId,
      role: u.role,
      displayName: u.displayName,
      email: u.email,
      assignedProjectIds: assignments
        .filter((a) => a.userId === u.id && !a.revokedAt)
        .map((a) => a.projectId),
      createdAt: u.createdAt.toISOString(),
    }));

    res.json(profiles);
  } catch (err) {
    req.log.error({ err }, "Failed to list users");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /users/:clerkUserId/role — admin only
router.put("/:clerkUserId/role", requireRole("admin"), async (req, res) => {
  const parsed = UpdateUserRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const clerkUserId = String(req.params.clerkUserId);

  try {
    await db
      .insert(usersTable)
      .values({ clerkUserId, role: parsed.data.role })
      .onConflictDoUpdate({
        target: usersTable.clerkUserId,
        set: { role: parsed.data.role, updatedAt: new Date() },
      });

    res.json(await buildUserProfile(clerkUserId));
  } catch (err) {
    req.log.error({ err }, "Failed to update user role");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /users/:clerkUserId/projects — admin only
router.post("/:clerkUserId/projects", requireRole("admin"), async (req, res) => {
  const parsed = AssignUserToProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const clerkUserId = String(req.params.clerkUserId);
  const { projectId } = parsed.data;

  try {
    // Resolve internal user UUID from clerkUserId
    const [userRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (!userRow) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await db
      .insert(userProjectAssignmentsTable)
      .values({ userId: userRow.id, projectId })
      .onConflictDoNothing();

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to assign user to project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /users/:clerkUserId/projects/:projectId — admin only
router.delete(
  "/:clerkUserId/projects/:projectId",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const projectId = String(req.params.projectId);

    try {
      const [userRow] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      await db
        .delete(userProjectAssignmentsTable)
        .where(
          and(
            eq(userProjectAssignmentsTable.userId, userRow.id),
            eq(userProjectAssignmentsTable.projectId, projectId),
          ),
        );
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "Failed to remove user from project");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

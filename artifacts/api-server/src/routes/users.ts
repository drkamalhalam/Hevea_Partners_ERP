import { Router } from "express";
import { db, userRolesTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { UpdateUserRoleBody, AssignUserToProjectBody } from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

async function buildUserProfile(clerkUserId: string) {
  const [role] = await db
    .select()
    .from(userRolesTable)
    .where(eq(userRolesTable.clerkUserId, clerkUserId))
    .limit(1);

  const assignments = await db
    .select()
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.clerkUserId, clerkUserId));

  return {
    clerkUserId: role?.clerkUserId ?? clerkUserId,
    role: role?.role ?? "employee",
    displayName: role?.displayName ?? null,
    email: role?.email ?? null,
    assignedProjectIds: assignments.map((a) => a.projectId),
    createdAt: (role?.createdAt ?? new Date()).toISOString(),
  };
}

// GET /users — admin only
router.get("/", requireRole("admin"), async (req, res) => {
  try {
    const roles = await db
      .select()
      .from(userRolesTable)
      .orderBy(userRolesTable.createdAt);

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
      .insert(userRolesTable)
      .values({ clerkUserId, role: parsed.data.role })
      .onConflictDoUpdate({
        target: userRolesTable.clerkUserId,
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

// DELETE /users/:clerkUserId/projects/:projectId — admin only
router.delete(
  "/:clerkUserId/projects/:projectId",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const projectId = Number(req.params.projectId);

    if (isNaN(projectId)) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }

    try {
      await db
        .delete(userProjectAssignmentsTable)
        .where(
          and(
            eq(userProjectAssignmentsTable.clerkUserId, clerkUserId),
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

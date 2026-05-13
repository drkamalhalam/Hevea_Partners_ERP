import { Router } from "express";
import { db, usersTable, userProjectAssignmentsTable, activityTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  UpdateUserRoleBody,
  AssignUserToProjectBody,
  UpdateUserProfileBody,
  UpdateProjectAssignmentBody,
} from "@workspace/api-zod";
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

  const activeAssignments = assignments.filter((a) => !a.revokedAt);

  return {
    clerkUserId: userRow?.clerkUserId ?? clerkUserId,
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

// GET /users — admin or developer (developers need user list to assign project participants)
router.get("/", requireRole("admin", "developer"), async (req, res) => {
  try {
    const users = await db
      .select()
      .from(usersTable)
      .orderBy(usersTable.createdAt);

    const assignments = await db.select().from(userProjectAssignmentsTable);

    const profiles = users.map((u) => {
      const active = assignments.filter(
        (a) => a.userId === u.id && !a.revokedAt,
      );
      return {
        clerkUserId: u.clerkUserId,
        role: u.role,
        displayName: u.displayName ?? null,
        email: u.email ?? null,
        phone: u.phone ?? null,
        address: u.address ?? null,
        avatarUrl: u.avatarUrl ?? null,
        idDocumentUrl: u.idDocumentUrl ?? null,
        isActive: u.isActive,
        assignedProjectIds: active.map((a) => a.projectId),
        projectAssignments: active.map((a) => ({
          assignmentId: a.id,
          projectId: a.projectId,
          projectRole: a.projectRole ?? null,
        })),
        createdAt: u.createdAt.toISOString(),
      };
    });

    res.json(profiles);
  } catch (err) {
    req.log.error({ err }, "Failed to list users");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /users/:clerkUserId — admin or developer (or own profile)
router.get(
  "/:clerkUserId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    try {
      const profile = await buildUserProfile(clerkUserId);
      res.json(profile);
    } catch (err) {
      req.log.error({ err }, "Failed to get user profile");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PATCH /users/:clerkUserId — admin only: update profile fields
router.patch("/:clerkUserId", requireRole("admin"), async (req, res) => {
  const clerkUserId = String(req.params.clerkUserId);

  const parsed = UpdateUserProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const updates = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );

  try {
    if (Object.keys(updates).length > 0) {
      await db
        .update(usersTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(usersTable.clerkUserId, clerkUserId));
    }

    res.json(await buildUserProfile(clerkUserId));
  } catch (err) {
    req.log.error({ err }, "Failed to update user profile");
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
router.post(
  "/:clerkUserId/projects",
  requireRole("admin"),
  async (req, res) => {
    const parsed = AssignUserToProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const clerkUserId = String(req.params.clerkUserId);
    const { projectId, projectRole } = parsed.data;

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
        .insert(userProjectAssignmentsTable)
        .values({
          userId: userRow.id,
          projectId,
          projectRole: projectRole ?? null,
          assignedBy: req.userId
            ? (
                await db
                  .select({ id: usersTable.id })
                  .from(usersTable)
                  .where(eq(usersTable.clerkUserId, req.userId))
                  .limit(1)
              )[0]?.id
            : undefined,
        })
        .onConflictDoUpdate({
          target: [
            userProjectAssignmentsTable.userId,
            userProjectAssignmentsTable.projectId,
          ],
          set: {
            projectRole: projectRole ?? null,
            revokedAt: null,
            updatedAt: new Date(),
          },
        });

      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "Failed to assign user to project");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PATCH /users/:clerkUserId/projects/:projectId — admin only: update project role
router.patch(
  "/:clerkUserId/projects/:projectId",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const projectId = String(req.params.projectId);

    const parsed = UpdateProjectAssignmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error });
      return;
    }

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
        .update(userProjectAssignmentsTable)
        .set({ projectRole: parsed.data.projectRole, updatedAt: new Date() })
        .where(
          and(
            eq(userProjectAssignmentsTable.userId, userRow.id),
            eq(userProjectAssignmentsTable.projectId, projectId),
          ),
        );

      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "Failed to update assignment role");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

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

// GET /users/:clerkUserId/activity — admin or developer or own
router.get(
  "/:clerkUserId/activity",
  requireRole("admin", "developer"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    try {
      const [userRow] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!userRow) {
        res.json([]);
        return;
      }

      const activities = await db
        .select()
        .from(activityTable)
        .where(eq(activityTable.userId, userRow.id))
        .orderBy(desc(activityTable.createdAt))
        .limit(limit);

      res.json(
        activities.map((a) => ({
          id: a.id,
          type: a.type,
          description: a.description,
          entityId: a.entityId,
          entityType: a.entityType,
          userId: a.userId ?? null,
          projectId: a.projectId ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to get user activity");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

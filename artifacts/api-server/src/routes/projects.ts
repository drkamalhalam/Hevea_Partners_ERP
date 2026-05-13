import { Router } from "express";
import {
  db,
  projectsTable,
  activityTable,
  usersTable,
  userProjectAssignmentsTable,
  projectNomineesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  ListProjectParticipantsParams,
  AddProjectParticipantParams,
  AddProjectParticipantBody,
  UpdateProjectParticipantParams,
  UpdateProjectParticipantBody,
  RemoveProjectParticipantParams,
  GetProjectNomineeParams,
  AddProjectNomineeBody,
  EditProjectNomineeParams,
  EditProjectNomineeBody,
  ReplaceProjectNomineeParams,
  ReplaceProjectNomineeBody,
  RemoveProjectNomineeParams,
} from "@workspace/api-zod";
import { requireRole, canAccessProject } from "../middlewares/auth";

const router = Router();

function formatProject(p: typeof projectsTable.$inferSelect) {
  return {
    ...p,
    startDate: p.startDate,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt?.toISOString() ?? null,
  };
}

type AssignmentRow = typeof userProjectAssignmentsTable.$inferSelect;
type UserRow = typeof usersTable.$inferSelect;

function formatParticipant(a: AssignmentRow, user: UserRow | undefined) {
  return {
    id: a.id,
    userId: a.userId,
    clerkUserId: user?.clerkUserId ?? "",
    displayName: user?.displayName ?? null,
    email: user?.email ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    projectId: a.projectId,
    projectRole: a.projectRole,
    isActive: a.isActive,
    joinDate: a.joinDate ?? null,
    remarks: a.remarks ?? null,
    participationNotes: a.participationNotes ?? null,
    assignedBy: a.assignedBy ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Roles that may only have one assignment per project */
const EXCLUSIVE_ROLES = ["landowner", "developer"] as const;

// GET /projects — admin/developer get all; others get only assigned projects
router.get("/", async (req, res) => {
  try {
    const projects = await db
      .select()
      .from(projectsTable)
      .orderBy(projectsTable.createdAt);
    if (req.canAccessAllProjects) {
      res.json(projects.map(formatProject));
    } else {
      res.json(
        projects
          .filter((p) => (req.userProjectIds ?? []).includes(p.id))
          .map(formatProject),
      );
    }
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects — admin or developer only
router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [project] = await db
      .insert(projectsTable)
      .values(parsed.data)
      .returning();
    await db.insert(activityTable).values({
      type: "project_created",
      description: `New project "${project.name}" created`,
      entityId: project.id,
      entityType: "project",
    });
    res.status(201).json(formatProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /projects/:id — check project access
router.get("/:id", async (req, res) => {
  const parsed = GetProjectParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!canAccessProject(req, parsed.data.id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, parsed.data.id));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /projects/:id — admin or developer + project access
router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = UpdateProjectParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!canAccessProject(req, paramsParsed.data.id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const bodyParsed = UpdateProjectBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  try {
    const [project] = await db
      .update(projectsTable)
      .set(bodyParsed.data)
      .where(eq(projectsTable.id, paramsParsed.data.id))
      .returning();
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db.insert(activityTable).values({
      type: "project_updated",
      description: `Project "${project.name}" updated`,
      entityId: project.id,
      entityType: "project",
    });
    res.json(formatProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /projects/:id — admin only
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const parsed = DeleteProjectParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db
      .delete(projectsTable)
      .where(eq(projectsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────
//  Project Participant Sub-Routes
// ─────────────────────────────────────────────

// GET /projects/:id/participants — any user with project access
router.get("/:id/participants", async (req, res) => {
  const parsed = ListProjectParticipantsParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  if (!canAccessProject(req, parsed.data.id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  try {
    const assignments = await db
      .select()
      .from(userProjectAssignmentsTable)
      .where(eq(userProjectAssignmentsTable.projectId, parsed.data.id));

    const userIds = assignments.map((a) => a.userId);
    const users =
      userIds.length > 0
        ? await db
            .select()
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
        : [];

    res.json(
      assignments.map((a) =>
        formatParticipant(
          a,
          users.find((u) => u.id === a.userId),
        ),
      ),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list project participants");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects/:id/participants — admin or developer only
router.post(
  "/:id/participants",
  requireRole("admin", "developer"),
  async (req, res) => {
    const paramsParsed = AddProjectParticipantParams.safeParse({
      id: req.params.id,
    });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const bodyParsed = AddProjectParticipantBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }

    const projectId = paramsParsed.data.id;
    const { clerkUserId, projectRole, joinDate, remarks, participationNotes } =
      bodyParsed.data;

    try {
      // Resolve clerkUserId → users.id (UUID)
      const [targetUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Enforce exclusive-role constraints (landowner / developer: 1 per project)
      if (
        EXCLUSIVE_ROLES.includes(
          projectRole as (typeof EXCLUSIVE_ROLES)[number],
        )
      ) {
        const existing = await db
          .select()
          .from(userProjectAssignmentsTable)
          .where(
            and(
              eq(userProjectAssignmentsTable.projectId, projectId),
              eq(
                userProjectAssignmentsTable.projectRole,
                projectRole as
                  | "admin"
                  | "developer"
                  | "landowner"
                  | "investor"
                  | "employee"
                  | "operational_staff",
              ),
            ),
          )
          .limit(1);

        if (existing.length > 0 && existing[0].userId !== targetUser.id) {
          res.status(409).json({
            error: `A ${projectRole} is already assigned to this project`,
          });
          return;
        }
      }

      // Look up the assigning user's DB UUID from their Clerk userId
      let assignedById: string | undefined;
      if (req.userId) {
        const [assignerRow] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.clerkUserId, req.userId))
          .limit(1);
        assignedById = assignerRow?.id;
      }

      // Upsert: if the user is already assigned to this project, update their role/data
      const [assignment] = await db
        .insert(userProjectAssignmentsTable)
        .values({
          userId: targetUser.id,
          projectId,
          projectRole: projectRole as
            | "admin"
            | "developer"
            | "landowner"
            | "investor"
            | "employee"
            | "operational_staff",
          isActive: true,
          joinDate: joinDate ?? null,
          remarks: remarks ?? null,
          participationNotes: participationNotes ?? null,
          assignedBy: assignedById ?? null,
        })
        .onConflictDoUpdate({
          target: [
            userProjectAssignmentsTable.userId,
            userProjectAssignmentsTable.projectId,
          ],
          set: {
            projectRole: projectRole as
              | "admin"
              | "developer"
              | "landowner"
              | "investor"
              | "employee"
              | "operational_staff",
            isActive: true,
            joinDate: joinDate ?? null,
            remarks: remarks ?? null,
            participationNotes: participationNotes ?? null,
            assignedBy: assignedById ?? null,
            revokedAt: null,
          },
        })
        .returning();

      res.status(201).json(formatParticipant(assignment, targetUser));
    } catch (err) {
      req.log.error({ err }, "Failed to add project participant");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PATCH /projects/:id/participants/:assignmentId — admin or developer only
router.patch(
  "/:id/participants/:assignmentId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const paramsParsed = UpdateProjectParticipantParams.safeParse({
      id: req.params.id,
      assignmentId: req.params.assignmentId,
    });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    const bodyParsed = UpdateProjectParticipantBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }

    const { id: projectId, assignmentId } = paramsParsed.data;
    const updates = bodyParsed.data;

    try {
      // Fetch existing assignment first
      const [existing] = await db
        .select()
        .from(userProjectAssignmentsTable)
        .where(
          and(
            eq(userProjectAssignmentsTable.id, assignmentId),
            eq(userProjectAssignmentsTable.projectId, projectId),
          ),
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Participant assignment not found" });
        return;
      }

      // Check exclusive-role constraint if changing role
      if (
        updates.projectRole &&
        updates.projectRole !== existing.projectRole &&
        EXCLUSIVE_ROLES.includes(
          updates.projectRole as (typeof EXCLUSIVE_ROLES)[number],
        )
      ) {
        const conflict = await db
          .select()
          .from(userProjectAssignmentsTable)
          .where(
            and(
              eq(userProjectAssignmentsTable.projectId, projectId),
              eq(
                userProjectAssignmentsTable.projectRole,
                updates.projectRole as
                  | "admin"
                  | "developer"
                  | "landowner"
                  | "investor"
                  | "employee"
                  | "operational_staff",
              ),
            ),
          )
          .limit(1);

        if (conflict.length > 0 && conflict[0].id !== assignmentId) {
          res.status(409).json({
            error: `A ${updates.projectRole} is already assigned to this project`,
          });
          return;
        }
      }

      const [updated] = await db
        .update(userProjectAssignmentsTable)
        .set({
          ...(updates.projectRole && {
            projectRole: updates.projectRole as
              | "admin"
              | "developer"
              | "landowner"
              | "investor"
              | "employee"
              | "operational_staff",
          }),
          ...(updates.isActive !== undefined && { isActive: updates.isActive }),
          ...(updates.joinDate !== undefined && { joinDate: updates.joinDate }),
          ...(updates.remarks !== undefined && { remarks: updates.remarks }),
          ...(updates.participationNotes !== undefined && {
            participationNotes: updates.participationNotes,
          }),
        })
        .where(eq(userProjectAssignmentsTable.id, assignmentId))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, updated.userId))
        .limit(1);

      res.json(formatParticipant(updated, user));
    } catch (err) {
      req.log.error({ err }, "Failed to update project participant");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /projects/:id/participants/:assignmentId — admin or developer only
router.delete(
  "/:id/participants/:assignmentId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const parsed = RemoveProjectParticipantParams.safeParse({
      id: req.params.id,
      assignmentId: req.params.assignmentId,
    });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }
    try {
      await db
        .delete(userProjectAssignmentsTable)
        .where(
          and(
            eq(userProjectAssignmentsTable.id, parsed.data.assignmentId),
            eq(userProjectAssignmentsTable.projectId, parsed.data.id),
          ),
        );
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "Failed to remove project participant");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─────────────────────────────────────────────
//  Nominee Sub-Routes  (/projects/:id/nominee)
//  Governance continuity nominees — NOT ownership transfer.
// ─────────────────────────────────────────────

type NomineeRow = typeof projectNomineesTable.$inferSelect;

function formatNominee(n: NomineeRow) {
  return {
    id: n.id,
    projectId: n.projectId,
    nominatedBy: n.nominatedBy ?? null,
    nomineeName: n.nomineeName,
    relationship: n.relationship,
    phone: n.phone,
    address: n.address,
    idDocumentUrl: n.idDocumentUrl ?? null,
    isActive: n.isActive,
    activationStatus: n.activationStatus,
    activationNotes: n.activationNotes ?? null,
    activatedAt: n.activatedAt?.toISOString() ?? null,
    activatedBy: n.activatedBy ?? null,
    replacedAt: n.replacedAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt?.toISOString() ?? null,
  };
}

// GET /projects/:id/nominee — any user with project access
router.get("/:id/nominee", async (req, res) => {
  const parsed = GetProjectNomineeParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  if (!canAccessProject(req, parsed.data.id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  try {
    const [nominee] = await db
      .select()
      .from(projectNomineesTable)
      .where(
        and(
          eq(projectNomineesTable.projectId, parsed.data.id),
          eq(projectNomineesTable.isActive, true),
        ),
      )
      .limit(1);

    res.json(nominee ? formatNominee(nominee) : null);
  } catch (err) {
    req.log.error({ err }, "Failed to get project nominee");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects/:id/nominee — add (admin or developer; 409 if already exists)
router.post("/:id/nominee", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = GetProjectNomineeParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const bodyParsed = AddProjectNomineeBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const projectId = paramsParsed.data.id;

  try {
    const [existing] = await db
      .select({ id: projectNomineesTable.id })
      .from(projectNomineesTable)
      .where(
        and(
          eq(projectNomineesTable.projectId, projectId),
          eq(projectNomineesTable.isActive, true),
        ),
      )
      .limit(1);

    if (existing) {
      res.status(409).json({
        error: "A nominee already exists for this project — use PUT to replace",
      });
      return;
    }

    let nominatedById: string | undefined;
    if (req.userId) {
      const [row] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, req.userId))
        .limit(1);
      nominatedById = row?.id;
    }

    const [nominee] = await db
      .insert(projectNomineesTable)
      .values({
        projectId,
        nominatedBy: nominatedById ?? null,
        nomineeName: bodyParsed.data.nomineeName,
        relationship: bodyParsed.data.relationship,
        phone: bodyParsed.data.phone,
        address: bodyParsed.data.address,
        idDocumentUrl: bodyParsed.data.idDocumentUrl ?? null,
        isActive: true,
        activationStatus: "pending",
      })
      .returning();

    res.status(201).json(formatNominee(nominee));
  } catch (err) {
    req.log.error({ err }, "Failed to add project nominee");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /projects/:id/nominee — edit details (admin or developer)
router.patch("/:id/nominee", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = EditProjectNomineeParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const bodyParsed = EditProjectNomineeBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(projectNomineesTable)
      .where(
        and(
          eq(projectNomineesTable.projectId, paramsParsed.data.id),
          eq(projectNomineesTable.isActive, true),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No nominee on record for this project" });
      return;
    }

    const updates = Object.fromEntries(
      Object.entries(bodyParsed.data).filter(([, v]) => v !== undefined),
    );

    const [updated] = await db
      .update(projectNomineesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projectNomineesTable.id, existing.id))
      .returning();

    res.json(formatNominee(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to edit project nominee");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /projects/:id/nominee — replace (marks old as replaced, creates new)
router.put("/:id/nominee", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = ReplaceProjectNomineeParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const bodyParsed = ReplaceProjectNomineeBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const projectId = paramsParsed.data.id;

  try {
    let replacingUserId: string | undefined;
    if (req.userId) {
      const [row] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, req.userId))
        .limit(1);
      replacingUserId = row?.id;
    }

    // Soft-archive any currently active nominees for this project
    await db
      .update(projectNomineesTable)
      .set({
        isActive: false,
        replacedAt: new Date(),
        replacedBy: replacingUserId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectNomineesTable.projectId, projectId),
          eq(projectNomineesTable.isActive, true),
        ),
      );

    const [nominee] = await db
      .insert(projectNomineesTable)
      .values({
        projectId,
        nominatedBy: replacingUserId ?? null,
        nomineeName: bodyParsed.data.nomineeName,
        relationship: bodyParsed.data.relationship,
        phone: bodyParsed.data.phone,
        address: bodyParsed.data.address,
        idDocumentUrl: bodyParsed.data.idDocumentUrl ?? null,
        isActive: true,
        activationStatus: "pending",
      })
      .returning();

    res.status(201).json(formatNominee(nominee));
  } catch (err) {
    req.log.error({ err }, "Failed to replace project nominee");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /projects/:id/nominee — admin only (soft-archive)
router.delete("/:id/nominee", requireRole("admin"), async (req, res) => {
  const parsed = RemoveProjectNomineeParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  try {
    await db
      .update(projectNomineesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(projectNomineesTable.projectId, parsed.data.id),
          eq(projectNomineesTable.isActive, true),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove project nominee");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

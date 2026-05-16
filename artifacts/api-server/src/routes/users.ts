import { Router } from "express";
import {
  db,
  usersTable,
  userProjectAssignmentsTable,
  activityTable,
  personMasterTable,
} from "@workspace/db";
import { eq, and, desc, or } from "drizzle-orm";
import { writeAudit } from "../lib/auditLogger";
import {
  UpdateUserRoleBody,
  AssignUserToProjectBody,
  UpdateUserProfileBody,
  UpdateProjectAssignmentBody,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";
import { z } from "zod/v4";

const router = Router();

// ── Helper: build a single user profile (with person_master join) ──────────
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

  // Look up linked person_master (if any)
  const pmRow = userRow
    ? (
        await db
          .select({
            id: personMasterTable.id,
            fullName: personMasterTable.fullName,
            kycStatus: personMasterTable.kycStatus,
          })
          .from(personMasterTable)
          .where(eq(personMasterTable.userId, userRow.id))
          .limit(1)
      )[0] ?? null
    : null;

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
    personMasterId: pmRow?.id ?? null,
    personMasterName: pmRow?.fullName ?? null,
    personMasterKycStatus: pmRow?.kycStatus ?? null,
  };
}

// GET /users — admin or developer
router.get("/", requireRole("admin", "developer"), async (req, res) => {
  try {
    const users = await db
      .select()
      .from(usersTable)
      .orderBy(usersTable.createdAt);

    const assignments = await db.select().from(userProjectAssignmentsTable);

    // Batch fetch all linked person_master records
    const personMasterRows = await db
      .select({
        userId: personMasterTable.userId,
        id: personMasterTable.id,
        fullName: personMasterTable.fullName,
        kycStatus: personMasterTable.kycStatus,
      })
      .from(personMasterTable)
      .where(
        or(...users.map((u) => eq(personMasterTable.userId, u.id))),
      );

    const pmByUserId = new Map(personMasterRows.map((r) => [r.userId, r]));

    const profiles = users.map((u) => {
      const active = assignments.filter(
        (a) => a.userId === u.id && !a.revokedAt,
      );
      const pm = pmByUserId.get(u.id) ?? null;
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
        personMasterId: pm?.id ?? null,
        personMasterName: pm?.fullName ?? null,
        personMasterKycStatus: pm?.kycStatus ?? null,
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

// ── POST /users/:clerkUserId/link-person ────────────────────────────────────
// Link a user account to a specific person_master record (admin only)
const linkPersonBody = z.object({ personMasterId: z.string().uuid() });

router.post(
  "/:clerkUserId/link-person",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const parsed = linkPersonBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "personMasterId (UUID) is required" });
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

      const [person] = await db
        .select({ id: personMasterTable.id, userId: personMasterTable.userId })
        .from(personMasterTable)
        .where(eq(personMasterTable.id, parsed.data.personMasterId))
        .limit(1);

      if (!person) {
        res.status(404).json({ error: "Person not found in registry" });
        return;
      }

      if (person.userId === userRow.id) {
        res.json({ personMasterId: person.id, action: "already_linked" });
        return;
      }

      await db
        .update(personMasterTable)
        .set({ userId: userRow.id })
        .where(eq(personMasterTable.id, person.id));

      req.log.info(
        { clerkUserId, personMasterId: person.id },
        "User manually linked to person_master",
      );

      res.json({ personMasterId: person.id, action: "linked" });
    } catch (err) {
      req.log.error({ err }, "Failed to link user to person_master");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/:clerkUserId/auto-link-person ────────────────────────────────
// Auto-match user → person_master by email/phone, or create a new record.
router.post(
  "/:clerkUserId/auto-link-person",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);

    try {
      const [userRow] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Check if already linked
      const [existing] = await db
        .select({ id: personMasterTable.id })
        .from(personMasterTable)
        .where(eq(personMasterTable.userId, userRow.id))
        .limit(1);

      if (existing) {
        res.json({
          personMasterId: existing.id,
          action: "already_linked",
          matchField: null,
        });
        return;
      }

      // Try matching by email
      if (userRow.email) {
        const [emailMatch] = await db
          .select({ id: personMasterTable.id, userId: personMasterTable.userId })
          .from(personMasterTable)
          .where(eq(personMasterTable.email, userRow.email))
          .limit(1);

        if (emailMatch && !emailMatch.userId) {
          await db
            .update(personMasterTable)
            .set({ userId: userRow.id })
            .where(eq(personMasterTable.id, emailMatch.id));

          req.log.info(
            { clerkUserId, personMasterId: emailMatch.id },
            "Auto-linked user to person_master by email",
          );

          res.json({
            personMasterId: emailMatch.id,
            action: "linked_by_email",
            matchField: "email",
          });
          return;
        }
      }

      // Try matching by phone
      if (userRow.phone) {
        const [phoneMatch] = await db
          .select({ id: personMasterTable.id, userId: personMasterTable.userId })
          .from(personMasterTable)
          .where(
            or(
              eq(personMasterTable.mobile, userRow.phone),
              eq(personMasterTable.alternateMobile, userRow.phone),
            ),
          )
          .limit(1);

        if (phoneMatch && !phoneMatch.userId) {
          await db
            .update(personMasterTable)
            .set({ userId: userRow.id })
            .where(eq(personMasterTable.id, phoneMatch.id));

          req.log.info(
            { clerkUserId, personMasterId: phoneMatch.id },
            "Auto-linked user to person_master by phone",
          );

          res.json({
            personMasterId: phoneMatch.id,
            action: "linked_by_phone",
            matchField: "phone",
          });
          return;
        }
      }

      // No match — create a new person_master record for this user
      const [newPerson] = await db
        .insert(personMasterTable)
        .values({
          fullName: userRow.displayName ?? userRow.email ?? "Unknown",
          email: userRow.email ?? undefined,
          mobile: userRow.phone ?? undefined,
          userId: userRow.id,
          createdBy: req.dbUserId ?? undefined,
        })
        .returning({ id: personMasterTable.id });

      req.log.info(
        { clerkUserId, personMasterId: newPerson.id },
        "Created new person_master for user",
      );

      res.json({
        personMasterId: newPerson.id,
        action: "created",
        matchField: null,
      });
    } catch (err) {
      req.log.error({ err }, "Failed to auto-link user to person_master");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

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

      writeAudit(req, {
        tableName: "user_project_assignments",
        recordId: `${userRow.id}:${projectId}`,
        operation: "DELETE",
        module: "admin",
        actionType: "project_assignment_removed",
        projectId,
        oldData: { userId: userRow.id, clerkUserId, projectId },
      });

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

import { Router } from "express";
import {
  db,
  usersTable,
  userProjectAssignmentsTable,
  activityTable,
  personMasterTable,
  userLoginAuditTable,
} from "@workspace/db";
import { eq, and, desc, or, isNull } from "drizzle-orm";
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

  // Look up linked person_master (if any) — check both forward link (users.personMasterId)
  // and reverse link (person_master.userId) for backwards compatibility.
  let pmRow: { id: string; fullName: string | null; kycStatus: string | null } | null = null;

  if (userRow) {
    if (userRow.personMasterId) {
      const rows = await db
        .select({ id: personMasterTable.id, fullName: personMasterTable.fullName, kycStatus: personMasterTable.kycStatus })
        .from(personMasterTable)
        .where(eq(personMasterTable.id, userRow.personMasterId))
        .limit(1);
      pmRow = rows[0] ?? null;
    } else {
      const rows = await db
        .select({ id: personMasterTable.id, fullName: personMasterTable.fullName, kycStatus: personMasterTable.kycStatus })
        .from(personMasterTable)
        .where(eq(personMasterTable.userId, userRow.id))
        .limit(1);
      pmRow = rows[0] ?? null;
    }
  }

  return {
    id: userRow?.id ?? null,
    clerkUserId: userRow?.clerkUserId ?? clerkUserId,
    role: userRow?.role ?? "employee",
    displayName: userRow?.displayName ?? null,
    email: userRow?.email ?? null,
    phone: userRow?.phone ?? null,
    address: userRow?.address ?? null,
    avatarUrl: userRow?.avatarUrl ?? null,
    idDocumentUrl: userRow?.idDocumentUrl ?? null,
    isActive: userRow?.isActive ?? true,
    loginStatus: userRow?.loginStatus ?? "pending_activation",
    loginStatusChangedAt: userRow?.loginStatusChangedAt?.toISOString() ?? null,
    lastLoginAt: userRow?.lastLoginAt?.toISOString() ?? null,
    personMasterId: pmRow?.id ?? userRow?.personMasterId ?? null,
    personMasterName: pmRow?.fullName ?? null,
    personMasterKycStatus: pmRow?.kycStatus ?? null,
    assignedProjectIds: activeAssignments.map((a) => a.projectId),
    projectAssignments: activeAssignments.map((a) => ({
      assignmentId: a.id,
      projectId: a.projectId,
      projectRole: a.projectRole ?? null,
    })),
    createdAt: (userRow?.createdAt ?? new Date()).toISOString(),
  };
}

// ── Helper: write a login audit event ─────────────────────────────────────
async function writeLoginAudit(
  userId: string,
  eventType: typeof userLoginAuditTable.$inferInsert["eventType"],
  performedBy: string | undefined,
  reason?: string,
  notes?: string,
) {
  await db.insert(userLoginAuditTable).values({
    userId,
    eventType,
    performedBy: performedBy ?? null,
    reason: reason ?? null,
    notes: notes ?? null,
  });
}

// GET /users — admin or developer
router.get("/", requireRole("admin", "developer"), async (req, res) => {
  try {
    const users = await db
      .select()
      .from(usersTable)
      .orderBy(usersTable.createdAt);

    const assignments = await db.select().from(userProjectAssignmentsTable);

    // Batch fetch all linked person_master records (forward + reverse links)
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

    // Also batch-fetch by forward personMasterId links
    const forwardLinkIds = users
      .map((u) => u.personMasterId)
      .filter((id): id is string => !!id);

    const forwardLinkRows =
      forwardLinkIds.length > 0
        ? await db
            .select({ id: personMasterTable.id, fullName: personMasterTable.fullName, kycStatus: personMasterTable.kycStatus })
            .from(personMasterTable)
            .where(or(...forwardLinkIds.map((id) => eq(personMasterTable.id, id))))
        : [];

    const pmByUserId = new Map(personMasterRows.map((r) => [r.userId, r]));
    const pmById = new Map(forwardLinkRows.map((r) => [r.id, r]));

    const profiles = users.map((u) => {
      const active = assignments.filter(
        (a) => a.userId === u.id && !a.revokedAt,
      );
      // Prefer forward link, fall back to reverse link
      const pm = (u.personMasterId ? pmById.get(u.personMasterId) : null) ?? pmByUserId.get(u.id) ?? null;
      return {
        id: u.id,
        clerkUserId: u.clerkUserId,
        role: u.role,
        displayName: u.displayName ?? null,
        email: u.email ?? null,
        phone: u.phone ?? null,
        address: u.address ?? null,
        avatarUrl: u.avatarUrl ?? null,
        idDocumentUrl: u.idDocumentUrl ?? null,
        isActive: u.isActive,
        loginStatus: u.loginStatus,
        loginStatusChangedAt: u.loginStatusChangedAt?.toISOString() ?? null,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        assignedProjectIds: active.map((a) => a.projectId),
        projectAssignments: active.map((a) => ({
          assignmentId: a.id,
          projectId: a.projectId,
          projectRole: a.projectRole ?? null,
        })),
        createdAt: u.createdAt.toISOString(),
        personMasterId: pm?.id ?? u.personMasterId ?? null,
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
    const [userRow] = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    await db
      .insert(usersTable)
      .values({ clerkUserId, role: parsed.data.role })
      .onConflictDoUpdate({
        target: usersTable.clerkUserId,
        set: { role: parsed.data.role, updatedAt: new Date() },
      });

    // Audit the role change
    if (userRow) {
      await writeLoginAudit(
        userRow.id,
        "account_type_changed",
        req.dbUserId,
        `Role changed from ${userRow.role} to ${parsed.data.role}`,
      );
    }

    res.json(await buildUserProfile(clerkUserId));
  } catch (err) {
    req.log.error({ err }, "Failed to update user role");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /users/pre-provision ────────────────────────────────────────────────
// Pre-provision a login record for a person before they sign up via Clerk.
// Uses a synthetic placeholder clerkUserId; linked to the real Clerk ID on
// first sign-in via email matching in PUT /me.
const preProvisionBody = z.object({
  personMasterId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  accountType: z.enum(["admin", "developer", "normal_user"]),
});

router.post(
  "/pre-provision",
  requireRole("admin"),
  async (req, res) => {
    const parsed = preProvisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const { personMasterId, email, displayName, phone, accountType } = parsed.data;

    // Map account type to internal role
    const roleMap: Record<string, "admin" | "developer" | "employee"> = {
      admin: "admin",
      developer: "developer",
      normal_user: "employee",
    };
    const role = roleMap[accountType];

    try {
      // Verify person_master exists
      const [person] = await db
        .select({ id: personMasterTable.id, userId: personMasterTable.userId })
        .from(personMasterTable)
        .where(eq(personMasterTable.id, personMasterId))
        .limit(1);

      if (!person) {
        res.status(400).json({ error: "Person not found in registry" });
        return;
      }

      // Prevent duplicate logins for the same person (via reverse link)
      if (person.userId) {
        res.status(400).json({
          error: "This person already has a login account linked via the registry.",
        });
        return;
      }

      // Check if email is already taken
      const [existing] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.email, email), isNull(usersTable.deletedAt)))
        .limit(1);

      if (existing) {
        res.status(400).json({ error: "A login account with this email already exists." });
        return;
      }

      // Create pre-provisioned record with placeholder clerkUserId
      const placeholderClerkId = `preprov_${crypto.randomUUID()}`;

      const [newUser] = await db
        .insert(usersTable)
        .values({
          clerkUserId: placeholderClerkId,
          email,
          displayName: displayName ?? null,
          phone: phone ?? null,
          role,
          personMasterId,
          loginStatus: "pending_activation",
          createdBy: req.dbUserId ?? null,
        })
        .returning();

      // Link person_master → user (reverse link for backwards compat)
      await db
        .update(personMasterTable)
        .set({ userId: newUser.id })
        .where(eq(personMasterTable.id, personMasterId));

      // Audit event
      await writeLoginAudit(
        newUser.id,
        "created",
        req.dbUserId,
        `Pre-provisioned by admin. Account type: ${accountType}`,
      );

      req.log.info({ userId: newUser.id, personMasterId }, "Login pre-provisioned");

      res.status(201).json(await buildUserProfile(placeholderClerkId));
    } catch (err) {
      req.log.error({ err }, "Failed to pre-provision login");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/:clerkUserId/activate ────────────────────────────────────────
const statusChangeBody = z.object({ reason: z.string().optional() });

router.post(
  "/:clerkUserId/activate",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const { reason } = statusChangeBody.parse(req.body ?? {});

    try {
      const [userRow] = await db
        .select({ id: usersTable.id, loginStatus: usersTable.loginStatus })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      await db
        .update(usersTable)
        .set({
          loginStatus: "active",
          loginStatusChangedAt: new Date(),
          loginStatusReason: reason ?? null,
          isActive: true,
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.clerkUserId, clerkUserId));

      await writeLoginAudit(userRow.id, "activated", req.dbUserId, reason);

      req.log.info({ clerkUserId, reason }, "Login account activated");
      res.json(await buildUserProfile(clerkUserId));
    } catch (err) {
      req.log.error({ err }, "Failed to activate login");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/:clerkUserId/suspend ─────────────────────────────────────────
router.post(
  "/:clerkUserId/suspend",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const { reason } = statusChangeBody.parse(req.body ?? {});

    try {
      const [userRow] = await db
        .select({ id: usersTable.id, loginStatus: usersTable.loginStatus })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (userRow.loginStatus === "archived") {
        res.status(400).json({ error: "Cannot suspend an archived account." });
        return;
      }

      await db
        .update(usersTable)
        .set({
          loginStatus: "suspended",
          loginStatusChangedAt: new Date(),
          loginStatusReason: reason ?? null,
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.clerkUserId, clerkUserId));

      await writeLoginAudit(userRow.id, "suspended", req.dbUserId, reason);

      req.log.info({ clerkUserId, reason }, "Login account suspended");
      res.json(await buildUserProfile(clerkUserId));
    } catch (err) {
      req.log.error({ err }, "Failed to suspend login");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/:clerkUserId/restore ─────────────────────────────────────────
router.post(
  "/:clerkUserId/restore",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const { reason } = statusChangeBody.parse(req.body ?? {});

    try {
      const [userRow] = await db
        .select({ id: usersTable.id, loginStatus: usersTable.loginStatus })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (userRow.loginStatus !== "suspended") {
        res.status(400).json({ error: "Only suspended accounts can be restored." });
        return;
      }

      await db
        .update(usersTable)
        .set({
          loginStatus: "active",
          loginStatusChangedAt: new Date(),
          loginStatusReason: reason ?? null,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.clerkUserId, clerkUserId));

      await writeLoginAudit(userRow.id, "restored", req.dbUserId, reason);

      req.log.info({ clerkUserId, reason }, "Login account restored");
      res.json(await buildUserProfile(clerkUserId));
    } catch (err) {
      req.log.error({ err }, "Failed to restore login");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/:clerkUserId/archive ─────────────────────────────────────────
router.post(
  "/:clerkUserId/archive",
  requireRole("admin"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const { reason } = statusChangeBody.parse(req.body ?? {});

    try {
      const [userRow] = await db
        .select({ id: usersTable.id, loginStatus: usersTable.loginStatus })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, clerkUserId))
        .limit(1);

      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (userRow.loginStatus === "archived") {
        res.status(400).json({ error: "Account is already archived." });
        return;
      }

      await db
        .update(usersTable)
        .set({
          loginStatus: "archived",
          loginStatusChangedAt: new Date(),
          loginStatusReason: reason ?? null,
          isActive: false,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(usersTable.clerkUserId, clerkUserId));

      await writeLoginAudit(userRow.id, "archived", req.dbUserId, reason);

      req.log.info({ clerkUserId, reason }, "Login account archived");
      res.json(await buildUserProfile(clerkUserId));
    } catch (err) {
      req.log.error({ err }, "Failed to archive login");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /users/:clerkUserId/login-audit ──────────────────────────────────────
router.get(
  "/:clerkUserId/login-audit",
  requireRole("admin", "developer"),
  async (req, res) => {
    const clerkUserId = String(req.params.clerkUserId);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

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

      const events = await db
        .select()
        .from(userLoginAuditTable)
        .where(eq(userLoginAuditTable.userId, userRow.id))
        .orderBy(desc(userLoginAuditTable.createdAt))
        .limit(limit);

      // Batch-resolve performer names
      const performerIds = [...new Set(events.map((e) => e.performedBy).filter((id): id is string => !!id))];
      const performers =
        performerIds.length > 0
          ? await db
              .select({ id: usersTable.id, displayName: usersTable.displayName })
              .from(usersTable)
              .where(or(...performerIds.map((id) => eq(usersTable.id, id))))
          : [];
      const performerMap = new Map(performers.map((p) => [p.id, p.displayName]));

      res.json(
        events.map((e) => ({
          id: e.id,
          userId: e.userId,
          eventType: e.eventType,
          performedBy: e.performedBy ?? null,
          performedByName: e.performedBy ? (performerMap.get(e.performedBy) ?? null) : null,
          reason: e.reason ?? null,
          notes: e.notes ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to get login audit");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/:clerkUserId/link-person ────────────────────────────────────
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

      // Update both forward and reverse links
      await db
        .update(usersTable)
        .set({ personMasterId: person.id, updatedAt: new Date() })
        .where(eq(usersTable.id, userRow.id));

      await db
        .update(personMasterTable)
        .set({ userId: userRow.id })
        .where(eq(personMasterTable.id, person.id));

      await writeLoginAudit(
        userRow.id,
        "person_linked",
        req.dbUserId,
        `Linked to person_master ${person.id}`,
      );

      req.log.info({ clerkUserId, personMasterId: person.id }, "User linked to person_master");
      res.json({ personMasterId: person.id, action: "linked" });
    } catch (err) {
      req.log.error({ err }, "Failed to link user to person_master");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /users/:clerkUserId/auto-link-person ────────────────────────────────
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

      // Check if already linked (forward link)
      if (userRow.personMasterId) {
        res.json({ personMasterId: userRow.personMasterId, action: "already_linked", matchField: null });
        return;
      }

      // Check if already linked (reverse link)
      const [existing] = await db
        .select({ id: personMasterTable.id })
        .from(personMasterTable)
        .where(eq(personMasterTable.userId, userRow.id))
        .limit(1);

      if (existing) {
        // Sync forward link
        await db.update(usersTable).set({ personMasterId: existing.id, updatedAt: new Date() }).where(eq(usersTable.id, userRow.id));
        res.json({ personMasterId: existing.id, action: "already_linked", matchField: null });
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
          await db.update(usersTable).set({ personMasterId: emailMatch.id, updatedAt: new Date() }).where(eq(usersTable.id, userRow.id));
          await db.update(personMasterTable).set({ userId: userRow.id }).where(eq(personMasterTable.id, emailMatch.id));
          await writeLoginAudit(userRow.id, "person_linked", req.dbUserId, "Auto-linked by email");
          req.log.info({ clerkUserId, personMasterId: emailMatch.id }, "Auto-linked by email");
          res.json({ personMasterId: emailMatch.id, action: "linked_by_email", matchField: "email" });
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
          await db.update(usersTable).set({ personMasterId: phoneMatch.id, updatedAt: new Date() }).where(eq(usersTable.id, userRow.id));
          await db.update(personMasterTable).set({ userId: userRow.id }).where(eq(personMasterTable.id, phoneMatch.id));
          await writeLoginAudit(userRow.id, "person_linked", req.dbUserId, "Auto-linked by phone");
          req.log.info({ clerkUserId, personMasterId: phoneMatch.id }, "Auto-linked by phone");
          res.json({ personMasterId: phoneMatch.id, action: "linked_by_phone", matchField: "phone" });
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

      await db.update(usersTable).set({ personMasterId: newPerson.id, updatedAt: new Date() }).where(eq(usersTable.id, userRow.id));
      await writeLoginAudit(userRow.id, "person_linked", req.dbUserId, "Person record created automatically");

      req.log.info({ clerkUserId, personMasterId: newPerson.id }, "Created new person_master for user");
      res.json({ personMasterId: newPerson.id, action: "created", matchField: null });
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

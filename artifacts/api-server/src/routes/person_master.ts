import { Router } from "express";
import {
  db,
  personMasterTable,
  personMasterAuditTable,
  personRoleAssignmentsTable,
  projectParticipantsTable,
  partnersTable,
  projectsTable,
} from "@workspace/db";
import { eq, or, ilike, and, isNull, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import { z } from "zod/v4";

const router = Router();

// ── Helper: write an audit event (fire-and-forget safe) ───────────────────
async function writeAudit(
  personMasterId: string,
  eventType: typeof personMasterAuditTable.$inferInsert["eventType"],
  description: string,
  performedBy: string | null | undefined,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(personMasterAuditTable).values({
    personMasterId,
    eventType,
    description,
    performedBy: performedBy ?? undefined,
    metadata: metadata ?? undefined,
  });
}

// ── GET /person-master — search / list ────────────────────────────────────
router.get("/", requireRole("admin", "developer"), async (req, res) => {
  const { q, aadhaar, mobile, kyc_status, limit = "50", offset = "0" } =
    req.query as Record<string, string>;

  try {
    // Build filter conditions
    const conditions = [];
    if (q) conditions.push(ilike(personMasterTable.fullName, `%${q}%`));
    if (aadhaar) {
      conditions.push(
        or(
          ilike(personMasterTable.aadhaarLast4, `%${aadhaar}%`),
          eq(personMasterTable.aadhaarNumber, aadhaar),
        ),
      );
    }
    if (mobile) {
      conditions.push(
        or(
          ilike(personMasterTable.mobile, `%${mobile}%`),
          ilike(personMasterTable.alternateMobile, `%${mobile}%`),
        ),
      );
    }
    if (kyc_status) {
      conditions.push(
        eq(
          personMasterTable.kycStatus,
          kyc_status as typeof personMasterTable.$inferSelect["kycStatus"],
        ),
      );
    }

    const rows = await db
      .select({
        id: personMasterTable.id,
        fullName: personMasterTable.fullName,
        fatherGuardianName: personMasterTable.fatherGuardianName,
        sOnCOn: personMasterTable.sOnCOn,
        aadhaarLast4: personMasterTable.aadhaarLast4,
        mobile: personMasterTable.mobile,
        email: personMasterTable.email,
        district: personMasterTable.district,
        state: personMasterTable.state,
        kycStatus: personMasterTable.kycStatus,
        aadhaarVerified: personMasterTable.aadhaarVerified,
        otpVerified: personMasterTable.otpVerified,
        userId: personMasterTable.userId,
        createdAt: personMasterTable.createdAt,
      })
      .from(personMasterTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(personMasterTable.fullName)
      .limit(Math.min(Number(limit), 200))
      .offset(Number(offset));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to search person_master");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /person-master/remediation ────────────────────────────────────────
router.get("/remediation", requireRole("admin"), async (req, res) => {
  try {
    const [unlinkedParticipants, unlinkedPartners, aadhaarDups, mobileDups] =
      await Promise.all([
        db
          .select({
            id: projectParticipantsTable.id,
            projectId: projectParticipantsTable.projectId,
            role: projectParticipantsTable.role,
            fullName: projectParticipantsTable.fullName,
            aadhaarNumber: projectParticipantsTable.aadhaarNumber,
            mobile: projectParticipantsTable.mobile,
          })
          .from(projectParticipantsTable)
          .where(isNull(projectParticipantsTable.personMasterId))
          .orderBy(projectParticipantsTable.fullName),

        db
          .select({
            id: partnersTable.id,
            name: partnersTable.name,
            role: partnersTable.role,
            aadhaarLast4: partnersTable.aadhaarLast4,
          })
          .from(partnersTable)
          .where(isNull(partnersTable.personMasterId))
          .orderBy(partnersTable.name),

        db.execute(sql`
          SELECT aadhaar_last4, COUNT(*)::int AS count
          FROM person_master
          WHERE aadhaar_last4 IS NOT NULL
          GROUP BY aadhaar_last4
          HAVING COUNT(*) > 1
        `),

        db.execute(sql`
          SELECT mobile, COUNT(*)::int AS count
          FROM person_master
          WHERE mobile IS NOT NULL
          GROUP BY mobile
          HAVING COUNT(*) > 1
        `),
      ]);

    res.json({
      unlinkedParticipants,
      unlinkedPartners,
      aadhaarDuplicates: aadhaarDups.rows,
      mobileDuplicates: mobileDups.rows,
      summary: {
        unlinkedParticipantCount: unlinkedParticipants.length,
        unlinkedPartnerCount: unlinkedPartners.length,
        aadhaarDuplicateGroups: aadhaarDups.rows.length,
        mobileDuplicateGroups: mobileDups.rows.length,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to run remediation scan");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /person-master/merge ─────────────────────────────────────────────
const mergeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  reason: z.string().min(10),
});

router.post("/merge", requireRole("admin"), async (req, res) => {
  const parsed = mergeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { sourceId, targetId, reason } = parsed.data;
  if (sourceId === targetId) {
    res.status(400).json({ error: "Source and target must be different records" });
    return;
  }

  try {
    await writeAudit(targetId, "duplicate_merged", `Absorbing source ${sourceId}. Reason: ${reason}`, req.dbUserId, { sourceId, reason });
    await writeAudit(sourceId, "duplicate_merged", `Merged into target ${targetId}. Reason: ${reason}`, req.dbUserId, { targetId, reason });

    await db.update(projectParticipantsTable).set({ personMasterId: targetId }).where(eq(projectParticipantsTable.personMasterId, sourceId));
    await db.update(partnersTable).set({ personMasterId: targetId }).where(eq(partnersTable.personMasterId, sourceId));

    const sourceRoles = await db.select().from(personRoleAssignmentsTable).where(eq(personRoleAssignmentsTable.personMasterId, sourceId));
    for (const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } of sourceRoles) {
      await db.insert(personRoleAssignmentsTable).values({ ...rest, personMasterId: targetId }).onConflictDoNothing();
    }

    res.json({ success: true, targetId, sourceId, message: "Source record merged into target." });
  } catch (err) {
    req.log.error({ err }, "Failed to merge person_master records");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /person-master/:id ────────────────────────────────────────────────
router.get("/:id", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);

  try {
    const [person] = await db
      .select()
      .from(personMasterTable)
      .where(eq(personMasterTable.id, id))
      .limit(1);

    if (!person) {
      res.status(404).json({ error: "Person not found" });
      return;
    }

    const [roles, projectLinks] = await Promise.all([
      db
        .select({
          id: personRoleAssignmentsTable.id,
          role: personRoleAssignmentsTable.role,
          projectId: personRoleAssignmentsTable.projectId,
          isActive: personRoleAssignmentsTable.isActive,
          notes: personRoleAssignmentsTable.notes,
          createdAt: personRoleAssignmentsTable.createdAt,
        })
        .from(personRoleAssignmentsTable)
        .where(eq(personRoleAssignmentsTable.personMasterId, id))
        .orderBy(personRoleAssignmentsTable.createdAt),

      db
        .select({
          participantId: projectParticipantsTable.id,
          projectId: projectParticipantsTable.projectId,
          role: projectParticipantsTable.role,
          projectName: projectsTable.name,
        })
        .from(projectParticipantsTable)
        .innerJoin(projectsTable, eq(projectsTable.id, projectParticipantsTable.projectId))
        .where(eq(projectParticipantsTable.personMasterId, id)),
    ]);

    // Never expose the full Aadhaar number in API responses
    const { aadhaarNumber: _redacted, ...safeFields } = person;
    res.json({ ...safeFields, roles, projectLinks });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch person_master profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /person-master ────────────────────────────────────────────────────
const createPersonSchema = z.object({
  fullName: z.string().min(2),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  aadhaarNumber: z.string().length(12).optional(),
  mobile: z.string().min(10).optional(),
  alternateMobile: z.string().optional(),
  email: z.string().email().optional(),
  permanentAddress: z.string().optional(),
  currentAddress: z.string().optional(),
  village: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  remarks: z.string().optional(),
});

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = createPersonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  try {
    if (data.aadhaarNumber) {
      const [dup] = await db
        .select({ id: personMasterTable.id, fullName: personMasterTable.fullName })
        .from(personMasterTable)
        .where(eq(personMasterTable.aadhaarNumber, data.aadhaarNumber))
        .limit(1);

      if (dup) {
        res.status(409).json({
          error: "duplicate_aadhaar",
          message: "A person with this Aadhaar number already exists in the registry.",
          existingId: dup.id,
          existingName: dup.fullName,
        });
        return;
      }
    }

    if (data.mobile) {
      const [dup] = await db
        .select({ id: personMasterTable.id, fullName: personMasterTable.fullName })
        .from(personMasterTable)
        .where(eq(personMasterTable.mobile, data.mobile))
        .limit(1);

      if (dup) {
        res.status(409).json({
          error: "duplicate_mobile",
          message: "A person with this mobile number already exists in the registry.",
          existingId: dup.id,
          existingName: dup.fullName,
        });
        return;
      }
    }

    const aadhaarLast4 = data.aadhaarNumber ? data.aadhaarNumber.slice(-4) : undefined;

    const [person] = await db
      .insert(personMasterTable)
      .values({ ...data, aadhaarLast4, createdBy: req.dbUserId })
      .returning();

    await writeAudit(
      person.id,
      "created",
      `Person master record created for ${person.fullName}`,
      req.dbUserId,
      { aadhaarLast4, mobile: data.mobile ? `XXXXXXX${data.mobile.slice(-4)}` : undefined },
    );

    const { aadhaarNumber: _redacted, ...safeFields } = person;
    res.status(201).json(safeFields);
  } catch (err) {
    req.log.error({ err }, "Failed to create person_master");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /person-master/:id ──────────────────────────────────────────────
const updatePersonSchema = z.object({
  fullName: z.string().min(2).optional(),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  alternateMobile: z.string().optional(),
  email: z.string().email().optional(),
  permanentAddress: z.string().optional(),
  currentAddress: z.string().optional(),
  village: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  kycStatus: z.enum(["pending", "documents_submitted", "verified", "flagged"]).optional(),
  aadhaarVerified: z.enum(["yes", "no", "pending"]).optional(),
  remarks: z.string().optional(),
});

router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  const parsed = updatePersonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [before] = await db
      .select()
      .from(personMasterTable)
      .where(eq(personMasterTable.id, id))
      .limit(1);

    if (!before) {
      res.status(404).json({ error: "Person not found" });
      return;
    }

    const [updated] = await db
      .update(personMasterTable)
      .set(parsed.data)
      .where(eq(personMasterTable.id, id))
      .returning();

    if (parsed.data.fullName && parsed.data.fullName !== before.fullName) {
      await writeAudit(id, "name_changed", `Name changed from "${before.fullName}" to "${parsed.data.fullName}"`, req.dbUserId, { before: before.fullName, after: parsed.data.fullName });
    }
    if (parsed.data.kycStatus && parsed.data.kycStatus !== before.kycStatus) {
      await writeAudit(id, "kyc_status_changed", `KYC status: ${before.kycStatus} → ${parsed.data.kycStatus}`, req.dbUserId, { before: before.kycStatus, after: parsed.data.kycStatus });
    }

    const { aadhaarNumber: _redacted, ...safeFields } = updated;
    res.json(safeFields);
  } catch (err) {
    req.log.error({ err }, "Failed to update person_master");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /person-master/:id/link-user ────────────────────────────────────
router.post("/:id/link-user", requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  const { userId } = req.body as { userId?: string };

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const [person] = await db
      .select({ id: personMasterTable.id, fullName: personMasterTable.fullName })
      .from(personMasterTable)
      .where(eq(personMasterTable.id, id))
      .limit(1);

    if (!person) {
      res.status(404).json({ error: "Person not found" });
      return;
    }

    await db.update(personMasterTable).set({ userId }).where(eq(personMasterTable.id, id));
    await writeAudit(id, "user_account_linked", `User account ${userId} linked to ${person.fullName}`, req.dbUserId, { userId });

    res.json({ success: true, personMasterId: id, userId });
  } catch (err) {
    req.log.error({ err }, "Failed to link user to person_master");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /person-master/:id/roles ────────────────────────────────────────
const assignRoleSchema = z.object({
  role: z.enum([
    "landowner", "developer", "investor", "buyer", "worker",
    "manager", "witness", "nominee", "economic_participant",
    "store_keeper", "collection_agent", "project_admin",
  ]),
  projectId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

router.post("/:id/roles", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  const parsed = assignRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [person] = await db
      .select({ id: personMasterTable.id, fullName: personMasterTable.fullName })
      .from(personMasterTable)
      .where(eq(personMasterTable.id, id))
      .limit(1);

    if (!person) {
      res.status(404).json({ error: "Person not found" });
      return;
    }

    // Use upsert via raw SQL for the nullable projectId composite unique
    const [assignment] = await db
      .insert(personRoleAssignmentsTable)
      .values({
        personMasterId: id,
        role: parsed.data.role,
        projectId: parsed.data.projectId ?? null,
        notes: parsed.data.notes,
        createdBy: req.dbUserId,
      })
      .onConflictDoNothing()
      .returning();

    await writeAudit(
      id,
      "role_assigned",
      `Role "${parsed.data.role}" assigned${parsed.data.projectId ? ` for project ${parsed.data.projectId}` : " (global)"}`,
      req.dbUserId,
      { role: parsed.data.role, projectId: parsed.data.projectId },
    );

    res.status(201).json(assignment ?? { personMasterId: id, role: parsed.data.role, note: "already assigned" });
  } catch (err) {
    req.log.error({ err }, "Failed to assign role on person_master");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /person-master/:id/roles/:roleId ───────────────────────────────
router.delete("/:id/roles/:roleId", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  const roleId = String(req.params.roleId);

  try {
    const [role] = await db
      .update(personRoleAssignmentsTable)
      .set({ isActive: false, deactivatedAt: new Date() })
      .where(
        and(
          eq(personRoleAssignmentsTable.id, roleId),
          eq(personRoleAssignmentsTable.personMasterId, id),
        ),
      )
      .returning();

    if (!role) {
      res.status(404).json({ error: "Role assignment not found" });
      return;
    }

    await writeAudit(id, "role_removed", `Role "${role.role}" deactivated`, req.dbUserId, { roleId, role: role.role });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove role from person_master");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /person-master/:id/audit ─────────────────────────────────────────
router.get("/:id/audit", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);

  try {
    const events = await db
      .select()
      .from(personMasterAuditTable)
      .where(eq(personMasterAuditTable.personMasterId, id))
      .orderBy(personMasterAuditTable.createdAt);

    res.json(events);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch person_master audit trail");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

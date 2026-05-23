import { Router } from "express";
import {
  db,
  personMasterTable,
  personMasterAuditTable,
  personRoleAssignmentsTable,
  personStatusHistoryTable,
  projectParticipantsTable,
  projectWitnessesTable,
  projectNomineesTable,
  partnerClaimantsTable,
  buyersTable,
  partnersTable,
  projectsTable,
  usersTable,
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
  const { q, aadhaar, mobile, kyc_status, status, limit = "50", offset = "0" } =
    req.query as Record<string, string>;

  try {
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
    if (status) {
      conditions.push(
        eq(
          personMasterTable.status,
          status as typeof personMasterTable.$inferSelect["status"],
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
        status: personMasterTable.status,
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
  panNumber: z.string().optional(),
  communicationPreference: z.enum(["mobile", "email", "whatsapp"]).optional(),
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
  panNumber: z.string().optional(),
  communicationPreference: z.enum(["mobile", "email", "whatsapp"]).optional(),
  bankAccountNumber: z.string().optional(),
  bankIfsc: z.string().optional(),
  bankName: z.string().optional(),
  bankBranch: z.string().optional(),
  bankAccountHolderName: z.string().optional(),
  bankAccountType: z.enum(["savings", "current"]).optional(),
  personNomineeName: z.string().optional(),
  personNomineeRelationship: z.string().optional(),
  personNomineeMobile: z.string().optional(),
  personNomineeAddress: z.string().optional(),
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

    // Audit sensitive field changes
    if (parsed.data.fullName && parsed.data.fullName !== before.fullName) {
      await writeAudit(id, "name_changed", `Name changed from "${before.fullName}" to "${parsed.data.fullName}"`, req.dbUserId, { before: before.fullName, after: parsed.data.fullName });
    }
    if (parsed.data.kycStatus && parsed.data.kycStatus !== before.kycStatus) {
      await writeAudit(id, "kyc_status_changed", `KYC status: ${before.kycStatus} → ${parsed.data.kycStatus}`, req.dbUserId, { before: before.kycStatus, after: parsed.data.kycStatus });
    }
    const bankFields = ["bankAccountNumber", "bankIfsc", "bankName", "bankBranch", "bankAccountHolderName", "bankAccountType"] as const;
    const bankChanged = bankFields.some((f) => parsed.data[f] !== undefined);
    if (bankChanged) {
      await writeAudit(id, "bank_updated", `Bank information updated`, req.dbUserId);
    }
    const nomineeFields = ["personNomineeName", "personNomineeRelationship", "personNomineeMobile", "personNomineeAddress"] as const;
    const nomineeChanged = nomineeFields.some((f) => parsed.data[f] !== undefined);
    if (nomineeChanged) {
      await writeAudit(id, "nominee_updated", `Person nominee information updated`, req.dbUserId);
    }
    if (parsed.data.panNumber !== undefined && parsed.data.panNumber !== before.panNumber) {
      await writeAudit(id, "pan_updated", `PAN number updated`, req.dbUserId);
    }
    const contactFields = ["email", "alternateMobile", "communicationPreference"] as const;
    const contactChanged = contactFields.some((f) => parsed.data[f] !== undefined && parsed.data[f] !== before[f]);
    if (contactChanged) {
      await writeAudit(id, "contact_updated", `Contact information updated`, req.dbUserId);
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

// ── POST /person-master/:id/status ───────────────────────────────────────
const statusChangeSchema = z.object({
  toStatus: z.enum(["active", "inactive", "deceased", "archived"]),
  reason: z.string().min(5),
  notes: z.string().optional(),
  dateOfDeath: z.string().optional(),
  deathRemarks: z.string().optional(),
});

router.post("/:id/status", requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  const parsed = statusChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { toStatus, reason, notes, dateOfDeath, deathRemarks } = parsed.data;

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

    // Deceased requires a date of death
    if (toStatus === "deceased" && !dateOfDeath) {
      res.status(400).json({ error: "dateOfDeath is required when marking a person as deceased" });
      return;
    }

    // Archive blocker check
    if (toStatus === "archived") {
      const blockers: { type: string; id: string; label: string }[] = [];

      // Check active project participants
      const activeParticipants = await db
        .select({
          id: projectParticipantsTable.id,
          projectName: projectsTable.name,
        })
        .from(projectParticipantsTable)
        .innerJoin(projectsTable, eq(projectsTable.id, projectParticipantsTable.projectId))
        .where(eq(projectParticipantsTable.personMasterId, id));

      for (const p of activeParticipants) {
        blockers.push({ type: "project_participant", id: p.id, label: `Project: ${p.projectName}` });
      }

      // Check active workforce assignments
      const activeAssignments = await db.execute(sql`
        SELECT wa.id, p.name AS project_name, wa.role
        FROM project_workforce_assignments wa
        JOIN projects p ON p.id = wa.project_id
        WHERE wa.person_id = ${id} AND wa.is_active = true
      `);
      for (const a of activeAssignments.rows as { id: string; project_name: string; role: string }[]) {
        blockers.push({ type: "workforce_assignment", id: a.id, label: `Assignment: ${a.role} — ${a.project_name}` });
      }

      // Check pending inheritance claims
      const pendingClaims = await db.execute(sql`
        SELECT pc.id, p.name AS project_name
        FROM partner_claimants pc
        JOIN projects p ON p.id = pc.project_id
        WHERE pc.person_master_id = ${id} AND pc.status NOT IN ('settled', 'rejected', 'withdrawn')
      `);
      for (const c of pendingClaims.rows as { id: string; project_name: string }[]) {
        blockers.push({ type: "inheritance_claim", id: c.id, label: `Inheritance claim — ${c.project_name}` });
      }

      // Check active nominees
      const activeNominees = await db.execute(sql`
        SELECT pn.id, p.name AS project_name
        FROM project_nominees pn
        JOIN projects p ON p.id = pn.project_id
        WHERE pn.person_master_id = ${id} AND pn.is_active = true
      `);
      for (const n of activeNominees.rows as { id: string; project_name: string }[]) {
        blockers.push({ type: "active_nominee", id: n.id, label: `Active nominee — ${n.project_name}` });
      }

      if (blockers.length > 0) {
        res.status(409).json({
          error: "archive_blocked",
          message: `This person cannot be archived because they are linked to ${blockers.length} active record(s). Resolve all active relationships first.`,
          blockers,
        });
        return;
      }
    }

    // Resolve actor name for snapshot
    let changedByName: string | undefined;
    if (req.dbUserId) {
      const [actor] = await db
        .select({ displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, req.dbUserId))
        .limit(1);
      changedByName = actor?.displayName ?? undefined;
    }

    // Build update payload
    const updatePayload: Partial<typeof personMasterTable.$inferInsert> = { status: toStatus };
    if (toStatus === "archived") {
      updatePayload.archivedAt = new Date();
      updatePayload.archivedBy = req.dbUserId ?? undefined;
    }
    if (toStatus === "deceased" && dateOfDeath) {
      updatePayload.dateOfDeath = dateOfDeath;
      if (deathRemarks) updatePayload.deathRemarks = deathRemarks;
    }
    // Restore: clear archived fields when moving back to active/inactive
    if (toStatus === "active" || toStatus === "inactive") {
      updatePayload.archivedAt = null as unknown as Date;
      updatePayload.archivedBy = null as unknown as string;
    }

    await db.update(personMasterTable).set(updatePayload).where(eq(personMasterTable.id, id));

    // Write status history (write-once)
    const [historyRow] = await db
      .insert(personStatusHistoryTable)
      .values({
        personMasterId: id,
        fromStatus: person.status,
        toStatus,
        changedBy: req.dbUserId ?? undefined,
        changedByName,
        reason,
        notes,
      })
      .returning();

    // Write audit event
    const auditType = toStatus === "archived" ? "archived"
      : toStatus === "deceased" ? "deceased_marked"
      : person.status === "archived" ? "restored"
      : "status_changed";

    await writeAudit(
      id,
      auditType,
      `Status changed: ${person.status} → ${toStatus}. Reason: ${reason}`,
      req.dbUserId,
      { fromStatus: person.status, toStatus, reason },
    );

    res.json(historyRow);
  } catch (err) {
    req.log.error({ err }, "Failed to change person_master status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /person-master/:id/status-history ────────────────────────────────
router.get("/:id/status-history", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);

  try {
    const history = await db
      .select()
      .from(personStatusHistoryTable)
      .where(eq(personStatusHistoryTable.personMasterId, id))
      .orderBy(personStatusHistoryTable.createdAt);

    res.json(history);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch person_master status history");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /person-master/:id/relationships ─────────────────────────────────
router.get("/:id/relationships", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);

  try {
    const [person] = await db
      .select({ id: personMasterTable.id })
      .from(personMasterTable)
      .where(eq(personMasterTable.id, id))
      .limit(1);

    if (!person) {
      res.status(404).json({ error: "Person not found" });
      return;
    }

    const [
      projectParticipations,
      partnerLinks,
      witnesses,
      nominees,
      claimants,
      buyerLinks,
      workforceRaw,
    ] = await Promise.all([
      db
        .select({
          id: projectParticipantsTable.id,
          projectId: projectParticipantsTable.projectId,
          projectName: projectsTable.name,
          role: projectParticipantsTable.role,
        })
        .from(projectParticipantsTable)
        .innerJoin(projectsTable, eq(projectsTable.id, projectParticipantsTable.projectId))
        .where(eq(projectParticipantsTable.personMasterId, id)),

      db
        .select({
          id: partnersTable.id,
          name: partnersTable.name,
          role: partnersTable.role,
        })
        .from(partnersTable)
        .where(eq(partnersTable.personMasterId, id)),

      db
        .select({
          id: projectWitnessesTable.id,
          projectId: projectWitnessesTable.projectId,
          projectName: projectsTable.name,
          fullName: projectWitnessesTable.fullName,
        })
        .from(projectWitnessesTable)
        .innerJoin(projectsTable, eq(projectsTable.id, projectWitnessesTable.projectId))
        .where(eq(projectWitnessesTable.personMasterId, id)),

      db
        .select({
          id: projectNomineesTable.id,
          projectId: projectNomineesTable.projectId,
          projectName: projectsTable.name,
          nomineeName: projectNomineesTable.nomineeName,
          activationStatus: projectNomineesTable.activationStatus,
        })
        .from(projectNomineesTable)
        .innerJoin(projectsTable, eq(projectsTable.id, projectNomineesTable.projectId))
        .where(eq(projectNomineesTable.personMasterId, id)),

      db
        .select({
          id: partnerClaimantsTable.id,
          projectId: partnerClaimantsTable.projectId,
          projectName: projectsTable.name,
          claimantName: partnerClaimantsTable.claimantName,
          status: partnerClaimantsTable.status,
        })
        .from(partnerClaimantsTable)
        .innerJoin(projectsTable, eq(projectsTable.id, partnerClaimantsTable.projectId))
        .where(eq(partnerClaimantsTable.personMasterId, id)),

      db
        .select({
          id: buyersTable.id,
          name: buyersTable.name,
          buyerType: buyersTable.buyerType,
        })
        .from(buyersTable)
        .where(eq(buyersTable.personMasterId, id)),

      db.execute(sql`
        SELECT wa.id, wa.project_id, p.name AS project_name, wa.role, wa.is_active
        FROM project_workforce_assignments wa
        JOIN projects p ON p.id = wa.project_id
        WHERE wa.person_id = ${id}
        ORDER BY wa.created_at DESC
      `),
    ]);

    const workforceAssignments = (workforceRaw.rows as { id: string; project_id: string; project_name: string; role: string; is_active: boolean }[]).map(
      (r) => ({ id: r.id, projectId: r.project_id, projectName: r.project_name, role: r.role, isActive: r.is_active }),
    );

    res.json({
      projectParticipations,
      workforceAssignments,
      nominees,
      claimants,
      buyerLinks,
      partnerLinks,
      witnesses,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch person_master relationships");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

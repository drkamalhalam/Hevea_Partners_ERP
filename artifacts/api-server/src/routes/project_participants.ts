import { Router } from "express";
import { db, projectParticipantsTable, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { applyGovernanceValidation } from "../lib/landownerGovernance";
import { writeProjectAudit, diffFields } from "../lib/projectAuditLogger";

const router = Router();

// personMasterId is required — every participant must be linked to a
// Person Registry entry. Identity is sourced from there; the local fields
// below are denormalised copies kept for backward-compat.
//
// CANONICAL PARTICIPANT ROLE SET (Architecture Correction Pass, May 2026):
// Only these five roles belong in project onboarding. Nominees, claimants,
// and witnesses are managed by their dedicated systems:
//   - nominee  → Person Registry / Nominee Management / Nominee Activation
//   - claimant → Inheritance & Succession workflows
//   - witness  → project_witnesses table (Witnesses wizard step)
// Historical rows containing the removed roles remain visible via GET, but
// new writes via PUT will be rejected by the Zod enum below.
export const PARTICIPANT_ROLES = [
  "landowner",
  "developer",
  "investor",
  "partner",
  "other",
] as const;

/** Legacy roles that may still exist on old rows but cannot be created. */
export const LEGACY_DISALLOWED_PARTICIPANT_ROLES = [
  "nominee",
  "claimant",
  "witness",
] as const;

const participantSchema = z.object({
  role: z.enum(PARTICIPANT_ROLES),
  personMasterId: z.string().uuid({
    error: "personMasterId is required — link the participant to a Person Registry entry first.",
  }),
  fullName: z.string().min(1),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  aadhaarObjectPath: z.string().optional(),
  supportingIdObjectPath: z.string().optional(),
});

// GET /:projectId/onboarding/participants
router.get("/:projectId/onboarding/participants", requireRole("admin", "developer", "landowner", "investor", "employee", "operational_staff"), async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const rows = await db
    .select()
    .from(projectParticipantsTable)
    .where(eq(projectParticipantsTable.projectId, projectId))
    .orderBy(projectParticipantsTable.role);
  res.set("Cache-Control", "no-store");
  res.json({ participants: rows });
});

// PUT /:projectId/onboarding/participants/:role — upsert
router.put("/:projectId/onboarding/participants/:role", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const role = String(req.params.role);
  if (!(PARTICIPANT_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({
      error: `role must be one of: ${PARTICIPANT_ROLES.join(", ")}`,
    });
    return;
  }

  const parsedEarly = participantSchema.safeParse({ ...req.body, role });
  const incomingPersonId =
    parsedEarly.success ? parsedEarly.data.personMasterId : null;

  const [existing] = await db
    .select()
    .from(projectParticipantsTable)
    .where(
      and(
        eq(projectParticipantsTable.projectId, projectId),
        eq(projectParticipantsTable.role, role),
        ...(incomingPersonId
          ? [eq(projectParticipantsTable.personMasterId, incomingPersonId)]
          : []),
      ),
    )
    .limit(1);

  const project = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project.length) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const parsed = participantSchema.safeParse({ ...req.body, role });
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const payload = {
    projectId,
    role,
    fullName: parsed.data.fullName,
    sOnCOn: parsed.data.sOnCOn ?? null,
    fatherGuardianName: parsed.data.fatherGuardianName ?? null,
    aadhaarNumber: parsed.data.aadhaarNumber ?? null,
    mobile: parsed.data.mobile ?? null,
    address: parsed.data.address ?? null,
    email: parsed.data.email || null,
    aadhaarObjectPath: parsed.data.aadhaarObjectPath ?? null,
    supportingIdObjectPath: parsed.data.supportingIdObjectPath ?? null,
    personMasterId: parsed.data.personMasterId,
    createdBy: req.dbUserId ?? null,
  };

  const [row] = await db
    .insert(projectParticipantsTable)
    .values(payload)
    .onConflictDoUpdate({
      target: [
        projectParticipantsTable.projectId,
        projectParticipantsTable.role,
        projectParticipantsTable.personMasterId,
      ],
      set: {
        fullName: payload.fullName,
        sOnCOn: payload.sOnCOn,
        fatherGuardianName: payload.fatherGuardianName,
        aadhaarNumber: payload.aadhaarNumber,
        mobile: payload.mobile,
        address: payload.address,
        email: payload.email,
        aadhaarObjectPath: payload.aadhaarObjectPath,
        supportingIdObjectPath: payload.supportingIdObjectPath,
        personMasterId: payload.personMasterId,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Audit trail
  if (!existing) {
    await writeProjectAudit(req, {
      projectId,
      eventType: "participant_added",
      entityType: "project_participant",
      entityId: row.id,
      title: `Participant added: ${role} (${row.fullName})`,
      afterData: row as unknown as Record<string, unknown>,
    });
  } else {
    const diff = diffFields(
      existing as unknown as Record<string, unknown>,
      payload as unknown as Record<string, unknown>,
    );
    if (diff.changedKeys.length > 0) {
      await writeProjectAudit(req, {
        projectId,
        eventType: "participant_updated",
        entityType: "project_participant",
        entityId: row.id,
        title: `Participant updated: ${role} (${diff.changedKeys.join(", ")})`,
        beforeData: diff.before,
        afterData: diff.after,
        metadata: { changedKeys: diff.changedKeys },
      });
    }
  }

  // Landowner added/updated: re-validate project governance (may unlock a previously locked project)
  if (role === "landowner") {
    await applyGovernanceValidation(projectId, req.log);
  }

  res.json({ participant: row });
});

// DELETE /:projectId/onboarding/participants/:role
router.delete("/:projectId/onboarding/participants/:role", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const role = String(req.params.role);
  // Optional disambiguator: when multiple persons hold the same role (e.g.
  // several investors) the caller MUST scope the delete to a single
  // personMasterId. Without it, we'd coarsely wipe every row for that role.
  const personMasterIdRaw = req.query.personMasterId;
  const personMasterId =
    typeof personMasterIdRaw === "string" && personMasterIdRaw.length > 0
      ? personMasterIdRaw
      : undefined;

  const baseWhere = personMasterId
    ? and(
        eq(projectParticipantsTable.projectId, projectId),
        eq(projectParticipantsTable.role, role),
        eq(projectParticipantsTable.personMasterId, personMasterId),
      )
    : and(
        eq(projectParticipantsTable.projectId, projectId),
        eq(projectParticipantsTable.role, role),
      );

  const matches = await db
    .select()
    .from(projectParticipantsTable)
    .where(baseWhere);

  if (matches.length > 1 && !personMasterId) {
    res.status(409).json({
      error:
        "Multiple participants hold this role on this project. Supply ?personMasterId=… to target a specific row.",
      code: "PARTICIPANT_AMBIGUOUS",
      candidates: matches.map((m) => ({
        id: m.id,
        personMasterId: m.personMasterId,
        fullName: m.fullName,
      })),
    });
    return;
  }

  const existing = matches[0];

  await db.delete(projectParticipantsTable).where(baseWhere);

  if (existing) {
    await writeProjectAudit(req, {
      projectId,
      eventType: "participant_removed",
      entityType: "project_participant",
      entityId: existing.id,
      title: `Participant removed: ${role} (${existing.fullName})`,
      beforeData: existing as unknown as Record<string, unknown>,
    });
  }

  // Landowner removed: re-validate (will mark project governance-locked if no landowner remains)
  if (role === "landowner") {
    await applyGovernanceValidation(projectId, req.log);
  }

  res.json({ ok: true });
});

export default router;

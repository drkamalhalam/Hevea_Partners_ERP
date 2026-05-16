import { Router } from "express";
import { db, projectParticipantsTable, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/auth";
import { applyGovernanceValidation } from "../lib/landownerGovernance";

const router = Router();

const participantSchema = z.object({
  role: z.enum(["developer", "landowner"]),
  fullName: z.string().min(1),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  aadhaarObjectPath: z.string().optional(),
  supportingIdObjectPath: z.string().optional(),
  personMasterId: z.string().uuid().optional(),
});

// GET /:projectId/onboarding/participants
router.get("/:projectId/onboarding/participants", requireRole("admin", "developer", "landowner", "investor", "employee", "operational_staff"), async (req, res) => {
  const projectId = String(req.params.projectId);
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
  const role = String(req.params.role);
  if (role !== "developer" && role !== "landowner") {
    res.status(400).json({ error: "role must be developer or landowner" });
    return;
  }

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
    personMasterId: parsed.data.personMasterId ?? null,
    createdBy: req.dbUserId ?? null,
  };

  const [row] = await db
    .insert(projectParticipantsTable)
    .values(payload)
    .onConflictDoUpdate({
      target: [projectParticipantsTable.projectId, projectParticipantsTable.role],
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

  // Landowner added/updated: re-validate project governance (may unlock a previously locked project)
  if (role === "landowner") {
    await applyGovernanceValidation(projectId, req.log);
  }

  res.json({ participant: row });
});

// DELETE /:projectId/onboarding/participants/:role
router.delete("/:projectId/onboarding/participants/:role", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  const role = String(req.params.role);
  await db
    .delete(projectParticipantsTable)
    .where(
      and(
        eq(projectParticipantsTable.projectId, projectId),
        eq(projectParticipantsTable.role, role),
      ),
    );

  // Landowner removed: re-validate (will mark project governance-locked if no landowner remains)
  if (role === "landowner") {
    await applyGovernanceValidation(projectId, req.log);
  }

  res.json({ ok: true });
});

export default router;

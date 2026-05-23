import { Router } from "express";
import {
  db,
  projectsTable,
  projectParticipantsTable,
  projectWitnessesTable,
  projectCreationOtpsTable,
  projectParcelsTable,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { writeProjectAudit } from "../lib/projectAuditLogger";

const router = Router();

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// GET /:id/onboarding/state
router.get("/:id/onboarding/state", requireRole("admin", "developer", "landowner"), async (req, res) => {
  const id = String(req.params.id);
  if (!canAccessProject(req, id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const participants = await db
    .select()
    .from(projectParticipantsTable)
    .where(eq(projectParticipantsTable.projectId, id));

  const witnesses = await db
    .select()
    .from(projectWitnessesTable)
    .where(eq(projectWitnessesTable.projectId, id))
    .orderBy(projectWitnessesTable.position);

  const otps = await db
    .select()
    .from(projectCreationOtpsTable)
    .where(eq(projectCreationOtpsTable.projectId, id))
    .orderBy(desc(projectCreationOtpsTable.createdAt));

  const developerOtp = otps.find((o) => o.role === "developer");
  const landownerOtp = otps.find((o) => o.role === "landowner");

  const developerParticipant = participants.find((p) => p.role === "developer");
  const landownerParticipant = participants.find((p) => p.role === "landowner");

  res.json({
    project,
    participants,
    witnesses,
    otpStatus: {
      developer: {
        sent: !!developerOtp,
        verified: !!developerOtp?.verifiedAt,
        phone: developerOtp?.phone ?? developerParticipant?.mobile ?? null,
      },
      landowner: {
        sent: !!landownerOtp,
        verified: !!landownerOtp?.verifiedAt,
        phone: landownerOtp?.phone ?? landownerParticipant?.mobile ?? null,
      },
    },
    completionChecks: {
      basicInfo: !!(project.name && project.startDate),
      developerInfo: !!developerParticipant?.fullName,
      landownerInfo: !!landownerParticipant?.fullName,
      landDetails: !!(project.landType && project.landArea),
      financialConfig: !!(project.landArea),
      agreementDetails: !!(project.agreementType || project.agreementEffectiveDate),
      witnessDetails: witnesses.length >= 1,
      documentsUploaded: !!(developerParticipant?.aadhaarObjectPath || landownerParticipant?.aadhaarObjectPath),
      developerOtpVerified: !!developerOtp?.verifiedAt,
      landownerOtpVerified: !!landownerOtp?.verifiedAt,
    },
  });
});

// POST /:id/onboarding/send-otp
router.post("/:id/onboarding/send-otp", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  if (!canAccessProject(req, id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const parsed = z.object({
    role: z.enum(["developer", "landowner"]),
    phone: z.string().min(10),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const [project] = await db
    .select({ id: projectsTable.id, activationStatus: projectsTable.activationStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const [row] = await db
    .insert(projectCreationOtpsTable)
    .values({
      projectId: id,
      role: parsed.data.role,
      phone: parsed.data.phone,
      otpCode: otp,
      expiresAt,
      attempts: 0,
    })
    .returning();

  res.json({
    ok: true,
    otpId: row.id,
    expiresAt: row.expiresAt,
    devOtp: process.env.NODE_ENV !== "production" ? otp : undefined,
  });
});

// POST /:id/onboarding/verify-otp
router.post("/:id/onboarding/verify-otp", requireRole("admin", "developer", "landowner"), async (req, res) => {
  const id = String(req.params.id);
  if (!canAccessProject(req, id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const parsed = z.object({
    role: z.enum(["developer", "landowner"]),
    otpCode: z.string().length(6),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const [latestOtp] = await db
    .select()
    .from(projectCreationOtpsTable)
    .where(
      and(
        eq(projectCreationOtpsTable.projectId, id),
        eq(projectCreationOtpsTable.role, parsed.data.role),
      ),
    )
    .orderBy(desc(projectCreationOtpsTable.createdAt))
    .limit(1);

  if (!latestOtp) {
    res.status(404).json({ error: "No OTP found. Please request a new OTP." });
    return;
  }

  if (latestOtp.verifiedAt) {
    res.json({ ok: true, alreadyVerified: true });
    return;
  }

  if (new Date() > latestOtp.expiresAt) {
    res.status(410).json({ error: "OTP has expired. Please request a new one." });
    return;
  }

  if (latestOtp.attempts >= 5) {
    res.status(429).json({ error: "Too many attempts. Please request a new OTP." });
    return;
  }

  if (latestOtp.otpCode !== parsed.data.otpCode) {
    await db
      .update(projectCreationOtpsTable)
      .set({ attempts: (latestOtp.attempts || 0) + 1 })
      .where(eq(projectCreationOtpsTable.id, latestOtp.id));
    res.status(400).json({ error: "Incorrect OTP.", attemptsLeft: 5 - (latestOtp.attempts + 1) });
    return;
  }

  await db
    .update(projectCreationOtpsTable)
    .set({ verifiedAt: new Date() })
    .where(eq(projectCreationOtpsTable.id, latestOtp.id));

  res.json({ ok: true, role: parsed.data.role, verifiedAt: new Date() });
});

// POST /:id/onboarding/activate — final activation after dual OTP
router.post("/:id/onboarding/activate", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  if (!canAccessProject(req, id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (project.activationStatus === "active") {
    res.status(409).json({ error: "Project is already active." });
    return;
  }

  const otps = await db
    .select()
    .from(projectCreationOtpsTable)
    .where(eq(projectCreationOtpsTable.projectId, id))
    .orderBy(desc(projectCreationOtpsTable.createdAt));

  const devOtp = otps.find((o) => o.role === "developer");
  const loOtp = otps.find((o) => o.role === "landowner");

  if (!devOtp?.verifiedAt) {
    res.status(422).json({ error: "Developer OTP not yet verified." });
    return;
  }
  if (!loOtp?.verifiedAt) {
    res.status(422).json({ error: "Landowner OTP not yet verified." });
    return;
  }

  // Project must have core governance fields set before activation.
  if (!project.commercialModel) {
    res.status(422).json({
      error: "Commercial model must be set before activation.",
    });
    return;
  }
  if (!project.projectType) {
    res.status(422).json({
      error: "Project type must be selected before activation.",
    });
    return;
  }

  // Participant gate: at least one landowner AND one developer participant
  // row must exist (mirrors the wizard Review checklist 1:1).
  const participantRows = await db
    .select({ role: projectParticipantsTable.role })
    .from(projectParticipantsTable)
    .where(eq(projectParticipantsTable.projectId, id));
  const hasLandowner = participantRows.some((p) => p.role === "landowner");
  const hasDeveloper = participantRows.some((p) => p.role === "developer");
  if (!hasLandowner) {
    res.status(422).json({
      error: "At least one landowner participant is required before activation.",
    });
    return;
  }
  if (!hasDeveloper) {
    res.status(422).json({
      error: "At least one developer participant is required before activation.",
    });
    return;
  }

  const witnesses = await db
    .select({ id: projectWitnessesTable.id })
    .from(projectWitnessesTable)
    .where(eq(projectWitnessesTable.projectId, id));

  if (witnesses.length < 1) {
    res.status(422).json({ error: "At least 1 witness is required before activation." });
    return;
  }

  // ── Prompt 6 gates: at least one Schedule A parcel and a linked agreement template
  const parcelRows = await db
    .select({ id: projectParcelsTable.id })
    .from(projectParcelsTable)
    .where(eq(projectParcelsTable.projectId, id));

  if (parcelRows.length < 1) {
    res.status(422).json({
      error: "Schedule A is empty — at least one parcel is required before activation.",
    });
    return;
  }

  if (!project.agreementTemplateId) {
    res.status(422).json({
      error: "An agreement template must be linked to the project before activation.",
    });
    return;
  }

  const [updated] = await db
    .update(projectsTable)
    .set({
      activationStatus: "active",
      onboardingCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, id))
    .returning();

  req.log.info({ projectId: id }, "project activated via onboarding wizard");

  await writeProjectAudit(req, {
    projectId: id,
    eventType: "activated",
    entityType: "project",
    entityId: id,
    title: `Project activated`,
    afterData: { activationStatus: "active" },
  });

  res.json({ project: updated });
});

// PATCH /:id/onboarding/step — advance/save wizard step
router.patch("/:id/onboarding/step", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  const parsed = z.object({ step: z.number().int().min(1).max(10) }).safeParse(req.body);
  // NB: max is 10 for backward compatibility with persisted drafts created
  // against the legacy 10-step wizard. Current UI tops out at 8.
  if (!parsed.success) {
    res.status(422).json({ error: "Invalid step" });
    return;
  }

  const [updated] = await db
    .update(projectsTable)
    .set({ onboardingStep: parsed.data.step, updatedAt: new Date() })
    .where(eq(projectsTable.id, id))
    .returning({ id: projectsTable.id, onboardingStep: projectsTable.onboardingStep });

  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ ok: true, onboardingStep: updated.onboardingStep });
});

export default router;

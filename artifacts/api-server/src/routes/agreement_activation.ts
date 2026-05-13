import { Router } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  db,
  agreementsTable,
  agreementActivationsTable,
  agreementActivationOtpsTable,
  partnersTable,
  usersTable,
  auditLogsTable,
  projectsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import {
  InitiateAgreementActivationBody,
  CancelAgreementActivationBody,
  VerifyAgreementActivationOtpBody,
} from "@workspace/api-zod";

const router = Router();

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

type OtpRow = typeof agreementActivationOtpsTable.$inferSelect;
type ActivationRow = typeof agreementActivationsTable.$inferSelect;

function formatOtp(otp: OtpRow, exposeCode = false) {
  return {
    id: otp.id,
    activationId: otp.activationId,
    partyRole: otp.partyRole,
    partyName: otp.partyName,
    partyPhone: otp.partyPhone ?? null,
    partnerId: otp.partnerId ?? null,
    status: otp.status,
    otpCodePlaceholder: exposeCode ? otp.otpCode : null,
    sentAt: otp.sentAt?.toISOString() ?? null,
    verifiedAt: otp.verifiedAt?.toISOString() ?? null,
    expiresAt: otp.expiresAt?.toISOString() ?? null,
    verifiedBy: otp.verifiedBy ?? null,
    attempts: otp.attempts,
    createdAt: otp.createdAt.toISOString(),
  };
}

function formatActivation(activation: ActivationRow, otpTasks: OtpRow[]) {
  return {
    id: activation.id,
    agreementId: activation.agreementId,
    status: activation.status,
    initiatedBy: activation.initiatedBy ?? null,
    initiatedByName: activation.initiatedByName ?? null,
    completedAt: activation.completedAt?.toISOString() ?? null,
    cancelledBy: activation.cancelledBy ?? null,
    cancelledAt: activation.cancelledAt?.toISOString() ?? null,
    cancellationReason: activation.cancellationReason ?? null,
    notes: activation.notes ?? null,
    createdAt: activation.createdAt.toISOString(),
    updatedAt: activation.updatedAt?.toISOString() ?? null,
    otpTasks: otpTasks.map((otp) =>
      formatOtp(otp, otp.status === "sent"),
    ),
  };
}

async function fetchActivationWithOtps(activationId: string) {
  const [activation] = await db
    .select()
    .from(agreementActivationsTable)
    .where(eq(agreementActivationsTable.id, activationId))
    .limit(1);
  if (!activation) return null;

  const otpTasks = await db
    .select()
    .from(agreementActivationOtpsTable)
    .where(eq(agreementActivationOtpsTable.activationId, activationId))
    .orderBy(agreementActivationOtpsTable.partyRole);

  return formatActivation(activation, otpTasks);
}

async function resolveActingUser(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return { id: undefined as string | undefined, name: undefined as string | undefined };
  const [row] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return { id: row?.id, name: row?.displayName ?? undefined };
}

function writeAuditLog(
  recordId: string,
  tableName: string,
  operation: "INSERT" | "UPDATE" | "DELETE",
  _summary: string,
  userId: string | undefined,
  _performedByName: string | undefined,
  newData: Record<string, unknown>,
) {
  db.insert(auditLogsTable)
    .values({
      recordId,
      tableName,
      operation,
      userId: userId ?? null,
      newData,
    })
    .catch(() => {/* fire-and-forget */});
}

// ── GET /pending-activation ──────────────────────────────────────────────────
// Returns all agreements in pending_activation status with their active
// activation record.  Admin/developer only.

router.get(
  "/pending-activation",
  requireRole("admin", "developer"),
  async (req, res) => {
    const pendingAgreements = await db
      .select({
        id: agreementsTable.id,
        projectId: agreementsTable.projectId,
        landOwnerId: agreementsTable.landOwnerId,
        projectDeveloperId: agreementsTable.projectDeveloperId,
        executionDate: agreementsTable.executionDate,
        status: agreementsTable.status,
      })
      .from(agreementsTable)
      .where(
        and(
          eq(agreementsTable.status, "pending_activation"),
        ),
      );

    if (pendingAgreements.length === 0) {
      res.json([]);
      return;
    }

    const agreementIds = pendingAgreements.map((a) => a.id);
    const projectIds = [...new Set(pendingAgreements.map((a) => a.projectId))];
    const partnerIds = [
      ...new Set([
        ...pendingAgreements.map((a) => a.landOwnerId),
        ...pendingAgreements.map((a) => a.projectDeveloperId),
      ]),
    ];

    const [projects, partners, activations] = await Promise.all([
      db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(inArray(projectsTable.id, projectIds)),
      db
        .select({ id: partnersTable.id, name: partnersTable.name })
        .from(partnersTable)
        .where(inArray(partnersTable.id, partnerIds)),
      db
        .select()
        .from(agreementActivationsTable)
        .where(
          and(
            inArray(agreementActivationsTable.agreementId, agreementIds),
            eq(agreementActivationsTable.status, "pending_otp"),
          ),
        )
        .orderBy(desc(agreementActivationsTable.createdAt)),
    ]);

    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const partnerMap = Object.fromEntries(partners.map((p) => [p.id, p.name]));

    // Get OTP tasks for all activations
    const activationIds = activations.map((a) => a.id);
    const allOtpTasks =
      activationIds.length > 0
        ? await db
            .select()
            .from(agreementActivationOtpsTable)
            .where(
              inArray(agreementActivationOtpsTable.activationId, activationIds),
            )
        : [];

    // Group OTP tasks by activationId
    const otpsByActivation: Record<string, OtpRow[]> = {};
    for (const otp of allOtpTasks) {
      if (!otpsByActivation[otp.activationId]) {
        otpsByActivation[otp.activationId] = [];
      }
      otpsByActivation[otp.activationId].push(otp);
    }

    // Latest pending activation per agreement
    const latestActivationByAgreement: Record<string, typeof activations[0]> = {};
    for (const activation of activations) {
      if (!latestActivationByAgreement[activation.agreementId]) {
        latestActivationByAgreement[activation.agreementId] = activation;
      }
    }

    const result = pendingAgreements.map((agreement) => {
      const activation = latestActivationByAgreement[agreement.id];
      const otpTasks = activation ? (otpsByActivation[activation.id] ?? []) : [];

      return {
        agreementId: agreement.id,
        projectName: projectMap[agreement.projectId] ?? "Unknown",
        landOwnerName: partnerMap[agreement.landOwnerId] ?? "Unknown",
        projectDeveloperName: partnerMap[agreement.projectDeveloperId] ?? "Unknown",
        agreementStatus: agreement.status,
        executionDate: agreement.executionDate,
        activation: activation
          ? formatActivation(activation, otpTasks)
          : null,
      };
    });

    res.json(result);
  },
);

// ── GET /:id/activation ──────────────────────────────────────────────────────

router.get("/:id/activation", async (req, res) => {
  const id = String(req.params.id);

  const [activation] = await db
    .select()
    .from(agreementActivationsTable)
    .where(eq(agreementActivationsTable.agreementId, id))
    .orderBy(desc(agreementActivationsTable.createdAt))
    .limit(1);

  if (!activation) {
    res.status(404).json({ error: "No activation workflow found" });
    return;
  }

  const result = await fetchActivationWithOtps(activation.id);
  res.json(result);
});

// ── POST /:id/activation ─────────────────────────────────────────────────────
// Initiates activation: creates an activation record + OTP tasks for both
// parties.  Agreement must be in "draft" status.

router.post(
  "/:id/activation",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = String(req.params.id);
    const { userId: clerkUserId } = getAuth(req);
    const actor = await resolveActingUser(clerkUserId);

    const bodyParsed = InitiateAgreementActivationBody.safeParse(req.body ?? {});
    const notes = bodyParsed.success ? (bodyParsed.data.notes ?? null) : null;

    // Load agreement
    const [agreement] = await db
      .select()
      .from(agreementsTable)
      .where(eq(agreementsTable.id, id))
      .limit(1);

    if (!agreement) {
      res.status(404).json({ error: "Agreement not found" });
      return;
    }

    if (agreement.status !== "draft") {
      res.status(409).json({
        error: `Agreement is already in '${agreement.status}' status. Only draft agreements can be activated.`,
      });
      return;
    }

    // Check for existing pending activation
    const [existing] = await db
      .select()
      .from(agreementActivationsTable)
      .where(
        and(
          eq(agreementActivationsTable.agreementId, id),
          eq(agreementActivationsTable.status, "pending_otp"),
        ),
      )
      .limit(1);

    if (existing) {
      res.status(409).json({
        error: "An active activation workflow already exists for this agreement.",
      });
      return;
    }

    // Load partner details for OTP tasks
    const [landOwner, developer] = await Promise.all([
      db
        .select({ id: partnersTable.id, name: partnersTable.name, phone: partnersTable.phone })
        .from(partnersTable)
        .where(eq(partnersTable.id, agreement.landOwnerId))
        .limit(1)
        .then((r) => r[0]),
      db
        .select({ id: partnersTable.id, name: partnersTable.name, phone: partnersTable.phone })
        .from(partnersTable)
        .where(eq(partnersTable.id, agreement.projectDeveloperId))
        .limit(1)
        .then((r) => r[0]),
    ]);

    // Create activation record
    const [newActivation] = await db
      .insert(agreementActivationsTable)
      .values({
        agreementId: id,
        status: "pending_otp",
        initiatedBy: actor.id ?? null,
        initiatedByName: actor.name ?? null,
        notes,
      })
      .returning();

    // Create OTP tasks (one per party, status=pending — not sent yet)
    await db.insert(agreementActivationOtpsTable).values([
      {
        activationId: newActivation.id,
        partyRole: "landowner",
        partyName: landOwner?.name ?? "Landowner",
        partyPhone: landOwner?.phone ?? null,
        partnerId: agreement.landOwnerId,
        otpCode: generateOtp(),
        status: "pending",
      },
      {
        activationId: newActivation.id,
        partyRole: "developer",
        partyName: developer?.name ?? "Developer",
        partyPhone: developer?.phone ?? null,
        partnerId: agreement.projectDeveloperId,
        otpCode: generateOtp(),
        status: "pending",
      },
    ]);

    // Update agreement status
    await db
      .update(agreementsTable)
      .set({ status: "pending_activation" })
      .where(eq(agreementsTable.id, id));

    const result = await fetchActivationWithOtps(newActivation.id);

    writeAuditLog(
      newActivation.id,
      "agreement_activations",
      "INSERT",
      `Activation workflow initiated for agreement ${id.slice(0, 8)} by ${actor.name ?? "unknown"}`,
      actor.id,
      actor.name,
      { agreementId: id, status: "pending_otp" },
    );

    res.status(201).json(result);
  },
);

// ── POST /:id/activation/:activationId/cancel ────────────────────────────────

router.post(
  "/:id/activation/:activationId/cancel",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = String(req.params.id);
    const activationId = String(req.params.activationId);
    const { userId: clerkUserId } = getAuth(req);
    const actor = await resolveActingUser(clerkUserId);

    const bodyParsed = CancelAgreementActivationBody.safeParse(req.body ?? {});
    const cancellationReason = bodyParsed.success
      ? (bodyParsed.data.cancellationReason ?? null)
      : null;

    const [activation] = await db
      .select()
      .from(agreementActivationsTable)
      .where(
        and(
          eq(agreementActivationsTable.id, activationId),
          eq(agreementActivationsTable.agreementId, id),
        ),
      )
      .limit(1);

    if (!activation) {
      res.status(404).json({ error: "Activation workflow not found" });
      return;
    }

    if (activation.status !== "pending_otp") {
      res.status(409).json({ error: "Only pending_otp workflows can be cancelled" });
      return;
    }

    await db
      .update(agreementActivationsTable)
      .set({
        status: "cancelled",
        cancelledBy: actor.id ?? null,
        cancelledAt: new Date(),
        cancellationReason,
      })
      .where(eq(agreementActivationsTable.id, activationId));

    // Revert agreement to draft
    await db
      .update(agreementsTable)
      .set({ status: "draft" })
      .where(eq(agreementsTable.id, id));

    const result = await fetchActivationWithOtps(activationId);

    writeAuditLog(
      activationId,
      "agreement_activations",
      "UPDATE",
      `Activation workflow cancelled for agreement ${id.slice(0, 8)} by ${actor.name ?? "unknown"}`,
      actor.id,
      actor.name,
      { status: "cancelled", cancellationReason },
    );

    res.json(result);
  },
);

// ── POST /:id/activation/:activationId/otp/:otpId/send ───────────────────────
// Generates (or regenerates) OTP code and marks it as sent.

router.post(
  "/:id/activation/:activationId/otp/:otpId/send",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = String(req.params.id);
    const activationId = String(req.params.activationId);
    const otpId = String(req.params.otpId);

    const [activation] = await db
      .select()
      .from(agreementActivationsTable)
      .where(
        and(
          eq(agreementActivationsTable.id, activationId),
          eq(agreementActivationsTable.agreementId, id),
        ),
      )
      .limit(1);

    if (!activation || activation.status !== "pending_otp") {
      res.status(404).json({ error: "Active activation workflow not found" });
      return;
    }

    const [otpTask] = await db
      .select()
      .from(agreementActivationOtpsTable)
      .where(
        and(
          eq(agreementActivationOtpsTable.id, otpId),
          eq(agreementActivationOtpsTable.activationId, activationId),
        ),
      )
      .limit(1);

    if (!otpTask) {
      res.status(404).json({ error: "OTP task not found" });
      return;
    }

    if (otpTask.status === "verified") {
      res.status(409).json({ error: "This party has already verified their OTP" });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

    const [updated] = await db
      .update(agreementActivationOtpsTable)
      .set({
        otpCode: generateOtp(),
        status: "sent",
        sentAt: now,
        expiresAt,
        attempts: 0,
      })
      .where(eq(agreementActivationOtpsTable.id, otpId))
      .returning();

    res.json(formatOtp(updated, true));
  },
);

// ── POST /:id/activation/:activationId/otp/:otpId/verify ─────────────────────
// Verifies the OTP code for a party.  If all tasks are verified, completes
// the activation and sets agreement status to "active".

router.post(
  "/:id/activation/:activationId/otp/:otpId/verify",
  async (req, res) => {
    const id = String(req.params.id);
    const activationId = String(req.params.activationId);
    const otpId = String(req.params.otpId);
    const { userId: clerkUserId } = getAuth(req);
    const actor = await resolveActingUser(clerkUserId);

    const bodyParsed = VerifyAgreementActivationOtpBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "otpCode is required" });
      return;
    }
    const { otpCode } = bodyParsed.data;

    const [activation] = await db
      .select()
      .from(agreementActivationsTable)
      .where(
        and(
          eq(agreementActivationsTable.id, activationId),
          eq(agreementActivationsTable.agreementId, id),
        ),
      )
      .limit(1);

    if (!activation || activation.status !== "pending_otp") {
      res.status(404).json({ error: "Active activation workflow not found" });
      return;
    }

    const [otpTask] = await db
      .select()
      .from(agreementActivationOtpsTable)
      .where(
        and(
          eq(agreementActivationOtpsTable.id, otpId),
          eq(agreementActivationOtpsTable.activationId, activationId),
        ),
      )
      .limit(1);

    if (!otpTask) {
      res.status(404).json({ error: "OTP task not found" });
      return;
    }

    if (otpTask.status === "verified") {
      res.status(400).json({ error: "This OTP has already been verified" });
      return;
    }

    if (otpTask.status !== "sent") {
      res.status(400).json({ error: "OTP has not been sent yet. Please send it first." });
      return;
    }

    // Check expiry
    if (otpTask.expiresAt && otpTask.expiresAt < new Date()) {
      await db
        .update(agreementActivationOtpsTable)
        .set({ status: "expired" })
        .where(eq(agreementActivationOtpsTable.id, otpId));
      res.status(400).json({ error: "OTP has expired. Please request a new one." });
      return;
    }

    const maxAttempts = 5;
    const newAttempts = otpTask.attempts + 1;

    if (otpTask.otpCode !== otpCode) {
      const status = newAttempts >= maxAttempts ? "failed" : otpTask.status;
      await db
        .update(agreementActivationOtpsTable)
        .set({ attempts: newAttempts, status })
        .where(eq(agreementActivationOtpsTable.id, otpId));

      const remaining = maxAttempts - newAttempts;
      res.status(400).json({
        error:
          remaining > 0
            ? `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
            : "Maximum attempts exceeded. Please request a new OTP.",
      });
      return;
    }

    // Correct — mark verified
    const now = new Date();
    await db
      .update(agreementActivationOtpsTable)
      .set({
        status: "verified",
        verifiedAt: now,
        verifiedBy: actor.id ?? null,
        attempts: newAttempts,
      })
      .where(eq(agreementActivationOtpsTable.id, otpId));

    // Check if all tasks for this activation are now verified
    const allTasks = await db
      .select()
      .from(agreementActivationOtpsTable)
      .where(eq(agreementActivationOtpsTable.activationId, activationId));

    const allVerified = allTasks.every(
      (t) => t.id === otpId ? true : t.status === "verified",
    );

    if (allVerified) {
      // Complete activation → agreement becomes active
      await db
        .update(agreementActivationsTable)
        .set({ status: "completed", completedAt: now })
        .where(eq(agreementActivationsTable.id, activationId));

      await db
        .update(agreementsTable)
        .set({ status: "active" })
        .where(eq(agreementsTable.id, id));

      writeAuditLog(
        activationId,
        "agreement_activations",
        "UPDATE",
        `Agreement ${id.slice(0, 8)} activated — all parties verified`,
        actor.id,
        actor.name,
        { status: "completed", agreementId: id },
      );
    }

    const result = await fetchActivationWithOtps(activationId);
    res.json(result);
  },
);

export default router;

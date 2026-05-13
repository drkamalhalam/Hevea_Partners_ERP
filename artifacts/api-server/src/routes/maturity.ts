import { Router } from "express";
import {
  db,
  projectsTable,
  agreementsTable,
  partnersTable,
  usersTable,
  partnerClaimantsTable,
  maturityDeclarationsTable,
  maturityOtpVerificationsTable,
  projectLifecycleHistoryTable,
  activityTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  InitiateMaturityDeclarationBody,
  CancelMaturityDeclarationBody,
  VerifyMaturityOtpBody,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function formatVerification(
  v: typeof maturityOtpVerificationsTable.$inferSelect,
  exposeCode = false,
) {
  return {
    id: v.id,
    declarationId: v.declarationId,
    partyRole: v.partyRole,
    partyUserId: v.partyUserId ?? null,
    partyName: v.partyName,
    partyPhone: v.partyPhone ?? null,
    partnerId: v.partnerId ?? null,
    status: v.status,
    otpCodePlaceholder: exposeCode ? v.otpCode : null,
    sentAt: v.sentAt?.toISOString() ?? null,
    verifiedAt: v.verifiedAt?.toISOString() ?? null,
    expiresAt: v.expiresAt?.toISOString() ?? null,
    attempts: v.attempts,
    createdAt: v.createdAt.toISOString(),
  };
}

function formatDeclaration(
  d: typeof maturityDeclarationsTable.$inferSelect,
  verifications: (typeof maturityOtpVerificationsTable.$inferSelect)[],
) {
  return {
    id: d.id,
    projectId: d.projectId,
    status: d.status,
    initiatedBy: d.initiatedBy ?? null,
    initiatedByName: d.initiatedByName ?? null,
    blockerSnapshot: d.blockerSnapshot ?? null,
    ownershipSnapshotPlaceholder: d.ownershipSnapshotPlaceholder ?? null,
    cancelledBy: d.cancelledBy ?? null,
    cancelledAt: d.cancelledAt?.toISOString() ?? null,
    cancellationReason: d.cancellationReason ?? null,
    completedAt: d.completedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt?.toISOString() ?? null,
    otpVerifications: verifications.map((v) =>
      formatVerification(
        v,
        // Expose code while status is sent (placeholder only)
        v.status === "sent",
      ),
    ),
  };
}

async function fetchDeclarationWithVerifications(declarationId: string) {
  const [declaration] = await db
    .select()
    .from(maturityDeclarationsTable)
    .where(eq(maturityDeclarationsTable.id, declarationId))
    .limit(1);

  if (!declaration) return null;

  const verifications = await db
    .select()
    .from(maturityOtpVerificationsTable)
    .where(eq(maturityOtpVerificationsTable.declarationId, declarationId))
    .orderBy(maturityOtpVerificationsTable.partyRole);

  return formatDeclaration(declaration, verifications);
}

async function resolveActingUser(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return { id: undefined, name: undefined };
  const [row] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return { id: row?.id, name: row?.displayName ?? undefined };
}

async function checkMaturityBlockers(projectId: string) {
  const blockers: {
    type: string;
    message: string;
    severity: string;
    count: number | null;
  }[] = [];

  const [project] = await db
    .select({ lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(
      and(eq(projectsTable.id, projectId), eq(projectsTable.isActive, true)),
    )
    .limit(1);

  if (!project) {
    return {
      canProceed: false,
      blockers: [
        {
          type: "already_mature",
          message: "Project not found",
          severity: "error",
          count: null,
        },
      ],
    };
  }

  if (project.lifecycleStatus !== "prematurity") {
    blockers.push({
      type: "already_mature",
      message: `Project lifecycle is already '${project.lifecycleStatus}' — maturity declaration cannot be re-initiated`,
      severity: "error",
      count: null,
    });
  }

  // Check for in-progress declaration
  const [activeDec] = await db
    .select({ id: maturityDeclarationsTable.id })
    .from(maturityDeclarationsTable)
    .where(
      and(
        eq(maturityDeclarationsTable.projectId, projectId),
        eq(maturityDeclarationsTable.status, "pending_otp"),
      ),
    )
    .limit(1);

  if (activeDec) {
    blockers.push({
      type: "active_declaration",
      message: "A maturity declaration is already in progress — cancel it before initiating a new one",
      severity: "error",
      count: null,
    });
  }

  // Check agreements
  const agreements = await db
    .select({ id: agreementsTable.id, status: agreementsTable.status })
    .from(agreementsTable)
    .where(eq(agreementsTable.projectId, projectId));

  if (agreements.length === 0) {
    blockers.push({
      type: "no_agreements",
      message: "No partnership agreements exist for this project — at least one active agreement is required",
      severity: "error",
      count: null,
    });
  } else {
    const nonActive = agreements.filter((a) => a.status !== "active");
    if (nonActive.length > 0) {
      blockers.push({
        type: "pending_agreement",
        message: `${nonActive.length} agreement(s) are not in active status — all agreements must be active`,
        severity: "error",
        count: nonActive.length,
      });
    }
  }

  // Check unresolved claimants
  const unresolvedClaimants = await db
    .select({ id: partnerClaimantsTable.id })
    .from(partnerClaimantsTable)
    .where(
      and(
        eq(partnerClaimantsTable.projectId, projectId),
        eq(partnerClaimantsTable.isActive, true),
        inArray(partnerClaimantsTable.status, [
          "pending_verification",
          "disputed",
        ]),
      ),
    );

  if (unresolvedClaimants.length > 0) {
    blockers.push({
      type: "disputed_claimant",
      message: `${unresolvedClaimants.length} claimant record(s) have unresolved verifications or active disputes`,
      severity: "error",
      count: unresolvedClaimants.length,
    });
  }

  return { canProceed: blockers.length === 0, blockers };
}

// ── Routes ──────────────────────────────────────────────────────────────────

// GET /:id/maturity — most recent declaration
router.get("/:id/maturity", async (req, res) => {
  const projectId = req.params.id as string;

  try {
    const [declaration] = await db
      .select()
      .from(maturityDeclarationsTable)
      .where(eq(maturityDeclarationsTable.projectId, projectId))
      .orderBy(desc(maturityDeclarationsTable.createdAt))
      .limit(1);

    if (!declaration) {
      res.status(404).json({ error: "No maturity declaration found" });
      return;
    }

    const verifications = await db
      .select()
      .from(maturityOtpVerificationsTable)
      .where(eq(maturityOtpVerificationsTable.declarationId, declaration.id))
      .orderBy(maturityOtpVerificationsTable.partyRole);

    res.json(formatDeclaration(declaration, verifications));
  } catch (err) {
    req.log.error({ err }, "Failed to get maturity declaration");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /:id/maturity/blockers — real-time blocker check
router.get("/:id/maturity/blockers", async (req, res) => {
  try {
    const result = await checkMaturityBlockers(req.params.id as string);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to check maturity blockers");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/maturity — initiate declaration (developer/admin only)
router.post("/:id/maturity", requireRole("admin", "developer"), async (req, res) => {
  const projectId = req.params.id as string;

  const bodyParsed = InitiateMaturityDeclarationBody.safeParse(req.body ?? {});
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  try {
    // 1. Check blockers
    const blockerResult = await checkMaturityBlockers(projectId);
    if (!blockerResult.canProceed) {
      res.status(409).json(blockerResult);
      return;
    }

    // 2. Resolve acting user
    const actor = await resolveActingUser(req.userId);

    // 3. Get landowners from active agreements
    const agreements = await db
      .select({ landOwnerId: agreementsTable.landOwnerId })
      .from(agreementsTable)
      .where(
        and(
          eq(agreementsTable.projectId, projectId),
          eq(agreementsTable.status, "active"),
        ),
      );

    const uniqueLandownerIds = [
      ...new Set(agreements.map((a) => a.landOwnerId)),
    ];

    const landowners =
      uniqueLandownerIds.length > 0
        ? await db
            .select({
              id: partnersTable.id,
              name: partnersTable.name,
              phone: partnersTable.phone,
              userId: partnersTable.userId,
            })
            .from(partnersTable)
            .where(inArray(partnersTable.id, uniqueLandownerIds))
        : [];

    // 4. Create declaration
    const [declaration] = await db
      .insert(maturityDeclarationsTable)
      .values({
        projectId,
        status: "pending_otp",
        initiatedBy: actor.id ?? null,
        initiatedByName: actor.name ?? null,
        blockerSnapshot: blockerResult,
        ownershipSnapshotPlaceholder: {
          note: "Ownership calculations pending — not yet implemented",
          projectId,
          capturedAt: new Date().toISOString(),
        },
      })
      .returning();

    // 5. Generate OTP verification rows
    type OtpInsert = typeof maturityOtpVerificationsTable.$inferInsert;
    const otpEntries: OtpInsert[] = [];

    otpEntries.push({
      declarationId: declaration.id,
      partyRole: "developer",
      partyUserId: actor.id ?? null,
      partyName: actor.name ?? "Project Developer",
      otpCode: generateOtp(),
    });

    for (const lo of landowners) {
      otpEntries.push({
        declarationId: declaration.id,
        partyRole: "landowner",
        partyUserId: lo.userId ?? null,
        partyName: lo.name,
        partyPhone: lo.phone ?? null,
        partnerId: lo.id,
        otpCode: generateOtp(),
      });
    }

    const verifications = await db
      .insert(maturityOtpVerificationsTable)
      .values(otpEntries)
      .returning();

    // 6. Audit
    await db.insert(activityTable).values({
      type: "maturity_initiated",
      description: `Maturity declaration initiated${bodyParsed.data.remarks ? `: ${bodyParsed.data.remarks}` : ""}`,
      entityId: projectId,
      entityType: "project",
      projectId,
      userId: actor.id ?? null,
      metadata: { declarationId: declaration.id },
    });

    req.log.info({ projectId, declarationId: declaration.id }, "Maturity declaration initiated");
    res.status(201).json(formatDeclaration(declaration, verifications));
  } catch (err) {
    req.log.error({ err }, "Failed to initiate maturity declaration");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /:id/maturity — cancel active declaration (developer/admin only)
router.delete("/:id/maturity", requireRole("admin", "developer"), async (req, res) => {
  const projectId = req.params.id as string;

  const bodyParsed = CancelMaturityDeclarationBody.safeParse(req.body ?? {});
  const reason = bodyParsed.success ? bodyParsed.data.reason : undefined;

  try {
    const [declaration] = await db
      .select()
      .from(maturityDeclarationsTable)
      .where(
        and(
          eq(maturityDeclarationsTable.projectId, projectId),
          eq(maturityDeclarationsTable.status, "pending_otp"),
        ),
      )
      .orderBy(desc(maturityDeclarationsTable.createdAt))
      .limit(1);

    if (!declaration) {
      res.status(404).json({ error: "No active maturity declaration found" });
      return;
    }

    const actor = await resolveActingUser(req.userId);

    await db
      .update(maturityDeclarationsTable)
      .set({
        status: "cancelled",
        cancelledBy: actor.id ?? null,
        cancelledAt: new Date(),
        cancellationReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(maturityDeclarationsTable.id, declaration.id));

    await db.insert(activityTable).values({
      type: "maturity_cancelled",
      description: `Maturity declaration cancelled${reason ? `: ${reason}` : ""}`,
      entityId: projectId,
      entityType: "project",
      projectId,
      userId: actor.id ?? null,
      metadata: { declarationId: declaration.id },
    });

    req.log.info({ projectId, declarationId: declaration.id }, "Maturity declaration cancelled");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel maturity declaration");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/maturity/otp/:verificationId/send — send (or resend) OTP
router.post(
  "/:id/maturity/otp/:verificationId/send",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = req.params.id as string;
    const verificationId = req.params.verificationId as string;

    try {
      const [verification] = await db
        .select()
        .from(maturityOtpVerificationsTable)
        .where(eq(maturityOtpVerificationsTable.id, verificationId))
        .limit(1);

      if (!verification) {
        res.status(404).json({ error: "Verification record not found" });
        return;
      }

      // Confirm belongs to this project
      const [declaration] = await db
        .select({ id: maturityDeclarationsTable.id, status: maturityDeclarationsTable.status })
        .from(maturityDeclarationsTable)
        .where(
          and(
            eq(maturityDeclarationsTable.id, verification.declarationId),
            eq(maturityDeclarationsTable.projectId, projectId),
            eq(maturityDeclarationsTable.status, "pending_otp"),
          ),
        )
        .limit(1);

      if (!declaration) {
        res.status(404).json({ error: "No active declaration found for this project" });
        return;
      }

      if (verification.status === "verified") {
        res.status(400).json({ error: "OTP already verified" });
        return;
      }

      // Regenerate code if previously failed or expired
      const newCode =
        verification.status === "failed" || verification.status === "expired"
          ? generateOtp()
          : verification.otpCode;

      await db
        .update(maturityOtpVerificationsTable)
        .set({
          otpCode: newCode,
          status: "sent",
          sentAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          attempts: 0,
        })
        .where(eq(maturityOtpVerificationsTable.id, verificationId));

      const [updated] = await db
        .select()
        .from(maturityOtpVerificationsTable)
        .where(eq(maturityOtpVerificationsTable.id, verificationId))
        .limit(1);

      req.log.info(
        { verificationId, partyRole: verification.partyRole },
        "Maturity OTP sent (placeholder)",
      );

      // Expose code in response (placeholder system)
      res.json(formatVerification(updated, true));
    } catch (err) {
      req.log.error({ err }, "Failed to send maturity OTP");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /:id/maturity/otp/:verificationId/verify — verify OTP; complete if all done
router.post(
  "/:id/maturity/otp/:verificationId/verify",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = req.params.id as string;
    const verificationId = req.params.verificationId as string;

    const bodyParsed = VerifyMaturityOtpBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.message });
      return;
    }
    const { otpCode } = bodyParsed.data;

    try {
      const [verification] = await db
        .select()
        .from(maturityOtpVerificationsTable)
        .where(eq(maturityOtpVerificationsTable.id, verificationId))
        .limit(1);

      if (!verification) {
        res.status(404).json({ error: "Verification record not found" });
        return;
      }

      const [declaration] = await db
        .select()
        .from(maturityDeclarationsTable)
        .where(
          and(
            eq(maturityDeclarationsTable.id, verification.declarationId),
            eq(maturityDeclarationsTable.projectId, projectId),
            eq(maturityDeclarationsTable.status, "pending_otp"),
          ),
        )
        .limit(1);

      if (!declaration) {
        res.status(404).json({ error: "No active declaration found" });
        return;
      }

      if (verification.status === "verified") {
        res.status(400).json({ error: "This OTP has already been verified" });
        return;
      }

      if (verification.status !== "sent") {
        res.status(400).json({ error: "OTP must be sent before it can be verified" });
        return;
      }

      // Check expiry
      if (verification.expiresAt && verification.expiresAt < new Date()) {
        await db
          .update(maturityOtpVerificationsTable)
          .set({ status: "expired" })
          .where(eq(maturityOtpVerificationsTable.id, verificationId));
        res.status(400).json({ error: "OTP has expired — please resend" });
        return;
      }

      const newAttempts = verification.attempts + 1;
      const MAX_ATTEMPTS = 3;

      if (verification.otpCode !== otpCode) {
        const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "sent";
        await db
          .update(maturityOtpVerificationsTable)
          .set({ attempts: newAttempts, status: newStatus })
          .where(eq(maturityOtpVerificationsTable.id, verificationId));

        res.status(400).json({
          error:
            newStatus === "failed"
              ? `Incorrect OTP. Maximum attempts reached — please resend`
              : `Incorrect OTP. ${MAX_ATTEMPTS - newAttempts} attempt(s) remaining`,
        });
        return;
      }

      // Correct — mark as verified
      await db
        .update(maturityOtpVerificationsTable)
        .set({ status: "verified", verifiedAt: new Date(), attempts: newAttempts })
        .where(eq(maturityOtpVerificationsTable.id, verificationId));

      req.log.info(
        { verificationId, partyRole: verification.partyRole },
        "Maturity OTP verified",
      );

      // Check if ALL verifications for this declaration are now verified
      const allVerifications = await db
        .select({ id: maturityOtpVerificationsTable.id, status: maturityOtpVerificationsTable.status })
        .from(maturityOtpVerificationsTable)
        .where(eq(maturityOtpVerificationsTable.declarationId, declaration.id));

      const allVerified = allVerifications.every(
        (v) => v.status === "verified" || v.id === verificationId,
      );

      if (allVerified) {
        const actor = await resolveActingUser(req.userId);

        // Complete the declaration
        await db
          .update(maturityDeclarationsTable)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(maturityDeclarationsTable.id, declaration.id));

        // Advance project lifecycle to mature_production
        await db
          .update(projectsTable)
          .set({ lifecycleStatus: "mature_production", updatedAt: new Date() })
          .where(eq(projectsTable.id, projectId));

        await db.insert(projectLifecycleHistoryTable).values({
          projectId,
          fromStatus: "prematurity",
          toStatus: "mature_production",
          remarks: "Advanced via maturity declaration workflow — all parties verified",
          changedBy: actor.id ?? null,
          changedByName: actor.name ?? null,
        });

        await db.insert(activityTable).values({
          type: "maturity_completed",
          description: "Maturity declaration completed — all parties verified. Project advanced to Mature Production.",
          entityId: projectId,
          entityType: "project",
          projectId,
          userId: actor.id ?? null,
          metadata: { declarationId: declaration.id },
        });

        req.log.info({ projectId, declarationId: declaration.id }, "Maturity declaration completed");
      }

      const full = await fetchDeclarationWithVerifications(declaration.id);
      res.json(full);
    } catch (err) {
      req.log.error({ err }, "Failed to verify maturity OTP");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

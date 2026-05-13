import { Router } from "express";
import {
  db,
  projectNomineesTable,
  nomineeActivationWorkflowsTable,
  activityTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  InitiateNomineeActivationBody,
  VerifyNomineeActivationBody,
  UpdateNomineeActivationWorkflowBody,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";

const router = Router();

const ACTIVE_STATUSES = ["pending_verification", "pending_otp"] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function resolveActingUser(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return { id: undefined as string | undefined, name: undefined as string | undefined };
  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  const u = rows[0];
  return { id: u?.id, name: u?.displayName ?? "Unknown" };
}

type WorkflowRow = typeof nomineeActivationWorkflowsTable.$inferSelect;

function formatWorkflow(w: WorkflowRow) {
  return {
    id: w.id,
    projectId: w.projectId,
    nomineeId: w.nomineeId,
    nomineeName: w.nomineeName,
    activationType: w.activationType,
    status: w.status,
    deathCertificateUrl: w.deathCertificateUrl ?? null,
    declarationDeedUrl: w.declarationDeedUrl ?? null,
    // OTP is always exposed in this system (dev/mock mode)
    otpCode: w.otpCode ?? null,
    otpSentAt: w.otpSentAt?.toISOString() ?? null,
    otpExpiresAt: w.otpExpiresAt?.toISOString() ?? null,
    otpVerifiedAt: w.otpVerifiedAt?.toISOString() ?? null,
    otpVerifiedBy: w.otpVerifiedBy ?? null,
    otpVerifiedByName: w.otpVerifiedByName ?? null,
    verifiedBy: w.verifiedBy ?? null,
    verifiedByName: w.verifiedByName ?? null,
    verifiedAt: w.verifiedAt?.toISOString() ?? null,
    verificationNotes: w.verificationNotes ?? null,
    activatedBy: w.activatedBy ?? null,
    activatedByName: w.activatedByName ?? null,
    activatedAt: w.activatedAt?.toISOString() ?? null,
    rejectedBy: w.rejectedBy ?? null,
    rejectedByName: w.rejectedByName ?? null,
    rejectedAt: w.rejectedAt?.toISOString() ?? null,
    rejectionReason: w.rejectionReason ?? null,
    governanceRemarks: w.governanceRemarks ?? null,
    createdBy: w.createdBy ?? null,
    createdByName: w.createdByName ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt?.toISOString() ?? null,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

// IMPORTANT: Specific sub-paths (/send-otp, /verify) MUST be registered before
// the base /:id/nominee/activation route to avoid ambiguity.

// POST /:id/nominee/activation/send-otp
router.post(
  "/:id/nominee/activation/send-otp",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    try {
      const workflows = await db
        .select()
        .from(nomineeActivationWorkflowsTable)
        .where(
          and(
            eq(nomineeActivationWorkflowsTable.projectId, id),
            eq(nomineeActivationWorkflowsTable.activationType, "voluntary_handover"),
            eq(nomineeActivationWorkflowsTable.status, "pending_otp"),
          ),
        )
        .orderBy(desc(nomineeActivationWorkflowsTable.createdAt))
        .limit(1);


      if (!workflows.length) {
        res
          .status(404)
          .json({ error: "No active voluntary handover workflow found for this project" });
        return;
      }

      const workflow = workflows[0];
      const actor = await resolveActingUser(clerkUserId);
      const otpCode = generateOtp();
      const now = new Date();
      const otpExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);

      const [updated] = await db
        .update(nomineeActivationWorkflowsTable)
        .set({ otpCode, otpSentAt: now, otpExpiresAt })
        .where(eq(nomineeActivationWorkflowsTable.id, workflow.id))
        .returning();

      await db.insert(activityTable).values({
        projectId: id,
        userId: actor.id ?? null,
        type: "nominee_activation_otp_sent",
        description: `Activation OTP sent for nominee ${workflow.nomineeName}`,
        entityId: workflow.id,
        entityType: "nominee_activation_workflow",
        metadata: JSON.stringify({ nomineeId: workflow.nomineeId }),
      });

      res.json(formatWorkflow(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to send nominee activation OTP");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /:id/nominee/activation/verify
router.post(
  "/:id/nominee/activation/verify",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    try {
      const bodyParsed = VerifyNomineeActivationBody.safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }
      const { otpCode, verificationNotes } = bodyParsed.data;

      const allWorkflows = await db
        .select()
        .from(nomineeActivationWorkflowsTable)
        .where(eq(nomineeActivationWorkflowsTable.projectId, id))
        .orderBy(desc(nomineeActivationWorkflowsTable.createdAt))
        .limit(5);

      const workflow = allWorkflows.find((w) =>
        (ACTIVE_STATUSES as readonly string[]).includes(w.status),
      );

      if (!workflow) {
        res.status(404).json({ error: "No active activation workflow to verify" });
        return;
      }
      const actor = await resolveActingUser(clerkUserId);
      const now = new Date();

      if (workflow.activationType === "voluntary_handover") {
        if (!otpCode) {
          res
            .status(400)
            .json({ error: "OTP code is required for voluntary handover verification" });
          return;
        }
        if (!workflow.otpCode) {
          res
            .status(400)
            .json({ error: "OTP has not been sent yet. Use send-otp first." });
          return;
        }
        if (workflow.otpExpiresAt && new Date() > workflow.otpExpiresAt) {
          res
            .status(400)
            .json({ error: "OTP has expired. Please resend the OTP and try again." });
          return;
        }
        if (workflow.otpCode !== otpCode) {
          res.status(400).json({ error: "Incorrect OTP code. Please try again." });
          return;
        }

        const [updated] = await db
          .update(nomineeActivationWorkflowsTable)
          .set({
            status: "activated",
            otpVerifiedAt: now,
            otpVerifiedBy: actor.id ?? null,
            otpVerifiedByName: actor.name ?? null,
            activatedBy: actor.id ?? null,
            activatedByName: actor.name ?? null,
            activatedAt: now,
          })
          .where(eq(nomineeActivationWorkflowsTable.id, workflow.id))
          .returning();

        await db
          .update(projectNomineesTable)
          .set({
            activationStatus: "activated",
            activatedAt: now,
            activatedBy: actor.id ?? null,
            activationNotes: `Activated via voluntary handover on ${now.toISOString()}. Verified by: ${actor.name ?? "admin"}.`,
          })
          .where(eq(projectNomineesTable.id, workflow.nomineeId));

        await db.insert(activityTable).values({
          projectId: id,
          userId: actor.id ?? null,
          type: "nominee_activated",
          description: `Nominee ${workflow.nomineeName} activated via voluntary handover (OTP verified)`,
          entityId: workflow.id,
          entityType: "nominee_activation_workflow",
          metadata: JSON.stringify({
            activationType: "voluntary_handover",
            nomineeId: workflow.nomineeId,
            nomineeName: workflow.nomineeName,
          }),
        });

        res.json(formatWorkflow(updated));
      } else {
        // death_based — admin document verification
        const [updated] = await db
          .update(nomineeActivationWorkflowsTable)
          .set({
            status: "activated",
            verifiedBy: actor.id ?? null,
            verifiedByName: actor.name ?? null,
            verifiedAt: now,
            verificationNotes: verificationNotes ?? null,
            activatedBy: actor.id ?? null,
            activatedByName: actor.name ?? null,
            activatedAt: now,
          })
          .where(eq(nomineeActivationWorkflowsTable.id, workflow.id))
          .returning();

        await db
          .update(projectNomineesTable)
          .set({
            activationStatus: "activated",
            activatedAt: now,
            activatedBy: actor.id ?? null,
            activationNotes: `Activated via death certificate verification on ${now.toISOString()}. Verified by: ${actor.name ?? "admin"}.`,
          })
          .where(eq(projectNomineesTable.id, workflow.nomineeId));

        await db.insert(activityTable).values({
          projectId: id,
          userId: actor.id ?? null,
          type: "nominee_activated",
          description: `Nominee ${workflow.nomineeName} activated via death certificate verification`,
          entityId: workflow.id,
          entityType: "nominee_activation_workflow",
          metadata: JSON.stringify({
            activationType: "death_based",
            nomineeId: workflow.nomineeId,
            nomineeName: workflow.nomineeName,
          }),
        });

        res.json(formatWorkflow(updated));
      }
    } catch (err) {
      req.log.error({ err }, "Failed to verify nominee activation");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /:id/nominee/activation
router.get("/:id/nominee/activation", async (req, res) => {
  const id = req.params.id as string;
  try {
    const workflows = await db
      .select()
      .from(nomineeActivationWorkflowsTable)
      .where(eq(nomineeActivationWorkflowsTable.projectId, id))
      .orderBy(desc(nomineeActivationWorkflowsTable.createdAt))
      .limit(1);

    if (!workflows.length) {
      res.status(404).json({ error: "No activation workflow found for this project" });
      return;
    }

    res.json(formatWorkflow(workflows[0]));
  } catch (err) {
    req.log.error({ err }, "Failed to get nominee activation workflow");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/nominee/activation
router.post(
  "/:id/nominee/activation",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    try {
      const bodyParsed = InitiateNomineeActivationBody.safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }
      const { activationType, deathCertificateUrl, declarationDeedUrl, governanceRemarks } =
        bodyParsed.data;

      // Reject if an active workflow already exists
      const recentWorkflows = await db
        .select({ id: nomineeActivationWorkflowsTable.id, status: nomineeActivationWorkflowsTable.status })
        .from(nomineeActivationWorkflowsTable)
        .where(eq(nomineeActivationWorkflowsTable.projectId, id))
        .orderBy(desc(nomineeActivationWorkflowsTable.createdAt))
        .limit(5);

      const hasActive = recentWorkflows.some((w) =>
        (ACTIVE_STATUSES as readonly string[]).includes(w.status),
      );

      if (hasActive) {
        res.status(409).json({
          error:
            "An active activation workflow already exists for this project. Complete or cancel it first.",
        });
        return;
      }

      // Get the current active nominee
      const nominees = await db
        .select()
        .from(projectNomineesTable)
        .where(
          and(
            eq(projectNomineesTable.projectId, id),
            eq(projectNomineesTable.isActive, true),
          ),
        )
        .limit(1);

      if (!nominees.length) {
        res
          .status(404)
          .json({ error: "No active nominee found for this project. Register a nominee first." });
        return;
      }

      const nominee = nominees[0];
      const actor = await resolveActingUser(clerkUserId);
      const isVoluntary = activationType === "voluntary_handover";
      const otpCode = isVoluntary ? generateOtp() : null;
      const now = new Date();
      const otpExpiresAt = isVoluntary ? new Date(now.getTime() + 30 * 60 * 1000) : null;

      const [workflow] = await db
        .insert(nomineeActivationWorkflowsTable)
        .values({
          projectId: id,
          nomineeId: nominee.id,
          nomineeName: nominee.nomineeName,
          activationType,
          status: isVoluntary ? "pending_otp" : "pending_verification",
          deathCertificateUrl: deathCertificateUrl ?? null,
          declarationDeedUrl: declarationDeedUrl ?? null,
          otpCode,
          otpSentAt: isVoluntary ? now : null,
          otpExpiresAt,
          governanceRemarks: governanceRemarks ?? null,
          createdBy: actor.id ?? null,
          createdByName: actor.name ?? null,
        })
        .returning();

      await db.insert(activityTable).values({
        projectId: id,
        userId: actor.id ?? null,
        type: "nominee_activation_initiated",
        description: `Nominee activation initiated (${isVoluntary ? "voluntary handover" : "death-based"}) for ${nominee.nomineeName}`,
        entityId: workflow.id,
        entityType: "nominee_activation_workflow",
        metadata: JSON.stringify({
          activationType,
          nomineeId: nominee.id,
          nomineeName: nominee.nomineeName,
        }),
      });

      res.status(201).json(formatWorkflow(workflow));
    } catch (err) {
      req.log.error({ err }, "Failed to initiate nominee activation");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PATCH /:id/nominee/activation — reject or cancel (admin only)
router.patch(
  "/:id/nominee/activation",
  requireRole("admin"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    try {
      const bodyParsed = UpdateNomineeActivationWorkflowBody.safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }
      const { status, rejectionReason } = bodyParsed.data;

      if (!status) {
        res.status(400).json({ error: "Status is required (rejected or cancelled)" });
        return;
      }

      const patchWorkflows = await db
        .select()
        .from(nomineeActivationWorkflowsTable)
        .where(eq(nomineeActivationWorkflowsTable.projectId, id))
        .orderBy(desc(nomineeActivationWorkflowsTable.createdAt))
        .limit(5);

      const workflow = patchWorkflows.find((w) =>
        (ACTIVE_STATUSES as readonly string[]).includes(w.status),
      );

      if (!workflow) {
        res.status(404).json({ error: "No active activation workflow found for this project" });
        return;
      }
      const actor = await resolveActingUser(clerkUserId);
      const now = new Date();

      const [updated] = await db
        .update(nomineeActivationWorkflowsTable)
        .set({
          status: status as "rejected" | "cancelled",
          rejectedBy: actor.id ?? null,
          rejectedByName: actor.name ?? null,
          rejectedAt: now,
          rejectionReason: rejectionReason ?? null,
        })
        .where(eq(nomineeActivationWorkflowsTable.id, workflow.id))
        .returning();

      await db.insert(activityTable).values({
        projectId: id,
        userId: actor.id ?? null,
        type: `nominee_activation_${status}`,
        description: `Nominee activation ${status} for ${workflow.nomineeName}${rejectionReason ? `: ${rejectionReason}` : ""}`,
        entityId: workflow.id,
        entityType: "nominee_activation_workflow",
        metadata: JSON.stringify({
          status,
          nomineeId: workflow.nomineeId,
          nomineeName: workflow.nomineeName,
        }),
      });

      res.json(formatWorkflow(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to update nominee activation workflow");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

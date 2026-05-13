import { Router } from "express";
import {
  db,
  projectClosureWorkflowsTable,
  projectsTable,
  projectLifecycleHistoryTable,
  activityTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import {
  InitiateProjectClosureBody,
  UpdateProjectClosureWorkflowBody,
  AcknowledgeProjectClosureBody,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";

const router = Router();

const ACTIVE_STATUSES = ["pending_acknowledgment", "acknowledged"] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function resolveActingUser(clerkUserId: string | null | undefined) {
  if (!clerkUserId)
    return { id: undefined as string | undefined, name: undefined as string | undefined };
  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  const u = rows[0];
  return { id: u?.id, name: u?.displayName ?? "Unknown" };
}

type ClosureRow = typeof projectClosureWorkflowsTable.$inferSelect;

function formatWorkflow(w: ClosureRow) {
  return {
    id: w.id,
    projectId: w.projectId,
    status: w.status,
    closureReason: w.closureReason,
    closureRemarks: w.closureRemarks ?? null,
    initiatedBy: w.initiatedBy ?? null,
    initiatedByName: w.initiatedByName ?? null,
    initiatedAt: w.initiatedAt.toISOString(),
    otpCode: w.otpCode ?? null,
    otpSentAt: w.otpSentAt?.toISOString() ?? null,
    otpExpiresAt: w.otpExpiresAt?.toISOString() ?? null,
    otpVerifiedAt: w.otpVerifiedAt?.toISOString() ?? null,
    acknowledgedBy: w.acknowledgedBy ?? null,
    acknowledgedByName: w.acknowledgedByName ?? null,
    acknowledgedAt: w.acknowledgedAt?.toISOString() ?? null,
    acknowledgmentNotes: w.acknowledgmentNotes ?? null,
    acknowledgmentWaived: w.acknowledgmentWaived,
    waivedBy: w.waivedBy ?? null,
    waivedByName: w.waivedByName ?? null,
    waivedAt: w.waivedAt?.toISOString() ?? null,
    waivedReason: w.waivedReason ?? null,
    cancelledBy: w.cancelledBy ?? null,
    cancelledByName: w.cancelledByName ?? null,
    cancelledAt: w.cancelledAt?.toISOString() ?? null,
    cancellationReason: w.cancellationReason ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt?.toISOString() ?? null,
  };
}

async function findActiveWorkflow(projectId: string) {
  const rows = await db
    .select()
    .from(projectClosureWorkflowsTable)
    .where(eq(projectClosureWorkflowsTable.projectId, projectId))
    .orderBy(desc(projectClosureWorkflowsTable.createdAt))
    .limit(10);
  return rows.find((w) => (ACTIVE_STATUSES as readonly string[]).includes(w.status)) ?? null;
}

// ── GET /closure/pending — list all active workflows (admin/developer) ─────

router.get(
  "/closure/pending",
  requireRole("admin", "developer"),
  async (req, res) => {
    try {
      const workflows = await db
        .select({
          id: projectClosureWorkflowsTable.id,
          projectId: projectClosureWorkflowsTable.projectId,
          projectName: projectsTable.name,
          status: projectClosureWorkflowsTable.status,
          initiatedByName: projectClosureWorkflowsTable.initiatedByName,
          initiatedAt: projectClosureWorkflowsTable.initiatedAt,
          closureReason: projectClosureWorkflowsTable.closureReason,
          otpSentAt: projectClosureWorkflowsTable.otpSentAt,
        })
        .from(projectClosureWorkflowsTable)
        .innerJoin(projectsTable, eq(projectClosureWorkflowsTable.projectId, projectsTable.id))
        .where(inArray(projectClosureWorkflowsTable.status, ["pending_acknowledgment", "acknowledged"]))
        .orderBy(desc(projectClosureWorkflowsTable.initiatedAt));

      res.json(
        workflows.map((w) => ({
          ...w,
          initiatedAt: w.initiatedAt.toISOString(),
          otpSentAt: w.otpSentAt?.toISOString() ?? null,
        })),
      );
    } catch (err) {
      req.log.error({ err }, "Failed to list pending closure workflows");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /:id/closure ───────────────────────────────────────────────────────

router.get("/:id/closure", async (req, res) => {
  const id = req.params.id as string;
  try {
    const workflow = await findActiveWorkflow(id);
    if (!workflow) {
      res.status(404).json({ error: "No active closure workflow for this project" });
      return;
    }
    res.json(formatWorkflow(workflow));
  } catch (err) {
    req.log.error({ err }, "Failed to get project closure workflow");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /:id/closure — initiate (admin/developer) ─────────────────────────

router.post(
  "/:id/closure",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    try {
      const bodyParsed = InitiateProjectClosureBody.safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }
      const { closureReason, closureRemarks } = bodyParsed.data;

      // Reject if active workflow already exists
      const existing = await findActiveWorkflow(id);
      if (existing) {
        res.status(409).json({
          error: "An active closure workflow already exists for this project. Complete or cancel it first.",
        });
        return;
      }

      // Verify project exists
      const projects = await db
        .select({ id: projectsTable.id, lifecycleStatus: projectsTable.lifecycleStatus })
        .from(projectsTable)
        .where(eq(projectsTable.id, id))
        .limit(1);
      if (!projects.length) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if (projects[0].lifecycleStatus === "closed") {
        res.status(409).json({ error: "Project is already closed" });
        return;
      }

      const actor = await resolveActingUser(clerkUserId);
      const now = new Date();

      const [workflow] = await db
        .insert(projectClosureWorkflowsTable)
        .values({
          projectId: id,
          status: "pending_acknowledgment",
          closureReason,
          closureRemarks: closureRemarks ?? null,
          initiatedBy: actor.id ?? null,
          initiatedByName: actor.name ?? null,
          initiatedAt: now,
        })
        .returning();

      await db.insert(activityTable).values({
        type: "project_closure_initiated",
        description: `Project closure workflow initiated: ${closureReason}`,
        entityId: workflow.id,
        entityType: "project_closure_workflow",
        projectId: id,
        userId: actor.id ?? null,
        metadata: { closureReason, workflowId: workflow.id },
      });

      req.log.info({ projectId: id, workflowId: workflow.id }, "Project closure workflow initiated");
      res.status(201).json(formatWorkflow(workflow));
    } catch (err) {
      req.log.error({ err }, "Failed to initiate project closure");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /:id/closure/send-otp — send acknowledgment OTP ──────────────────

router.post(
  "/:id/closure/send-otp",
  requireRole("admin", "developer"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    try {
      const workflow = await findActiveWorkflow(id);
      if (!workflow) {
        res.status(404).json({ error: "No active closure workflow found for this project" });
        return;
      }
      if (workflow.status !== "pending_acknowledgment") {
        res.status(400).json({ error: "OTP can only be sent for workflows in pending_acknowledgment status" });
        return;
      }

      const actor = await resolveActingUser(clerkUserId);
      const otpCode = generateOtp();
      const now = new Date();
      const otpExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);

      const [updated] = await db
        .update(projectClosureWorkflowsTable)
        .set({ otpCode, otpSentAt: now, otpExpiresAt })
        .where(eq(projectClosureWorkflowsTable.id, workflow.id))
        .returning();

      await db.insert(activityTable).values({
        type: "project_closure_otp_sent",
        description: "Closure acknowledgment OTP sent to landowner",
        entityId: workflow.id,
        entityType: "project_closure_workflow",
        projectId: id,
        userId: actor.id ?? null,
        metadata: { otpCode },
      });

      req.log.info({ projectId: id, workflowId: workflow.id }, "Closure OTP sent");
      res.json(formatWorkflow(updated));
    } catch (err) {
      req.log.error({ err }, "Failed to send closure OTP");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /:id/closure/acknowledge — landowner acknowledges with OTP ─────────

router.post("/:id/closure/acknowledge", async (req, res) => {
  const id = req.params.id as string;
  const { userId: clerkUserId } = getAuth(req);
  try {
    const bodyParsed = AcknowledgeProjectClosureBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const { otpCode, acknowledgmentNotes } = bodyParsed.data;

    const workflow = await findActiveWorkflow(id);
    if (!workflow) {
      res.status(404).json({ error: "No active closure workflow found for this project" });
      return;
    }
    if (workflow.status !== "pending_acknowledgment") {
      res.status(400).json({ error: "This workflow is not awaiting acknowledgment" });
      return;
    }
    if (!workflow.otpCode) {
      res.status(400).json({ error: "OTP has not been sent yet. Use send-otp first." });
      return;
    }
    if (workflow.otpExpiresAt && new Date() > workflow.otpExpiresAt) {
      res.status(400).json({ error: "OTP has expired. Please resend the OTP and try again." });
      return;
    }
    if (workflow.otpCode !== otpCode) {
      res.status(400).json({ error: "Incorrect OTP code. Please try again." });
      return;
    }

    const actor = await resolveActingUser(clerkUserId);
    const now = new Date();

    const [updated] = await db
      .update(projectClosureWorkflowsTable)
      .set({
        status: "acknowledged",
        otpVerifiedAt: now,
        acknowledgedBy: actor.id ?? null,
        acknowledgedByName: actor.name ?? null,
        acknowledgedAt: now,
        acknowledgmentNotes: acknowledgmentNotes ?? null,
      })
      .where(eq(projectClosureWorkflowsTable.id, workflow.id))
      .returning();

    await db.insert(activityTable).values({
      type: "project_closure_acknowledged",
      description: `Project closure acknowledged by ${actor.name ?? "landowner"}`,
      entityId: workflow.id,
      entityType: "project_closure_workflow",
      projectId: id,
      userId: actor.id ?? null,
      metadata: { acknowledgedByName: actor.name ?? null },
    });

    req.log.info({ projectId: id, workflowId: workflow.id }, "Project closure acknowledged");
    res.json(formatWorkflow(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to acknowledge project closure");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /:id/closure — cancel or waive acknowledgment (admin) ────────────

router.patch(
  "/:id/closure",
  requireRole("admin"),
  async (req, res) => {
    const id = req.params.id as string;
    const { userId: clerkUserId } = getAuth(req);
    try {
      const bodyParsed = UpdateProjectClosureWorkflowBody.safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(400).json({ error: "Invalid request body" });
        return;
      }
      const { action, reason } = bodyParsed.data;

      const workflow = await findActiveWorkflow(id);
      if (!workflow) {
        res.status(404).json({ error: "No active closure workflow found for this project" });
        return;
      }

      const actor = await resolveActingUser(clerkUserId);
      const now = new Date();

      if (action === "cancel") {
        const [updated] = await db
          .update(projectClosureWorkflowsTable)
          .set({
            status: "cancelled",
            cancelledBy: actor.id ?? null,
            cancelledByName: actor.name ?? null,
            cancelledAt: now,
            cancellationReason: reason ?? null,
          })
          .where(eq(projectClosureWorkflowsTable.id, workflow.id))
          .returning();

        await db.insert(activityTable).values({
          type: "project_closure_cancelled",
          description: `Project closure workflow cancelled${reason ? `: ${reason}` : ""}`,
          entityId: workflow.id,
          entityType: "project_closure_workflow",
          projectId: id,
          userId: actor.id ?? null,
          metadata: { reason: reason ?? null },
        });

        req.log.info({ projectId: id, workflowId: workflow.id }, "Project closure cancelled");
        res.json(formatWorkflow(updated));
        return;
      }

      if (action === "waive") {
        // Admin waives landowner acknowledgment → acknowledged + lifecycle → closed
        const [updated] = await db
          .update(projectClosureWorkflowsTable)
          .set({
            status: "acknowledged",
            acknowledgmentWaived: true,
            acknowledgedBy: actor.id ?? null,
            acknowledgedByName: actor.name ?? null,
            acknowledgedAt: now,
            waivedBy: actor.id ?? null,
            waivedByName: actor.name ?? null,
            waivedAt: now,
            waivedReason: reason ?? null,
          })
          .where(eq(projectClosureWorkflowsTable.id, workflow.id))
          .returning();

        // Transition project lifecycle to closed
        const projects = await db
          .select({ lifecycleStatus: projectsTable.lifecycleStatus })
          .from(projectsTable)
          .where(eq(projectsTable.id, id))
          .limit(1);

        const currentStatus = projects[0]?.lifecycleStatus ?? "prematurity";

        await db
          .update(projectsTable)
          .set({ lifecycleStatus: "closed", updatedAt: now })
          .where(eq(projectsTable.id, id));

        await db.insert(projectLifecycleHistoryTable).values({
          projectId: id,
          fromStatus: currentStatus,
          toStatus: "closed",
          remarks: `Closed via governance closure workflow (waived acknowledgment)${reason ? `: ${reason}` : ""}`,
          changedBy: actor.id ?? null,
          changedByName: actor.name ?? null,
        });

        // Mark workflow as closed
        const [closed] = await db
          .update(projectClosureWorkflowsTable)
          .set({ status: "closed" })
          .where(eq(projectClosureWorkflowsTable.id, workflow.id))
          .returning();

        await db.insert(activityTable).values({
          type: "project_closure_waived",
          description: `Project closure acknowledgment waived by admin; project lifecycle closed`,
          entityId: workflow.id,
          entityType: "project_closure_workflow",
          projectId: id,
          userId: actor.id ?? null,
          metadata: { waivedReason: reason ?? null, previousLifecycleStatus: currentStatus },
        });

        req.log.info({ projectId: id, workflowId: workflow.id }, "Project closure waived by admin");
        res.json(formatWorkflow(closed));
        return;
      }

      res.status(400).json({ error: "Unknown action. Use 'cancel' or 'waive'." });
    } catch (err) {
      req.log.error({ err }, "Failed to update project closure workflow");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

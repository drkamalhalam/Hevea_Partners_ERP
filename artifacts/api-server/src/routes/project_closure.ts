import { Router } from "express";
import {
  db,
  projectClosureWorkflowsTable,
  projectsTable,
  projectLifecycleHistoryTable,
  activityTable,
  usersTable,
  inventoryStockMovementsTable,
  productionBatchesTable,
  stockTransfersTable,
  dispatchMemosTable,
  settlementRecordsTable,
  inheritanceClaimsTable,
  disputesTable,
  heldDistributionLedgerTable,
} from "@workspace/db";
import { eq, desc, inArray, and, sql, isNull, notInArray, gt } from "drizzle-orm";
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

// ── Closure Readiness Engine ──────────────────────────────────────────────────

interface StockBalance { stockType: string; netKg: number }
interface OpenBatch { id: string; batchNumber: string; status: string }
interface PendingTransfer { id: string; transferCode: string; quantityKg: string; transferStatus: string }
interface ActiveMemo { id: string; memoCode: string; remainingKg: string; dispatchStatus: string }
interface OpenSettlement { id: string; periodLabel: string; status: string; partnerId: string | null }
interface UnreleasedHeld { id: string; partnerId: string | null; heldAmount: string; reason: string | null }
interface OpenInheritanceClaim { id: string; status: string; partnerId: string | null }
interface OpenDispute { id: string; status: string; disputeType: string | null }

export interface ClosureReadiness {
  projectId: string;
  eligibilityStatus:
    | "closure_ready"
    | "blocked_inventory"
    | "blocked_financial"
    | "blocked_governance"
    | "pending_operational";
  isEligible: boolean;
  blockers: string[];
  stockBalances: StockBalance[];
  openBatches: OpenBatch[];
  pendingTransfers: PendingTransfer[];
  activeMemos: ActiveMemo[];
  openSettlements: OpenSettlement[];
  unreleasedHeldDistributions: UnreleasedHeld[];
  openInheritanceClaims: OpenInheritanceClaim[];
  openDisputes: OpenDispute[];
  checkedAt: string;
}

export async function computeClosureReadiness(projectId: string): Promise<ClosureReadiness> {
  const [
    stockRows,
    openBatchRows,
    pendingTransferRows,
    activeMemoRows,
    openSettlementRows,
    unreleasedHeldRows,
    openClaimRows,
    openDisputeRows,
  ] = await Promise.all([
    db
      .select({
        stockType: inventoryStockMovementsTable.stockType,
        totalIn: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
        totalOut: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      })
      .from(inventoryStockMovementsTable)
      .where(eq(inventoryStockMovementsTable.projectId, projectId))
      .groupBy(inventoryStockMovementsTable.stockType),

    db
      .select({ id: productionBatchesTable.id, batchNumber: productionBatchesTable.batchNumber, status: productionBatchesTable.status })
      .from(productionBatchesTable)
      .where(and(eq(productionBatchesTable.projectId, projectId), eq(productionBatchesTable.status, "open"))),

    db
      .select({ id: stockTransfersTable.id, transferCode: stockTransfersTable.transferCode, quantityKg: stockTransfersTable.quantityKg, transferStatus: stockTransfersTable.transferStatus })
      .from(stockTransfersTable)
      .where(and(eq(stockTransfersTable.projectId, projectId), inArray(stockTransfersTable.transferStatus, ["pending", "approved"]))),

    db
      .select({ id: dispatchMemosTable.id, memoCode: dispatchMemosTable.memoCode, remainingKg: dispatchMemosTable.remainingKg, dispatchStatus: dispatchMemosTable.dispatchStatus })
      .from(dispatchMemosTable)
      .where(and(eq(dispatchMemosTable.projectId, projectId), inArray(dispatchMemosTable.dispatchStatus, ["open", "partial"]))),

    // ── FINANCIAL: settlement records not yet finalized ──────────────────
    db
      .select({
        id: settlementRecordsTable.id,
        periodLabel: settlementRecordsTable.periodLabel,
        status: settlementRecordsTable.status,
        partnerId: settlementRecordsTable.partnerId,
      })
      .from(settlementRecordsTable)
      .where(
        and(
          eq(settlementRecordsTable.projectId, projectId),
          eq(settlementRecordsTable.isActive, true),
          notInArray(settlementRecordsTable.status, ["finalized"]),
        ),
      ),

    // ── FINANCIAL: held distributions not yet released ───────────────────
    db
      .select({
        id: heldDistributionLedgerTable.id,
        partnerId: heldDistributionLedgerTable.partnerId,
        heldAmount: heldDistributionLedgerTable.heldAmount,
        reason: heldDistributionLedgerTable.holdReason,
      })
      .from(heldDistributionLedgerTable)
      .where(
        and(
          eq(heldDistributionLedgerTable.projectId, projectId),
          isNull(heldDistributionLedgerTable.releasedAt),
          gt(heldDistributionLedgerTable.heldAmount, "0"),
        ),
      ),

    // ── GOVERNANCE: inheritance claims still open ────────────────────────
    db
      .select({
        id: inheritanceClaimsTable.id,
        status: inheritanceClaimsTable.status,
        partnerId: inheritanceClaimsTable.partnerId,
      })
      .from(inheritanceClaimsTable)
      .where(
        and(
          eq(inheritanceClaimsTable.projectId, projectId),
          notInArray(inheritanceClaimsTable.status, ["approved", "rejected"]),
        ),
      ),

    // ── GOVERNANCE: disputes still open ──────────────────────────────────
    db
      .select({
        id: disputesTable.id,
        status: disputesTable.status,
        disputeType: disputesTable.disputeType,
      })
      .from(disputesTable)
      .where(
        and(
          eq(disputesTable.projectId, projectId),
          eq(disputesTable.status, "open"),
        ),
      ),
  ]);

  const stockBalances: StockBalance[] = stockRows.map((r) => ({
    stockType: r.stockType,
    netKg: Number(r.totalIn) - Number(r.totalOut),
  }));

  const blockers: string[] = [];

  // ── Operational blockers ────────────────────────────────────────────────
  const nonZeroStock = stockBalances.filter((b) => b.netKg > 0.001);
  for (const b of nonZeroStock) {
    const label = b.stockType === "latex" ? "Latex" : b.stockType === "rubber_sheet" ? "Rubber Sheet" : b.stockType === "rubber_scrap" ? "Rubber Scrap" : b.stockType;
    blockers.push(`${label} stock balance: ${b.netKg.toFixed(3)} kg remaining`);
  }
  if (openBatchRows.length > 0)
    blockers.push(`${openBatchRows.length} open production batch${openBatchRows.length > 1 ? "es" : ""} not yet closed`);
  if (pendingTransferRows.length > 0)
    blockers.push(`${pendingTransferRows.length} pending stock transfer${pendingTransferRows.length > 1 ? "s" : ""} unresolved`);
  if (activeMemoRows.length > 0)
    blockers.push(`${activeMemoRows.length} active dispatch memo${activeMemoRows.length > 1 ? "s" : ""} not completed`);

  // ── Financial blockers ──────────────────────────────────────────────────
  const hasFinancialBlocker = openSettlementRows.length > 0 || unreleasedHeldRows.length > 0;
  if (openSettlementRows.length > 0)
    blockers.push(`${openSettlementRows.length} settlement record${openSettlementRows.length > 1 ? "s" : ""} not yet finalized`);
  if (unreleasedHeldRows.length > 0) {
    const total = unreleasedHeldRows.reduce((s, r) => s + Number(r.heldAmount), 0);
    blockers.push(`${unreleasedHeldRows.length} held distribution${unreleasedHeldRows.length > 1 ? "s" : ""} unreleased (₹${total.toFixed(2)})`);
  }

  // ── Governance blockers ─────────────────────────────────────────────────
  const hasGovernanceBlocker = openClaimRows.length > 0 || openDisputeRows.length > 0;
  if (openClaimRows.length > 0)
    blockers.push(`${openClaimRows.length} inheritance claim${openClaimRows.length > 1 ? "s" : ""} still open`);
  if (openDisputeRows.length > 0)
    blockers.push(`${openDisputeRows.length} dispute${openDisputeRows.length > 1 ? "s" : ""} still open`);

  const isEligible = blockers.length === 0;
  const eligibilityStatus: ClosureReadiness["eligibilityStatus"] = isEligible
    ? "closure_ready"
    : nonZeroStock.length > 0
      ? "blocked_inventory"
      : hasFinancialBlocker
        ? "blocked_financial"
        : hasGovernanceBlocker
          ? "blocked_governance"
          : "pending_operational";

  return {
    projectId,
    eligibilityStatus,
    isEligible,
    blockers,
    stockBalances,
    openBatches: openBatchRows,
    pendingTransfers: pendingTransferRows.map((t) => ({ ...t, quantityKg: String(t.quantityKg) })),
    activeMemos: activeMemoRows.map((m) => ({ ...m, remainingKg: String(m.remainingKg) })),
    openSettlements: openSettlementRows,
    unreleasedHeldDistributions: unreleasedHeldRows.map((r) => ({ ...r, heldAmount: String(r.heldAmount) })),
    openInheritanceClaims: openClaimRows,
    openDisputes: openDisputeRows,
    checkedAt: new Date().toISOString(),
  };
}

// ── GET /:id/closure-readiness — stock validation check ───────────────────

router.get("/:id/closure-readiness", async (req, res) => {
  const id = req.params.id as string;
  try {
    const projects = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, id))
      .limit(1);
    if (!projects.length) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const readiness = await computeClosureReadiness(id);
    res.json(readiness);
  } catch (err) {
    req.log.error({ err }, "Failed to compute closure readiness");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

      // ── Inventory clearance check ──────────────────────────────────────────
      const readiness = await computeClosureReadiness(id);
      if (!readiness.isEligible) {
        res.status(409).json({
          error: "Project Closure Blocked Due To Remaining Inventory",
          code: "INVENTORY_NOT_CLEARED",
          eligibilityStatus: readiness.eligibilityStatus,
          blockers: readiness.blockers,
          readiness,
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
        // ── Inventory clearance check before waive ─────────────────────────
        const waiveReadiness = await computeClosureReadiness(id);
        if (!waiveReadiness.isEligible) {
          res.status(409).json({
            error: "Project Closure Blocked Due To Remaining Inventory",
            code: "INVENTORY_NOT_CLEARED",
            eligibilityStatus: waiveReadiness.eligibilityStatus,
            blockers: waiveReadiness.blockers,
            readiness: waiveReadiness,
          });
          return;
        }

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

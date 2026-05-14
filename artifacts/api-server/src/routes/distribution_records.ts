/**
 * distribution_records.ts
 *
 * Distribution record and payment history system.
 * All records are permanently preserved — no hard deletes.
 *
 * Authority model:
 *   - Any authenticated user: read (project-visibility gated)
 *   - Admin / Developer: create, update, record payments, carry-forward, archive
 *   - Admin only: mark as permanent record
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  distributionRecordsTable,
  distributionPaymentEventsTable,
  usersTable,
  projectsTable,
  partnersTable,
} from "@workspace/db";
import { eq, and, desc, or, sql, isNull, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import {
  requireSettlementAccess,
  getProjectScopeFilter,
  logSettlementAccess,
  enforceProjectAccess,
} from "../middlewares/settlement_security";

const router = Router();

// ── Helper: resolve internal userId ──────────────────────────────────────

async function resolveUser(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── Helper: write payment event (append-only) ────────────────────────────

async function writePaymentEvent(payload: {
  distributionRecordId: string;
  projectId?: string | null;
  partnerId?: string | null;
  eventType: string;
  paymentAmount?: string | null;
  cumulativePaid?: string | null;
  remainingBalance?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  paymentDate?: string | null;
  paymentRef?: string | null;
  remarks?: string | null;
  metadata?: unknown;
  performedBy?: string | null;
  performedByName?: string | null;
  performedByRole?: string | null;
}) {
  await db.insert(distributionPaymentEventsTable).values({
    distributionRecordId: payload.distributionRecordId,
    projectId: payload.projectId ?? null,
    partnerId: payload.partnerId ?? null,
    eventType: payload.eventType,
    paymentAmount: payload.paymentAmount ?? null,
    cumulativePaid: payload.cumulativePaid ?? null,
    remainingBalance: payload.remainingBalance ?? null,
    previousStatus: payload.previousStatus ?? null,
    newStatus: payload.newStatus ?? null,
    paymentDate: payload.paymentDate ?? null,
    paymentRef: payload.paymentRef ?? null,
    remarks: payload.remarks ?? null,
    metadata: payload.metadata ? (payload.metadata as Record<string, unknown>) : null,
    performedBy: payload.performedBy ?? null,
    performedByName: payload.performedByName ?? null,
    performedByRole: payload.performedByRole ?? null,
  });
}

// ── Helper: recompute pending + carry-forward ─────────────────────────────

function computeDerived(
  recommendation: number,
  totalPaid: number,
  priorCarry: number
): { pendingPayable: number; carryForwardBalance: number } {
  const pendingPayable = Math.max(0, recommendation - totalPaid);
  const carryForwardBalance = Math.max(0, pendingPayable - 0); // same as pending until closed
  return { pendingPayable, carryForwardBalance };
}

// ── GET /distribution-records — list ─────────────────────────────────────

router.get("/", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(auth.userId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "distribution_records", "list");
    return res.json({ records: [], total: 0 });
  }

  const {
    projectId, partnerId, status, settlementType,
    periodLabel, includeArchived,
  } = req.query as Record<string, string | undefined>;

  const filters: ReturnType<typeof eq>[] = [];
  if (!includeArchived || includeArchived === "false") {
    filters.push(eq(distributionRecordsTable.isActive, true));
  }
  if (projectId) filters.push(eq(distributionRecordsTable.projectId, projectId));
  if (partnerId) filters.push(eq(distributionRecordsTable.partnerId, partnerId));
  if (status) filters.push(eq(distributionRecordsTable.status, status));
  if (settlementType) filters.push(eq(distributionRecordsTable.settlementType, settlementType));
  if (projectScope !== null) filters.push(inArray(distributionRecordsTable.projectId, projectScope));

  const rows = await db
    .select({
      id: distributionRecordsTable.id,
      projectId: distributionRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: distributionRecordsTable.partnerId,
      partnerName: partnersTable.name,
      accountingPeriodLabel: distributionRecordsTable.accountingPeriodLabel,
      periodStart: distributionRecordsTable.periodStart,
      periodEnd: distributionRecordsTable.periodEnd,
      settlementType: distributionRecordsTable.settlementType,
      linkedSettlementId: distributionRecordsTable.linkedSettlementId,
      grossRevenue: distributionRecordsTable.grossRevenue,
      settlementRecommendation: distributionRecordsTable.settlementRecommendation,
      totalPaid: distributionRecordsTable.totalPaid,
      pendingPayable: distributionRecordsTable.pendingPayable,
      priorCarryForward: distributionRecordsTable.priorCarryForward,
      carryForwardBalance: distributionRecordsTable.carryForwardBalance,
      lastPaymentDate: distributionRecordsTable.lastPaymentDate,
      lastPaymentRef: distributionRecordsTable.lastPaymentRef,
      paymentProofUrl: distributionRecordsTable.paymentProofUrl,
      status: distributionRecordsTable.status,
      isPermanentRecord: distributionRecordsTable.isPermanentRecord,
      isActive: distributionRecordsTable.isActive,
      notes: distributionRecordsTable.notes,
      createdByName: distributionRecordsTable.createdByName,
      createdAt: distributionRecordsTable.createdAt,
      updatedAt: distributionRecordsTable.updatedAt,
    })
    .from(distributionRecordsTable)
    .leftJoin(projectsTable, eq(distributionRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(distributionRecordsTable.partnerId, partnersTable.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(distributionRecordsTable.createdAt));

  logSettlementAccess(req, "distribution_records", "list");
  return res.json({ records: rows, total: rows.length });
});

// ── POST /distribution-records — create ───────────────────────────────────

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const {
      projectId, partnerId, accountingPeriodLabel,
      periodStart, periodEnd,
      linkedSaleIds, linkedSettlementId, settlementType,
      grossRevenue, settlementRecommendation,
      priorCarryForward, notes,
    } = req.body;

    if (!projectId || !accountingPeriodLabel) {
      return res.status(400).json({ error: "projectId and accountingPeriodLabel required" });
    }

    const rec = parseFloat(settlementRecommendation ?? "0");
    const priorCf = parseFloat(priorCarryForward ?? "0");
    const { pendingPayable, carryForwardBalance } = computeDerived(rec, 0, priorCf);

    const [record] = await db
      .insert(distributionRecordsTable)
      .values({
        projectId,
        partnerId: partnerId ?? null,
        accountingPeriodLabel,
        periodStart: periodStart ?? null,
        periodEnd: periodEnd ?? null,
        linkedSaleIds: linkedSaleIds ?? [],
        linkedSettlementId: linkedSettlementId ?? null,
        settlementType: settlementType ?? null,
        grossRevenue: String(parseFloat(grossRevenue ?? "0")),
        settlementRecommendation: String(rec),
        totalPaid: "0",
        pendingPayable: String(pendingPayable),
        priorCarryForward: String(priorCf),
        carryForwardBalance: String(carryForwardBalance),
        status: "pending",
        notes: notes ?? null,
        isPermanentRecord: false,
        createdBy: user.id,
        createdByName: user.displayName ?? null,
      })
      .returning();

    await writePaymentEvent({
      distributionRecordId: record.id,
      projectId: record.projectId,
      partnerId: record.partnerId,
      eventType: "created",
      previousStatus: null,
      newStatus: "pending",
      cumulativePaid: "0",
      remainingBalance: String(pendingPayable),
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: `Distribution record created for period: ${accountingPeriodLabel}`,
      metadata: { settlementType, grossRevenue, settlementRecommendation, priorCarryForward },
    });

    return res.status(201).json({ record });
  }
);

// ── GET /distribution-records/summary ─────────────────────────────────────

router.get("/summary", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "distribution_records", "summary");
    return res.json({ totalRecords: 0, totalGrossRevenue: "0.00", totalRecommended: "0.00",
      totalPaid: "0.00", totalPending: "0.00", totalCarryForward: "0.00",
      totalPriorCarry: "0.00", paymentRate: "0.0", byStatus: {} });
  }

  const { projectId, partnerId } = req.query as Record<string, string | undefined>;

  const filters: ReturnType<typeof eq>[] = [eq(distributionRecordsTable.isActive, true)];
  if (projectId) filters.push(eq(distributionRecordsTable.projectId, projectId));
  if (partnerId) filters.push(eq(distributionRecordsTable.partnerId, partnerId));
  if (projectScope !== null) filters.push(inArray(distributionRecordsTable.projectId, projectScope));

  const rows = await db
    .select({
      status: distributionRecordsTable.status,
      totalPaid: distributionRecordsTable.totalPaid,
      pendingPayable: distributionRecordsTable.pendingPayable,
      settlementRecommendation: distributionRecordsTable.settlementRecommendation,
      carryForwardBalance: distributionRecordsTable.carryForwardBalance,
      priorCarryForward: distributionRecordsTable.priorCarryForward,
      grossRevenue: distributionRecordsTable.grossRevenue,
    })
    .from(distributionRecordsTable)
    .where(and(...filters));

  const totalRecords = rows.length;
  const totalGrossRevenue = rows.reduce((s, r) => s + parseFloat(r.grossRevenue ?? "0"), 0);
  const totalRecommended = rows.reduce((s, r) => s + parseFloat(r.settlementRecommendation ?? "0"), 0);
  const totalPaid = rows.reduce((s, r) => s + parseFloat(r.totalPaid ?? "0"), 0);
  const totalPending = rows.reduce((s, r) => s + parseFloat(r.pendingPayable ?? "0"), 0);
  const totalCarryForward = rows.reduce((s, r) => s + parseFloat(r.carryForwardBalance ?? "0"), 0);
  const totalPriorCarry = rows.reduce((s, r) => s + parseFloat(r.priorCarryForward ?? "0"), 0);

  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  logSettlementAccess(req, "distribution_records", "summary");
  return res.json({
    totalRecords,
    totalGrossRevenue: totalGrossRevenue.toFixed(2),
    totalRecommended: totalRecommended.toFixed(2),
    totalPaid: totalPaid.toFixed(2),
    totalPending: totalPending.toFixed(2),
    totalCarryForward: totalCarryForward.toFixed(2),
    totalPriorCarry: totalPriorCarry.toFixed(2),
    paymentRate: totalRecommended > 0 ? ((totalPaid / totalRecommended) * 100).toFixed(1) : "0.0",
    byStatus,
  });
});

// ── GET /distribution-records/pending-payable ─────────────────────────────

router.get("/pending-payable", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "distribution_records", "pending_payable");
    return res.json({ records: [], total: 0, totalPendingAmount: "0.00" });
  }

  const { projectId, partnerId } = req.query as Record<string, string | undefined>;

  const filters: ReturnType<typeof eq>[] = [
    eq(distributionRecordsTable.isActive, true),
  ];
  if (projectId) filters.push(eq(distributionRecordsTable.projectId, projectId));
  if (partnerId) filters.push(eq(distributionRecordsTable.partnerId, partnerId));
  if (projectScope !== null) filters.push(inArray(distributionRecordsTable.projectId, projectScope));

  const rows = await db
    .select({
      id: distributionRecordsTable.id,
      projectId: distributionRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: distributionRecordsTable.partnerId,
      partnerName: partnersTable.name,
      accountingPeriodLabel: distributionRecordsTable.accountingPeriodLabel,
      periodStart: distributionRecordsTable.periodStart,
      periodEnd: distributionRecordsTable.periodEnd,
      settlementRecommendation: distributionRecordsTable.settlementRecommendation,
      totalPaid: distributionRecordsTable.totalPaid,
      pendingPayable: distributionRecordsTable.pendingPayable,
      carryForwardBalance: distributionRecordsTable.carryForwardBalance,
      status: distributionRecordsTable.status,
      createdAt: distributionRecordsTable.createdAt,
    })
    .from(distributionRecordsTable)
    .leftJoin(projectsTable, eq(distributionRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(distributionRecordsTable.partnerId, partnersTable.id))
    .where(
      and(
        ...filters,
        sql`${distributionRecordsTable.pendingPayable} > 0`
      )
    )
    .orderBy(desc(distributionRecordsTable.createdAt));

  const total = rows.reduce((s, r) => s + parseFloat(r.pendingPayable ?? "0"), 0);

  logSettlementAccess(req, "distribution_records", "pending_payable");
  return res.json({
    records: rows,
    total: rows.length,
    totalPendingAmount: total.toFixed(2),
  });
});

// ── GET /distribution-records/archive ────────────────────────────────────

router.get("/archive", requireRole("admin", "developer"), async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { projectId, partnerId, status } = req.query as Record<string, string | undefined>;

  const filters: ReturnType<typeof eq>[] = [];
  if (projectId) filters.push(eq(distributionRecordsTable.projectId, projectId));
  if (partnerId) filters.push(eq(distributionRecordsTable.partnerId, partnerId));
  if (status) filters.push(eq(distributionRecordsTable.status, status));

  const rows = await db
    .select({
      id: distributionRecordsTable.id,
      projectId: distributionRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: distributionRecordsTable.partnerId,
      partnerName: partnersTable.name,
      accountingPeriodLabel: distributionRecordsTable.accountingPeriodLabel,
      periodStart: distributionRecordsTable.periodStart,
      periodEnd: distributionRecordsTable.periodEnd,
      settlementType: distributionRecordsTable.settlementType,
      grossRevenue: distributionRecordsTable.grossRevenue,
      settlementRecommendation: distributionRecordsTable.settlementRecommendation,
      totalPaid: distributionRecordsTable.totalPaid,
      pendingPayable: distributionRecordsTable.pendingPayable,
      carryForwardBalance: distributionRecordsTable.carryForwardBalance,
      lastPaymentDate: distributionRecordsTable.lastPaymentDate,
      status: distributionRecordsTable.status,
      isPermanentRecord: distributionRecordsTable.isPermanentRecord,
      isActive: distributionRecordsTable.isActive,
      createdAt: distributionRecordsTable.createdAt,
    })
    .from(distributionRecordsTable)
    .leftJoin(projectsTable, eq(distributionRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(distributionRecordsTable.partnerId, partnersTable.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(distributionRecordsTable.createdAt));

  return res.json({ records: rows, total: rows.length });
});

// ── GET /distribution-records/partner-history/:partnerId ──────────────────

router.get("/partner-history/:partnerId", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "distribution_records", "partner_history");
    return res.json({ partnerId: req.params.partnerId, records: [], total: 0, summary: { totalPaid: "0.00", totalPending: "0.00", totalRecommended: "0.00", paymentRate: "0.0" } });
  }

  const { partnerId } = req.params as { partnerId: string };
  const { projectId } = req.query as Record<string, string | undefined>;

  const filters: ReturnType<typeof eq>[] = [
    eq(distributionRecordsTable.partnerId, partnerId),
  ];
  if (projectId) filters.push(eq(distributionRecordsTable.projectId, projectId));
  if (projectScope !== null) filters.push(inArray(distributionRecordsTable.projectId, projectScope));

  const records = await db
    .select({
      id: distributionRecordsTable.id,
      projectId: distributionRecordsTable.projectId,
      projectName: projectsTable.name,
      accountingPeriodLabel: distributionRecordsTable.accountingPeriodLabel,
      periodStart: distributionRecordsTable.periodStart,
      periodEnd: distributionRecordsTable.periodEnd,
      settlementType: distributionRecordsTable.settlementType,
      grossRevenue: distributionRecordsTable.grossRevenue,
      settlementRecommendation: distributionRecordsTable.settlementRecommendation,
      totalPaid: distributionRecordsTable.totalPaid,
      pendingPayable: distributionRecordsTable.pendingPayable,
      priorCarryForward: distributionRecordsTable.priorCarryForward,
      carryForwardBalance: distributionRecordsTable.carryForwardBalance,
      lastPaymentDate: distributionRecordsTable.lastPaymentDate,
      lastPaymentRef: distributionRecordsTable.lastPaymentRef,
      paymentProofUrl: distributionRecordsTable.paymentProofUrl,
      status: distributionRecordsTable.status,
      isPermanentRecord: distributionRecordsTable.isPermanentRecord,
      isActive: distributionRecordsTable.isActive,
      createdAt: distributionRecordsTable.createdAt,
    })
    .from(distributionRecordsTable)
    .leftJoin(projectsTable, eq(distributionRecordsTable.projectId, projectsTable.id))
    .where(and(...filters))
    .orderBy(desc(distributionRecordsTable.createdAt));

  // Totals
  const totalPaid = records.reduce((s, r) => s + parseFloat(r.totalPaid ?? "0"), 0);
  const totalPending = records.reduce((s, r) => s + parseFloat(r.pendingPayable ?? "0"), 0);
  const totalRecommended = records.reduce((s, r) => s + parseFloat(r.settlementRecommendation ?? "0"), 0);

  logSettlementAccess(req, "distribution_records", "partner_history", partnerId);
  return res.json({
    partnerId,
    records,
    total: records.length,
    summary: {
      totalPaid: totalPaid.toFixed(2),
      totalPending: totalPending.toFixed(2),
      totalRecommended: totalRecommended.toFixed(2),
      paymentRate: totalRecommended > 0 ? ((totalPaid / totalRecommended) * 100).toFixed(1) : "0.0",
    },
  });
});

// ── GET /distribution-records/:id — get single record ────────────────────

router.get("/:id", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params as { id: string };

  const [record] = await db
    .select()
    .from(distributionRecordsTable)
    .where(eq(distributionRecordsTable.id, id))
    .limit(1);

  if (!record) return res.status(404).json({ error: "Record not found" });
  if (!enforceProjectAccess(req, res, record.projectId, "distribution_records")) return;

  const events = await db
    .select()
    .from(distributionPaymentEventsTable)
    .where(eq(distributionPaymentEventsTable.distributionRecordId, id))
    .orderBy(desc(distributionPaymentEventsTable.performedAt));

  logSettlementAccess(req, "distribution_records", "view", id, record.projectId ?? undefined);
  return res.json({ record, events });
});

// ── PATCH /distribution-records/:id — update metadata ────────────────────

router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(distributionRecordsTable)
      .where(eq(distributionRecordsTable.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "archived") {
      return res.status(409).json({ error: "Cannot edit an archived record" });
    }

    const {
      accountingPeriodLabel, periodStart, periodEnd,
      linkedSaleIds, settlementType, linkedSettlementId,
      grossRevenue, settlementRecommendation, priorCarryForward,
      paymentProofUrl, paymentProofNotes, notes,
    } = req.body;

    const rec = parseFloat(settlementRecommendation ?? existing.settlementRecommendation ?? "0");
    const priorCf = parseFloat(priorCarryForward ?? existing.priorCarryForward ?? "0");
    const paid = parseFloat(existing.totalPaid ?? "0");
    const { pendingPayable, carryForwardBalance } = computeDerived(rec, paid, priorCf);

    const [updated] = await db
      .update(distributionRecordsTable)
      .set({
        accountingPeriodLabel: accountingPeriodLabel ?? existing.accountingPeriodLabel,
        periodStart: periodStart !== undefined ? periodStart : existing.periodStart,
        periodEnd: periodEnd !== undefined ? periodEnd : existing.periodEnd,
        linkedSaleIds: linkedSaleIds !== undefined ? linkedSaleIds : existing.linkedSaleIds,
        settlementType: settlementType !== undefined ? settlementType : existing.settlementType,
        linkedSettlementId: linkedSettlementId !== undefined ? linkedSettlementId : existing.linkedSettlementId,
        grossRevenue: grossRevenue !== undefined ? String(parseFloat(grossRevenue)) : existing.grossRevenue,
        settlementRecommendation: String(rec),
        pendingPayable: String(pendingPayable),
        priorCarryForward: String(priorCf),
        carryForwardBalance: String(carryForwardBalance),
        paymentProofUrl: paymentProofUrl !== undefined ? paymentProofUrl : existing.paymentProofUrl,
        paymentProofNotes: paymentProofNotes !== undefined ? paymentProofNotes : existing.paymentProofNotes,
        notes: notes !== undefined ? notes : existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(distributionRecordsTable.id, id))
      .returning();

    await writePaymentEvent({
      distributionRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "status_changed",
      previousStatus: existing.status,
      newStatus: updated.status,
      cumulativePaid: updated.totalPaid,
      remainingBalance: String(pendingPayable),
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: "Record metadata updated",
    });

    return res.json({ record: updated });
  }
);

// ── POST /distribution-records/:id/record-payment ─────────────────────────

router.post(
  "/:id/record-payment",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };
    const { paymentAmount, paymentDate, paymentRef, remarks, paymentProofUrl } = req.body;

    if (paymentAmount === undefined || parseFloat(paymentAmount) <= 0) {
      return res.status(400).json({ error: "paymentAmount must be > 0" });
    }

    const [existing] = await db
      .select()
      .from(distributionRecordsTable)
      .where(eq(distributionRecordsTable.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "paid") return res.status(409).json({ error: "Record is already fully paid" });
    if (existing.status === "archived") return res.status(409).json({ error: "Cannot record payment on archived record" });

    const amount = parseFloat(paymentAmount);
    const prevPaid = parseFloat(existing.totalPaid ?? "0");
    const recommendation = parseFloat(existing.settlementRecommendation ?? "0");
    const newTotalPaid = prevPaid + amount;
    const remaining = Math.max(0, recommendation - newTotalPaid);
    const isFullyPaid = remaining === 0;
    const newStatus = isFullyPaid ? "paid" : "partial";

    const [updated] = await db
      .update(distributionRecordsTable)
      .set({
        totalPaid: String(newTotalPaid),
        pendingPayable: String(remaining),
        carryForwardBalance: String(remaining),
        lastPaymentDate: paymentDate ?? new Date().toISOString().slice(0, 10),
        lastPaymentRef: paymentRef ?? null,
        paymentProofUrl: paymentProofUrl ?? existing.paymentProofUrl,
        status: newStatus,
        isPermanentRecord: true, // mark permanent once payment is recorded
        updatedAt: new Date(),
      })
      .where(eq(distributionRecordsTable.id, id))
      .returning();

    await writePaymentEvent({
      distributionRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: isFullyPaid ? "payment_recorded" : "partial_payment",
      paymentAmount: String(amount),
      cumulativePaid: String(newTotalPaid),
      remainingBalance: String(remaining),
      previousStatus: existing.status,
      newStatus,
      paymentDate: paymentDate ?? new Date().toISOString().slice(0, 10),
      paymentRef: paymentRef ?? null,
      remarks: remarks ?? null,
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      metadata: { paymentProofUrl: paymentProofUrl ?? null },
    });

    return res.json({ record: updated });
  }
);

// ── POST /distribution-records/:id/carry-forward ──────────────────────────

router.post(
  "/:id/carry-forward",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };
    const { remarks } = req.body;

    const [existing] = await db
      .select()
      .from(distributionRecordsTable)
      .where(eq(distributionRecordsTable.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "paid") return res.status(409).json({ error: "Record is already fully paid" });
    if (existing.status === "carried_forward") return res.status(409).json({ error: "Already carried forward" });
    if (existing.status === "archived") return res.status(409).json({ error: "Cannot carry forward archived record" });

    const balance = parseFloat(existing.pendingPayable ?? "0");

    const [updated] = await db
      .update(distributionRecordsTable)
      .set({
        status: "carried_forward",
        carryForwardBalance: String(balance),
        isPermanentRecord: true,
        updatedAt: new Date(),
      })
      .where(eq(distributionRecordsTable.id, id))
      .returning();

    await writePaymentEvent({
      distributionRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "carried_forward",
      cumulativePaid: existing.totalPaid,
      remainingBalance: String(balance),
      previousStatus: existing.status,
      newStatus: "carried_forward",
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: remarks ?? `Balance of ₹${balance.toFixed(2)} carried forward`,
      metadata: { carryForwardBalance: balance },
    });

    return res.json({ record: updated, carryForwardBalance: balance });
  }
);

// ── POST /distribution-records/:id/archive — soft archive (admin only) ────

router.post(
  "/:id/archive",
  requireRole("admin"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };
    const { remarks } = req.body;

    const [existing] = await db
      .select()
      .from(distributionRecordsTable)
      .where(eq(distributionRecordsTable.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.isPermanentRecord) {
      return res.status(409).json({ error: "Permanent records cannot be archived — they must remain preserved indefinitely" });
    }

    const [updated] = await db
      .update(distributionRecordsTable)
      .set({ isActive: false, status: "archived", updatedAt: new Date() })
      .where(eq(distributionRecordsTable.id, id))
      .returning();

    await writePaymentEvent({
      distributionRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "archived",
      previousStatus: existing.status,
      newStatus: "archived",
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: remarks ?? "Record archived",
    });

    return res.json({ record: updated });
  }
);

// ── GET /distribution-records/:id/events — event log ─────────────────────

router.get("/:id/events", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params as { id: string };

  const [record] = await db
    .select({ id: distributionRecordsTable.id, projectId: distributionRecordsTable.projectId })
    .from(distributionRecordsTable)
    .where(eq(distributionRecordsTable.id, id))
    .limit(1);

  if (!record) return res.status(404).json({ error: "Record not found" });
  if (!enforceProjectAccess(req, res, record.projectId, "distribution_records_events")) return;

  const events = await db
    .select()
    .from(distributionPaymentEventsTable)
    .where(eq(distributionPaymentEventsTable.distributionRecordId, id))
    .orderBy(desc(distributionPaymentEventsTable.performedAt));

  logSettlementAccess(req, "distribution_records", "events", id, record.projectId ?? undefined);
  return res.json({ distributionRecordId: id, events, total: events.length });
});

export default router;

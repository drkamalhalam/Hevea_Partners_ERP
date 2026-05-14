/**
 * loss_absorption.ts
 *
 * Loss Absorption & Negative Balance Adjustment Engine.
 * Routes mounted at /loss-absorption.
 *
 * ADVISORY ONLY — no automatic payments or settlements are triggered.
 *
 * Settlement priority recommendation (advisory):
 *   1. Recover past imbalances (pending negative balance entries)
 *   2. Pay pending LCA (outstanding lca_ledger balances)
 *   3. Distribute current profit (confirmed fifty_pct_sessions)
 */

import { Router } from "express";
import {
  db,
  lossAbsorptionRecordsTable,
  negativeBalanceEntriesTable,
  imbalanceLedgerTable,
  lcaLedgerTable,
  fiftyPctSessionsTable,
  agreementsTable,
  usersTable,
  projectsTable,
  partnersTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { eq, and, desc, asc, inArray, ne, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";
import { z } from "zod/v4";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  return parseFloat(String(v ?? "0")) || 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map((r) => r.projectId);
}

// ── Validation schemas ─────────────────────────────────────────────────────

const CreateLossRecordSchema = z.object({
  projectId: z.string().min(1),
  partnerId: z.string().min(1),
  periodLabel: z.string().min(1),
  periodYear: z.number().int().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  expectedBurden: z.number().min(0).default(0),
  actualBurden: z.number().min(0).default(0),
  grossEntitlement: z.number().min(0).default(0),
  notes: z.string().optional(),
});

const UpdateLossRecordSchema = z.object({
  periodLabel: z.string().optional(),
  periodYear: z.number().int().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  expectedBurden: z.number().min(0).optional(),
  actualBurden: z.number().min(0).optional(),
  grossEntitlement: z.number().min(0).optional(),
  carryForwardAmount: z.number().min(0).optional(),
  carryForwardStatus: z.enum(["none", "pending", "partial", "resolved"]).optional(),
  resolvedAmount: z.number().min(0).optional(),
  resolutionNote: z.string().optional(),
  notes: z.string().optional(),
});

const CreateNegativeBalanceSchema = z.object({
  projectId: z.string().min(1),
  partnerId: z.string().min(1),
  referenceType: z.enum([
    "loss_absorption",
    "lca_shortfall",
    "settlement_deficit",
    "burden_imbalance",
    "manual_adjustment",
    "recovery_credit",
  ]),
  referenceId: z.string().optional(),
  periodLabel: z.string().min(1),
  changeAmount: z.number(),
  description: z.string().min(1),
  notes: z.string().optional(),
});

const UpdateNegativeBalanceSchema = z.object({
  description: z.string().optional(),
  notes: z.string().optional(),
  recoveryStatus: z.enum(["pending", "partial", "recovered", "waived"]).optional(),
  recoveredAmount: z.number().min(0).optional(),
});

// ── Helper: compute derived loss fields ───────────────────────────────────

function computeLossFields(
  expectedBurden: number,
  actualBurden: number,
  grossEntitlement: number,
) {
  const burdenImbalance = round2(actualBurden - expectedBurden);
  const lossAbsorbed = round2(Math.max(0, actualBurden - grossEntitlement));
  const netAfterBurden = round2(grossEntitlement - actualBurden);
  return { burdenImbalance, lossAbsorbed, netAfterBurden };
}

// ── Helper: get latest closing balance for a (project, partner) ────────────

async function getLatestClosingBalance(
  projectId: string,
  partnerId: string,
): Promise<number> {
  const [latest] = await db
    .select({ closingBalance: negativeBalanceEntriesTable.closingBalance })
    .from(negativeBalanceEntriesTable)
    .where(
      and(
        eq(negativeBalanceEntriesTable.projectId, projectId),
        eq(negativeBalanceEntriesTable.partnerId, partnerId),
        eq(negativeBalanceEntriesTable.isActive, true),
      ),
    )
    .orderBy(desc(negativeBalanceEntriesTable.createdAt))
    .limit(1);
  return n(latest?.closingBalance);
}

// ══════════════════════════════════════════════════════════════════════════
// LOSS ABSORPTION RECORDS
// ══════════════════════════════════════════════════════════════════════════

// GET /loss-absorption/records
router.get("/records", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(auth.userId);
  if (!actor) return res.status(403).json({ error: "User not found" });

  const { role } = req.query as { role?: string };
  const actorRole = (req as any).auth?.role ?? role ?? "employee";

  const { projectId, partnerId, status } = req.query as Record<string, string>;

  let projectIds: string[] | null = null;
  if (!canAccessAllProjects(actorRole)) {
    projectIds = await getAssignedProjectIds(actor.id);
  }

  const conditions: any[] = [eq(lossAbsorptionRecordsTable.isActive, true)];
  if (projectId) conditions.push(eq(lossAbsorptionRecordsTable.projectId, projectId));
  if (partnerId) conditions.push(eq(lossAbsorptionRecordsTable.partnerId, partnerId));
  if (status) conditions.push(eq(lossAbsorptionRecordsTable.status, status));
  if (projectIds !== null && projectIds.length > 0) {
    conditions.push(inArray(lossAbsorptionRecordsTable.projectId, projectIds));
  } else if (projectIds !== null && projectIds.length === 0) {
    return res.json({ records: [], total: 0 });
  }

  const rows = await db
    .select({
      record: lossAbsorptionRecordsTable,
      projectName: projectsTable.name,
      partnerName: partnersTable.name,
    })
    .from(lossAbsorptionRecordsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, lossAbsorptionRecordsTable.projectId))
    .leftJoin(partnersTable, eq(partnersTable.id, lossAbsorptionRecordsTable.partnerId))
    .where(and(...conditions))
    .orderBy(desc(lossAbsorptionRecordsTable.createdAt));

  const records = rows.map(({ record, projectName, partnerName }) => ({
    ...record,
    projectName,
    partnerName,
  }));

  return res.json({ records, total: records.length });
});

// POST /loss-absorption/records
router.post(
  "/records",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActor(auth.userId);
    if (!actor) return res.status(403).json({ error: "User not found" });

    const parsed = CreateLossRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const {
      projectId, partnerId, periodLabel, periodYear,
      periodStart, periodEnd, expectedBurden, actualBurden, grossEntitlement, notes,
    } = parsed.data;

    const { burdenImbalance, lossAbsorbed, netAfterBurden } = computeLossFields(
      expectedBurden, actualBurden, grossEntitlement,
    );

    const carryForwardAmount = lossAbsorbed;
    const carryForwardStatus = lossAbsorbed > 0 ? "pending" : "none";

    const [record] = await db
      .insert(lossAbsorptionRecordsTable)
      .values({
        projectId,
        partnerId,
        periodLabel,
        periodYear,
        periodStart,
        periodEnd,
        expectedBurden: String(expectedBurden),
        actualBurden: String(actualBurden),
        grossEntitlement: String(grossEntitlement),
        burdenImbalance: String(burdenImbalance),
        lossAbsorbed: String(lossAbsorbed),
        netAfterBurden: String(netAfterBurden),
        carryForwardAmount: String(carryForwardAmount),
        carryForwardStatus,
        notes,
        createdBy: actor.id,
        createdByName: actor.displayName ?? undefined,
      })
      .returning();

    return res.status(201).json({ record });
  },
);

// PATCH /loss-absorption/records/:id
router.patch(
  "/records/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

    const [existing] = await db
      .select()
      .from(lossAbsorptionRecordsTable)
      .where(
        and(
          eq(lossAbsorptionRecordsTable.id, id),
          eq(lossAbsorptionRecordsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status !== "draft") {
      return res.status(409).json({ error: "Only draft records can be edited" });
    }

    const parsed = UpdateLossRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const data = parsed.data;

    // Recompute derived fields if burden figures change
    const expectedBurden = data.expectedBurden ?? n(existing.expectedBurden);
    const actualBurden = data.actualBurden ?? n(existing.actualBurden);
    const grossEntitlement = data.grossEntitlement ?? n(existing.grossEntitlement);
    const { burdenImbalance, lossAbsorbed, netAfterBurden } = computeLossFields(
      expectedBurden, actualBurden, grossEntitlement,
    );

    const carryForwardAmount = data.carryForwardAmount ?? lossAbsorbed;
    const carryForwardStatus = data.carryForwardStatus ?? (lossAbsorbed > 0 ? "pending" : "none");

    const [updated] = await db
      .update(lossAbsorptionRecordsTable)
      .set({
        ...(data.periodLabel !== undefined && { periodLabel: data.periodLabel }),
        ...(data.periodYear !== undefined && { periodYear: data.periodYear }),
        ...(data.periodStart !== undefined && { periodStart: data.periodStart }),
        ...(data.periodEnd !== undefined && { periodEnd: data.periodEnd }),
        expectedBurden: String(expectedBurden),
        actualBurden: String(actualBurden),
        grossEntitlement: String(grossEntitlement),
        burdenImbalance: String(burdenImbalance),
        lossAbsorbed: String(lossAbsorbed),
        netAfterBurden: String(netAfterBurden),
        carryForwardAmount: String(carryForwardAmount),
        carryForwardStatus,
        ...(data.resolvedAmount !== undefined && { resolvedAmount: String(data.resolvedAmount) }),
        ...(data.resolutionNote !== undefined && { resolutionNote: data.resolutionNote }),
        ...(data.notes !== undefined && { notes: data.notes }),
        updatedAt: new Date(),
      })
      .where(eq(lossAbsorptionRecordsTable.id, id))
      .returning();

    return res.json({ record: updated });
  },
);

// POST /loss-absorption/records/:id/confirm
router.post(
  "/records/:id/confirm",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActor(auth.userId);
    if (!actor) return res.status(403).json({ error: "User not found" });

    const [existing] = await db
      .select()
      .from(lossAbsorptionRecordsTable)
      .where(
        and(
          eq(lossAbsorptionRecordsTable.id, id),
          eq(lossAbsorptionRecordsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "confirmed") {
      return res.status(409).json({ error: "Already confirmed" });
    }

    const [updated] = await db
      .update(lossAbsorptionRecordsTable)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedBy: actor.id,
        confirmedByName: actor.displayName ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(lossAbsorptionRecordsTable.id, id))
      .returning();

    return res.json({ record: updated });
  },
);

// DELETE /loss-absorption/records/:id (admin only; soft delete)
router.delete(
  "/records/:id",
  requireRole("admin"),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select({ id: lossAbsorptionRecordsTable.id })
      .from(lossAbsorptionRecordsTable)
      .where(eq(lossAbsorptionRecordsTable.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Record not found" });

    await db
      .update(lossAbsorptionRecordsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(lossAbsorptionRecordsTable.id, id));

    return res.json({ ok: true });
  },
);

// ══════════════════════════════════════════════════════════════════════════
// NEGATIVE BALANCE ENTRIES
// ══════════════════════════════════════════════════════════════════════════

// GET /loss-absorption/negative-balance
router.get("/negative-balance", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(auth.userId);
  if (!actor) return res.status(403).json({ error: "User not found" });

  const { projectId, partnerId, referenceType, recoveryStatus } = req.query as Record<string, string>;

  const conditions: any[] = [eq(negativeBalanceEntriesTable.isActive, true)];
  if (projectId) conditions.push(eq(negativeBalanceEntriesTable.projectId, projectId));
  if (partnerId) conditions.push(eq(negativeBalanceEntriesTable.partnerId, partnerId));
  if (referenceType) conditions.push(eq(negativeBalanceEntriesTable.referenceType, referenceType));
  if (recoveryStatus) conditions.push(eq(negativeBalanceEntriesTable.recoveryStatus, recoveryStatus));

  const rows = await db
    .select({
      entry: negativeBalanceEntriesTable,
      projectName: projectsTable.name,
      partnerName: partnersTable.name,
    })
    .from(negativeBalanceEntriesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, negativeBalanceEntriesTable.projectId))
    .leftJoin(partnersTable, eq(partnersTable.id, negativeBalanceEntriesTable.partnerId))
    .where(and(...conditions))
    .orderBy(asc(negativeBalanceEntriesTable.createdAt));

  const entries = rows.map(({ entry, projectName, partnerName }) => ({
    ...entry,
    projectName,
    partnerName,
  }));

  // Compute running summary per (project, partner)
  const balanceMap: Record<string, number> = {};
  for (const e of entries) {
    const key = `${e.projectId}::${e.partnerId}`;
    balanceMap[key] = n(e.closingBalance);
  }

  return res.json({ entries, total: entries.length, currentBalances: balanceMap });
});

// POST /loss-absorption/negative-balance
router.post(
  "/negative-balance",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActor(auth.userId);
    if (!actor) return res.status(403).json({ error: "User not found" });

    const parsed = CreateNegativeBalanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const {
      projectId, partnerId, referenceType, referenceId,
      periodLabel, changeAmount, description, notes,
    } = parsed.data;

    const openingBalance = await getLatestClosingBalance(projectId, partnerId);
    const closingBalance = round2(openingBalance + changeAmount);

    const recoveryStatus = changeAmount < 0 ? "pending" : "recovered";

    const [entry] = await db
      .insert(negativeBalanceEntriesTable)
      .values({
        projectId,
        partnerId,
        referenceType,
        referenceId,
        periodLabel,
        openingBalance: String(openingBalance),
        changeAmount: String(changeAmount),
        closingBalance: String(closingBalance),
        description,
        notes,
        recoveryStatus,
        createdBy: actor.id,
        createdByName: actor.displayName ?? undefined,
      })
      .returning();

    return res.status(201).json({ entry });
  },
);

// PATCH /loss-absorption/negative-balance/:id
router.patch(
  "/negative-balance/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

    const [existing] = await db
      .select()
      .from(negativeBalanceEntriesTable)
      .where(
        and(
          eq(negativeBalanceEntriesTable.id, id),
          eq(negativeBalanceEntriesTable.isActive, true),
        ),
      )
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Entry not found" });

    const parsed = UpdateNegativeBalanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const data = parsed.data;
    const [updated] = await db
      .update(negativeBalanceEntriesTable)
      .set({
        ...(data.description !== undefined && { description: data.description }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.recoveryStatus !== undefined && { recoveryStatus: data.recoveryStatus }),
        ...(data.recoveredAmount !== undefined && { recoveredAmount: String(data.recoveredAmount) }),
        updatedAt: new Date(),
      })
      .where(eq(negativeBalanceEntriesTable.id, id))
      .returning();

    return res.json({ entry: updated });
  },
);

// ══════════════════════════════════════════════════════════════════════════
// SETTLEMENT PRIORITY RECOMMENDATION (Advisory)
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /loss-absorption/settlement-priority?projectId=&partnerId=
 *
 * Advisory settlement priority recommendation.
 *
 * Computes a three-tier allocation waterfall:
 *   Tier 1: Recover past imbalances (pending negative_balance_entries)
 *   Tier 2: Pay pending LCA (outstanding lca_ledger)
 *   Tier 3: Distribute current profit (confirmed fifty_pct_sessions)
 *
 * availableFunds = sum of confirmed fifty_pct landowner nets for this partner
 *
 * ADVISORY ONLY — no payments are triggered.
 */
router.get("/settlement-priority", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { projectId, partnerId } = req.query as Record<string, string>;
  if (!projectId || !partnerId) {
    return res.status(400).json({ error: "projectId and partnerId are required" });
  }

  // ── Available funds: sum of confirmed fifty_pct landowner net for this partner ──

  const profitSessions = await db
    .select({
      id: fiftyPctSessionsTable.id,
      periodLabel: fiftyPctSessionsTable.periodLabel,
      grossRevenue: fiftyPctSessionsTable.grossRevenue,
      landownerNet: fiftyPctSessionsTable.landownerNet,
      landownerSplit: fiftyPctSessionsTable.landownerSplit,
      operationalCost: fiftyPctSessionsTable.operationalCost,
      lcaAmount: fiftyPctSessionsTable.lcaAmount,
      confirmedAt: fiftyPctSessionsTable.confirmedAt,
    })
    .from(fiftyPctSessionsTable)
    .innerJoin(
      agreementsTable,
      and(
        eq(agreementsTable.projectId, fiftyPctSessionsTable.projectId),
        eq(agreementsTable.landOwnerId, partnerId),
      ),
    )
    .where(
      and(
        eq(fiftyPctSessionsTable.projectId, projectId),
        eq(fiftyPctSessionsTable.status, "confirmed"),
      ),
    );

  const totalProfitShare = profitSessions.reduce((acc, s) => acc + n(s.landownerNet), 0);

  // ── Tier 1: Pending negative balances (past imbalances to recover) ──

  const pendingNegativeEntries = await db
    .select()
    .from(negativeBalanceEntriesTable)
    .where(
      and(
        eq(negativeBalanceEntriesTable.projectId, projectId),
        eq(negativeBalanceEntriesTable.partnerId, partnerId),
        eq(negativeBalanceEntriesTable.isActive, true),
        eq(negativeBalanceEntriesTable.recoveryStatus, "pending"),
      ),
    )
    .orderBy(asc(negativeBalanceEntriesTable.createdAt));

  // Also pull confirmed loss absorption records with pending carry-forwards
  const pendingLossRecords = await db
    .select()
    .from(lossAbsorptionRecordsTable)
    .where(
      and(
        eq(lossAbsorptionRecordsTable.projectId, projectId),
        eq(lossAbsorptionRecordsTable.partnerId, partnerId),
        eq(lossAbsorptionRecordsTable.isActive, true),
        eq(lossAbsorptionRecordsTable.status, "confirmed"),
        ne(lossAbsorptionRecordsTable.carryForwardStatus, "resolved"),
      ),
    )
    .orderBy(asc(lossAbsorptionRecordsTable.createdAt));

  const tier1TotalPendingImbalance = pendingNegativeEntries.reduce(
    (acc, e) => acc + Math.abs(Math.min(0, n(e.closingBalance))),
    0,
  );
  const tier1CarryForwardUnresolved = pendingLossRecords.reduce(
    (acc, r) => acc + (n(r.carryForwardAmount) - n(r.resolvedAmount)),
    0,
  );
  const tier1Total = round2(Math.max(tier1TotalPendingImbalance, tier1CarryForwardUnresolved));

  // ── Tier 2: Pending LCA ──

  const lcaEntries = await db
    .select({
      id: lcaLedgerTable.id,
      year: lcaLedgerTable.year,
      totalDue: lcaLedgerTable.totalDue,
      amountPaid: lcaLedgerTable.amountPaid,
      balance: lcaLedgerTable.balance,
      status: lcaLedgerTable.status,
    })
    .from(lcaLedgerTable)
    .where(
      and(
        eq(lcaLedgerTable.projectId, projectId),
        eq(lcaLedgerTable.isActive, true),
        ne(lcaLedgerTable.status, "paid"),
      ),
    )
    .orderBy(asc(lcaLedgerTable.year));

  const tier2Total = round2(lcaEntries.reduce((acc, e) => acc + n(e.balance), 0));

  // ── Waterfall allocation ──

  let remaining = totalProfitShare;

  const tier1Allocated = round2(Math.min(remaining, tier1Total));
  remaining = round2(remaining - tier1Allocated);

  const tier2Allocated = round2(Math.min(remaining, tier2Total));
  remaining = round2(remaining - tier2Allocated);

  const tier3Allocated = round2(Math.max(0, remaining));

  // ── Build response ──

  const disclaimer =
    "ADVISORY ONLY. This recommendation is computed from confirmed records. " +
    "Final settlement amounts are determined manually by authorised partners. " +
    "No payment or obligation is created by this recommendation.";

  return res.json({
    projectId,
    partnerId,
    availableFunds: round2(totalProfitShare),
    waterfall: {
      tier1: {
        label: "Recover Past Imbalances",
        description:
          "Pending negative balance entries and unresolved carry-forward losses that must be recovered first",
        obligationTotal: tier1Total,
        allocated: tier1Allocated,
        fullyFunded: tier1Allocated >= tier1Total,
        shortfall: round2(Math.max(0, tier1Total - tier1Allocated)),
        items: {
          pendingNegativeEntries: pendingNegativeEntries.map((e) => ({
            id: e.id,
            periodLabel: e.periodLabel,
            referenceType: e.referenceType,
            closingBalance: n(e.closingBalance),
            description: e.description,
          })),
          pendingCarryForwards: pendingLossRecords.map((r) => ({
            id: r.id,
            periodLabel: r.periodLabel,
            carryForwardAmount: n(r.carryForwardAmount),
            resolvedAmount: n(r.resolvedAmount),
            outstanding: round2(n(r.carryForwardAmount) - n(r.resolvedAmount)),
          })),
        },
      },
      tier2: {
        label: "Pay Pending LCA",
        description:
          "Outstanding Land Contribution Adjustments — must be settled before distributing profit",
        obligationTotal: tier2Total,
        allocated: tier2Allocated,
        fullyFunded: tier2Allocated >= tier2Total,
        shortfall: round2(Math.max(0, tier2Total - tier2Allocated)),
        items: lcaEntries.map((e) => ({
          id: e.id,
          year: e.year,
          periodLabel: String(e.year),
          totalDue: n(e.totalDue),
          amountPaid: n(e.amountPaid),
          balance: n(e.balance),
          status: e.status,
        })),
      },
      tier3: {
        label: "Distribute Current Profit",
        description:
          "Remaining funds after recovering past imbalances and settling LCA obligations",
        allocated: tier3Allocated,
        profitShareSessions: profitSessions.map((s) => ({
          id: s.id,
          periodLabel: s.periodLabel,
          grossRevenue: n(s.grossRevenue),
          landownerNet: n(s.landownerNet),
          confirmedAt: s.confirmedAt,
        })),
      },
    },
    summary: {
      availableFunds: round2(totalProfitShare),
      tier1Obligation: tier1Total,
      tier1Allocated,
      tier2Obligation: tier2Total,
      tier2Allocated,
      tier3Allocated,
      totalObligations: round2(tier1Total + tier2Total),
      netDistributable: tier3Allocated,
      surplusOrDeficit: round2(totalProfitShare - tier1Total - tier2Total),
    },
    computedAt: new Date().toISOString(),
    disclaimer,
  });
});

// ══════════════════════════════════════════════════════════════════════════
// FULL SUMMARY
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /loss-absorption/summary?projectId=&partnerId=
 *
 * Comprehensive summary for the dashboard:
 *   - KPIs: total loss absorbed, pending carry-forwards, current negative balance
 *   - Recent loss absorption records
 *   - Recent negative balance entries
 *   - Burden imbalance from imbalance_ledger
 */
router.get("/summary", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(auth.userId);
  if (!actor) return res.status(403).json({ error: "User not found" });

  const { projectId, partnerId } = req.query as Record<string, string>;
  if (!projectId || !partnerId) {
    return res.status(400).json({ error: "projectId and partnerId are required" });
  }

  // Parallel fetches
  const [lossRecords, negativeEntries, imbalanceLedger, project, partner] =
    await Promise.all([
      db
        .select()
        .from(lossAbsorptionRecordsTable)
        .where(
          and(
            eq(lossAbsorptionRecordsTable.projectId, projectId),
            eq(lossAbsorptionRecordsTable.partnerId, partnerId),
            eq(lossAbsorptionRecordsTable.isActive, true),
          ),
        )
        .orderBy(desc(lossAbsorptionRecordsTable.createdAt)),

      db
        .select()
        .from(negativeBalanceEntriesTable)
        .where(
          and(
            eq(negativeBalanceEntriesTable.projectId, projectId),
            eq(negativeBalanceEntriesTable.partnerId, partnerId),
            eq(negativeBalanceEntriesTable.isActive, true),
          ),
        )
        .orderBy(asc(negativeBalanceEntriesTable.createdAt)),

      db
        .select()
        .from(imbalanceLedgerTable)
        .where(
          and(
            eq(imbalanceLedgerTable.projectId, projectId),
            eq(imbalanceLedgerTable.isActive, true),
          ),
        )
        .orderBy(desc(imbalanceLedgerTable.createdAt)),

      db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1)
        .then((r) => r[0] ?? null),

      db
        .select({ id: partnersTable.id, name: partnersTable.name })
        .from(partnersTable)
        .where(eq(partnersTable.id, partnerId))
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

  // KPIs
  const confirmedRecords = lossRecords.filter((r) => r.status === "confirmed");
  const draftRecords = lossRecords.filter((r) => r.status === "draft");
  const totalLossAbsorbed = confirmedRecords.reduce((a, r) => a + n(r.lossAbsorbed), 0);
  const totalCarryForwardPending = confirmedRecords
    .filter((r) => r.carryForwardStatus !== "resolved")
    .reduce((a, r) => a + n(r.carryForwardAmount) - n(r.resolvedAmount), 0);
  const currentNegativeBalance = negativeEntries.length > 0
    ? n(negativeEntries[negativeEntries.length - 1].closingBalance)
    : 0;

  const totalBurdenImbalance = imbalanceLedger
    .filter((e) => e.partyRole === "landowner")
    .reduce((a, e) => a + n(e.amount), 0);

  // Period analytics: group loss records by year
  const byYear: Record<number, { expected: number; actual: number; loss: number; net: number }> = {};
  for (const r of confirmedRecords) {
    const yr = r.periodYear ?? 0;
    if (!byYear[yr]) byYear[yr] = { expected: 0, actual: 0, loss: 0, net: 0 };
    byYear[yr].expected += n(r.expectedBurden);
    byYear[yr].actual += n(r.actualBurden);
    byYear[yr].loss += n(r.lossAbsorbed);
    byYear[yr].net += n(r.netAfterBurden);
  }
  const periodAnalytics = Object.entries(byYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, vals]) => ({ year: Number(year), ...vals }));

  // Recovery analytics: how much negative balance has been recovered vs outstanding
  const totalNegativeCreated = negativeEntries
    .filter((e) => n(e.changeAmount) < 0)
    .reduce((a, e) => a + Math.abs(n(e.changeAmount)), 0);
  const totalRecovered = negativeEntries
    .filter((e) => n(e.changeAmount) > 0)
    .reduce((a, e) => a + n(e.changeAmount), 0);

  return res.json({
    projectId,
    partnerId,
    projectName: project?.name ?? null,
    partnerName: partner?.name ?? null,
    kpis: {
      totalLossAbsorbed: round2(totalLossAbsorbed),
      totalCarryForwardPending: round2(totalCarryForwardPending),
      currentNegativeBalance: round2(currentNegativeBalance),
      totalBurdenImbalance: round2(totalBurdenImbalance),
      confirmedRecordCount: confirmedRecords.length,
      draftRecordCount: draftRecords.length,
    },
    recovery: {
      totalNegativeCreated: round2(totalNegativeCreated),
      totalRecovered: round2(totalRecovered),
      outstanding: round2(totalNegativeCreated - totalRecovered),
      recoveryRate: totalNegativeCreated > 0
        ? round2((totalRecovered / totalNegativeCreated) * 100)
        : 100,
    },
    periodAnalytics,
    recentLossRecords: lossRecords.slice(0, 5),
    recentNegativeEntries: negativeEntries.slice(-5).reverse(),
    imbalanceLedgerSummary: {
      developerBalance: round2(
        imbalanceLedger
          .filter((e) => e.partyRole === "developer")
          .reduce((a, e) => a + n(e.amount), 0),
      ),
      landownerBalance: round2(totalBurdenImbalance),
    },
    computedAt: new Date().toISOString(),
  });
});

export default router;

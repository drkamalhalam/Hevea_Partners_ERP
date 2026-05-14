/**
 * payable.ts
 *
 * Partner Actual Payable Calculation Engine.
 * Routes mounted at /payable.
 *
 * RECOMMENDATION ONLY — final settlement stays manual.
 *
 * Formula:
 *   Profit Share (fifty_pct_sessions.landownerNet, partner = landowner via agreements)
 *   + Recoverable Advances (recoverable_advances where advancedByPartnerId = partner, outstanding)
 *   + Pending Recoveries (landowner_ledger isRecoverable, not fully recovered)
 *   + Pending LCA (lca_ledger outstanding balance)
 *   + Prior Imbalance Adjustments (payable_adjustments, net credit−debit)
 *   − Negative Carry Balances (payable_adjustments carry_balance debit entries)
 *   = Actual Payable Recommendation
 */

import { Router } from "express";
import {
  db,
  fiftyPctSessionsTable,
  agreementsTable,
  recoverableAdvancesTable,
  landownerLedgerTable,
  lcaLedgerTable,
  payableAdjustmentsTable,
  payableSnapshotsTable,
  partnersTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";
import { z } from "zod/v4";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

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

// ── Core compute function ─────────────────────────────────────────────────

async function computePayable(projectId: string, partnerId: string) {
  // ── 1. Profit Share: confirmed fifty_pct sessions where partner is landowner
  const sessions = await db
    .select({
      id: fiftyPctSessionsTable.id,
      periodLabel: fiftyPctSessionsTable.periodLabel,
      grossRevenue: fiftyPctSessionsTable.grossRevenue,
      landownerNet: fiftyPctSessionsTable.landownerNet,
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

  const profitShare = round2(
    sessions.reduce((s, r) => s + n(r.landownerNet), 0),
  );

  // ── 2. Recoverable Advances: amounts the partner advanced, not yet recovered
  const advances = await db
    .select({
      id: recoverableAdvancesTable.id,
      description: recoverableAdvancesTable.description,
      advancedDate: recoverableAdvancesTable.advancedDate,
      originalAmount: recoverableAdvancesTable.originalAmount,
      recoveredAmount: recoverableAdvancesTable.recoveredAmount,
      status: recoverableAdvancesTable.status,
    })
    .from(recoverableAdvancesTable)
    .where(
      and(
        eq(recoverableAdvancesTable.projectId, projectId),
        eq(recoverableAdvancesTable.advancedByPartnerId, partnerId),
        eq(recoverableAdvancesTable.isActive, true),
      ),
    );

  const advancesOutstanding = advances
    .filter((a) => a.status !== "recovered" && a.status !== "written_off")
    .map((a) => ({
      ...a,
      outstanding: round2(Math.max(0, n(a.originalAmount) - n(a.recoveredAmount))),
    }));
  const recoverableAdvancesAmount = round2(
    advancesOutstanding.reduce((s, a) => s + a.outstanding, 0),
  );

  // ── 3. Pending Recoveries: landowner ledger recoverable entries not fully recovered
  const ledgerRecoverable = await db
    .select({
      id: landownerLedgerTable.id,
      entryType: landownerLedgerTable.entryType,
      description: landownerLedgerTable.description,
      periodLabel: landownerLedgerTable.periodLabel,
      amount: landownerLedgerTable.amount,
      recoveredAmount: landownerLedgerTable.recoveredAmount,
      recoveryStatus: landownerLedgerTable.recoveryStatus,
    })
    .from(landownerLedgerTable)
    .where(
      and(
        eq(landownerLedgerTable.projectId, projectId),
        eq(landownerLedgerTable.partnerId, partnerId),
        eq(landownerLedgerTable.isRecoverable, true),
        eq(landownerLedgerTable.status, "confirmed"),
      ),
    );

  const ledgerPending = ledgerRecoverable
    .filter((e) => e.recoveryStatus !== "full")
    .map((e) => ({
      ...e,
      outstanding: round2(Math.max(0, n(e.amount) - n(e.recoveredAmount ?? 0))),
    }));
  const pendingRecoveriesAmount = round2(
    ledgerPending.reduce((s, e) => s + e.outstanding, 0),
  );

  // ── 4. Pending LCA: outstanding lca_ledger balance for this project
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
      ),
    )
    .orderBy(lcaLedgerTable.year);

  const lcaPending = lcaEntries.filter((e) => e.status !== "paid");
  const pendingLcaAmount = round2(
    lcaPending.reduce((s, e) => s + n(e.balance), 0),
  );

  // ── 5. Manual payable adjustments (confirmed)
  const adjustments = await db
    .select()
    .from(payableAdjustmentsTable)
    .where(
      and(
        eq(payableAdjustmentsTable.projectId, projectId),
        eq(payableAdjustmentsTable.partnerId, partnerId),
        eq(payableAdjustmentsTable.isActive, true),
        eq(payableAdjustmentsTable.status, "confirmed"),
      ),
    )
    .orderBy(payableAdjustmentsTable.createdAt);

  const imbalanceAdj = adjustments.filter(
    (a) => a.adjustmentType === "imbalance_adjustment",
  );
  const carryBalance = adjustments.filter(
    (a) =>
      a.adjustmentType === "carry_balance" && a.direction === "debit",
  );
  const otherAdj = adjustments.filter(
    (a) =>
      a.adjustmentType !== "imbalance_adjustment" &&
      a.adjustmentType !== "carry_balance",
  );

  const priorAdjustmentsAmount = round2(
    imbalanceAdj.reduce(
      (s, a) => s + (a.direction === "credit" ? 1 : -1) * n(a.amount),
      0,
    ) +
      otherAdj.reduce(
        (s, a) => s + (a.direction === "credit" ? 1 : -1) * n(a.amount),
        0,
      ),
  );

  const negativeCarryAmount = round2(
    carryBalance.reduce((s, a) => s + n(a.amount), 0),
  );

  // ── Formula ───────────────────────────────────────────────────────────────

  const actualPayable = round2(
    profitShare +
      recoverableAdvancesAmount +
      pendingRecoveriesAmount +
      pendingLcaAmount +
      priorAdjustmentsAmount -
      negativeCarryAmount,
  );

  const breakdown = {
    profitShare: {
      amount: profitShare,
      sessions: sessions.map((s) => ({
        id: s.id,
        periodLabel: s.periodLabel,
        grossRevenue: n(s.grossRevenue),
        landownerNet: n(s.landownerNet),
        confirmedAt: s.confirmedAt,
      })),
    },
    recoverableAdvances: {
      amount: recoverableAdvancesAmount,
      items: advancesOutstanding,
    },
    pendingRecoveries: {
      amount: pendingRecoveriesAmount,
      items: ledgerPending,
    },
    pendingLca: {
      amount: pendingLcaAmount,
      items: lcaPending,
    },
    priorAdjustments: {
      amount: priorAdjustmentsAmount,
      items: [...imbalanceAdj, ...otherAdj].map((a) => ({
        ...a,
        amount: n(a.amount),
        signedAmount:
          (a.direction === "credit" ? 1 : -1) * n(a.amount),
      })),
    },
    negativeCarry: {
      amount: negativeCarryAmount,
      items: carryBalance.map((a) => ({ ...a, amount: n(a.amount) })),
    },
  };

  return {
    projectId,
    partnerId,
    profitShareAmount: profitShare,
    profitShareSource: "fifty_pct" as const,
    recoverableAdvancesAmount,
    pendingRecoveriesAmount,
    pendingLcaAmount,
    priorAdjustmentsAmount,
    negativeCarryAmount,
    actualPayable,
    breakdown,
  };
}

// ── Validation schemas ─────────────────────────────────────────────────────

const CreateAdjustmentSchema = z.object({
  projectId: z.string().uuid(),
  partnerId: z.string().uuid(),
  adjustmentType: z.enum([
    "imbalance_adjustment",
    "carry_balance",
    "other_credit",
    "other_debit",
  ]),
  direction: z.enum(["credit", "debit"]),
  amount: z.number().positive(),
  periodLabel: z.string().optional(),
  description: z.string().min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

const UpdateAdjustmentSchema = z.object({
  adjustmentType: z
    .enum(["imbalance_adjustment", "carry_balance", "other_credit", "other_debit"])
    .optional(),
  direction: z.enum(["credit", "debit"]).optional(),
  amount: z.number().positive().optional(),
  periodLabel: z.string().optional(),
  description: z.string().min(1).optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

const CreateSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  partnerId: z.string().uuid(),
  periodLabel: z.string().min(1),
  notes: z.string().optional(),
});

// ══════════════════════════════════════════════════════════════════════
// STATIC ROUTES (before /:id wildcards)
// ══════════════════════════════════════════════════════════════════════

// ── GET /payable/compute ──────────────────────────────────────────────────

router.get("/compute", async (req, res) => {
  const { projectId, partnerId } = req.query as {
    projectId?: string;
    partnerId?: string;
  };

  if (!projectId || !partnerId) {
    return res.status(400).json({ error: "projectId and partnerId are required" });
  }

  const result = await computePayable(projectId, partnerId);

  // Resolve names for display
  const [project] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  const [partner] = await db
    .select({ name: partnersTable.name })
    .from(partnersTable)
    .where(eq(partnersTable.id, partnerId))
    .limit(1);

  return res.json({
    ...result,
    projectName: project?.name ?? null,
    partnerName: partner?.name ?? null,
    computedAt: new Date().toISOString(),
    disclaimer:
      "This is a recommendation only. Final settlement amounts are determined manually.",
  });
});

// ── GET /payable/adjustments ──────────────────────────────────────────────

router.get("/adjustments", async (req, res) => {
  const { projectId, partnerId, type, status } = req.query as {
    projectId?: string;
    partnerId?: string;
    type?: string;
    status?: string;
  };

  const conditions: ReturnType<typeof eq>[] = [
    eq(payableAdjustmentsTable.isActive, true),
  ];
  if (projectId) conditions.push(eq(payableAdjustmentsTable.projectId, projectId));
  if (partnerId) conditions.push(eq(payableAdjustmentsTable.partnerId, partnerId));
  if (type) conditions.push(eq(payableAdjustmentsTable.adjustmentType, type));
  if (status) conditions.push(eq(payableAdjustmentsTable.status, status));

  const adjustments = await db
    .select()
    .from(payableAdjustmentsTable)
    .where(and(...conditions))
    .orderBy(desc(payableAdjustmentsTable.createdAt));

  return res.json({ adjustments, total: adjustments.length });
});

// ── POST /payable/adjustments ─────────────────────────────────────────────

router.post(
  "/adjustments",
  requireRole("admin", "developer"),
  async (req, res) => {
    const parsed = CreateAdjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

    const d = parsed.data;
    const [adj] = await db
      .insert(payableAdjustmentsTable)
      .values({
        projectId: d.projectId,
        partnerId: d.partnerId,
        adjustmentType: d.adjustmentType,
        direction: d.direction,
        amount: String(d.amount),
        periodLabel: d.periodLabel,
        description: d.description,
        reference: d.reference,
        notes: d.notes,
        createdBy: actor?.id,
        createdByName: actor?.displayName ?? null,
      })
      .returning();

    return res.status(201).json({ adjustment: adj });
  },
);

// ── GET /payable/snapshots ────────────────────────────────────────────────

router.get("/snapshots", async (req, res) => {
  const { projectId, partnerId } = req.query as {
    projectId?: string;
    partnerId?: string;
  };

  const conditions: ReturnType<typeof eq>[] = [
    eq(payableSnapshotsTable.isActive, true),
  ];
  if (projectId) conditions.push(eq(payableSnapshotsTable.projectId, projectId));
  if (partnerId) conditions.push(eq(payableSnapshotsTable.partnerId, partnerId));

  const snapshots = await db
    .select()
    .from(payableSnapshotsTable)
    .where(and(...conditions))
    .orderBy(desc(payableSnapshotsTable.computedAt));

  return res.json({ snapshots, total: snapshots.length });
});

// ── POST /payable/snapshots ───────────────────────────────────────────────

router.post(
  "/snapshots",
  requireRole("admin", "developer"),
  async (req, res) => {
    const parsed = CreateSnapshotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

    const d = parsed.data;
    const computed = await computePayable(d.projectId, d.partnerId);

    const [snapshot] = await db
      .insert(payableSnapshotsTable)
      .values({
        projectId: d.projectId,
        partnerId: d.partnerId,
        periodLabel: d.periodLabel,
        profitShareAmount: String(computed.profitShareAmount),
        profitShareSource: computed.profitShareSource,
        recoverableAdvancesAmount: String(computed.recoverableAdvancesAmount),
        pendingRecoveriesAmount: String(computed.pendingRecoveriesAmount),
        pendingLcaAmount: String(computed.pendingLcaAmount),
        priorAdjustmentsAmount: String(computed.priorAdjustmentsAmount),
        negativeCarryAmount: String(computed.negativeCarryAmount),
        actualPayable: String(computed.actualPayable),
        breakdown: computed.breakdown,
        generatedBy: actor?.id,
        generatedByName: actor?.displayName ?? null,
        notes: d.notes,
      })
      .returning();

    return res.status(201).json({ snapshot, computation: computed });
  },
);

// ══════════════════════════════════════════════════════════════════════
// ADJUSTMENT INSTANCE ROUTES  /adjustments/:id
// ══════════════════════════════════════════════════════════════════════

// ── PATCH /payable/adjustments/:id ───────────────────────────────────────

router.patch(
  "/adjustments/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(payableAdjustmentsTable)
      .where(
        and(
          eq(payableAdjustmentsTable.id, id),
          eq(payableAdjustmentsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Adjustment not found" });
    if (existing.status === "confirmed") {
      return res.status(409).json({ error: "Cannot edit a confirmed adjustment" });
    }

    const parsed = UpdateAdjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const d = parsed.data;
    const setPayload: Partial<typeof payableAdjustmentsTable.$inferInsert> & {
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (d.adjustmentType !== undefined) setPayload.adjustmentType = d.adjustmentType;
    if (d.direction !== undefined) setPayload.direction = d.direction;
    if (d.amount !== undefined) setPayload.amount = String(d.amount);
    if (d.periodLabel !== undefined) setPayload.periodLabel = d.periodLabel;
    if (d.description !== undefined) setPayload.description = d.description;
    if (d.reference !== undefined) setPayload.reference = d.reference;
    if (d.notes !== undefined) setPayload.notes = d.notes;

    const [updated] = await db
      .update(payableAdjustmentsTable)
      .set(setPayload)
      .where(eq(payableAdjustmentsTable.id, id))
      .returning();

    return res.json({ adjustment: updated });
  },
);

// ── POST /payable/adjustments/:id/confirm ────────────────────────────────

router.post(
  "/adjustments/:id/confirm",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(payableAdjustmentsTable)
      .where(
        and(
          eq(payableAdjustmentsTable.id, id),
          eq(payableAdjustmentsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Adjustment not found" });
    if (existing.status === "confirmed") {
      return res.status(409).json({ error: "Already confirmed" });
    }

    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

    const [updated] = await db
      .update(payableAdjustmentsTable)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedBy: actor?.id,
        confirmedByName: actor?.displayName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(payableAdjustmentsTable.id, id))
      .returning();

    return res.json({ adjustment: updated });
  },
);

// ── DELETE /payable/adjustments/:id ──────────────────────────────────────

router.delete(
  "/adjustments/:id",
  requireRole("admin"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: payableAdjustmentsTable.id })
      .from(payableAdjustmentsTable)
      .where(
        and(
          eq(payableAdjustmentsTable.id, id),
          eq(payableAdjustmentsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Adjustment not found" });

    await db
      .update(payableAdjustmentsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(payableAdjustmentsTable.id, id));

    return res.json({ ok: true });
  },
);

// ══════════════════════════════════════════════════════════════════════
// SNAPSHOT INSTANCE ROUTES  /snapshots/:id
// ══════════════════════════════════════════════════════════════════════

// ── GET /payable/snapshots/:id ────────────────────────────────────────────

router.get("/snapshots/:id", async (req, res) => {
  const { id } = req.params as { id: string };

  const [snapshot] = await db
    .select()
    .from(payableSnapshotsTable)
    .where(
      and(
        eq(payableSnapshotsTable.id, id),
        eq(payableSnapshotsTable.isActive, true),
      ),
    )
    .limit(1);

  if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });
  return res.json({ snapshot });
});

// ── POST /payable/snapshots/:id/finalize ─────────────────────────────────

router.post(
  "/snapshots/:id/finalize",
  requireRole("admin"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: payableSnapshotsTable.id, status: payableSnapshotsTable.status })
      .from(payableSnapshotsTable)
      .where(
        and(
          eq(payableSnapshotsTable.id, id),
          eq(payableSnapshotsTable.isActive, true),
        ),
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Snapshot not found" });
    if (existing.status === "finalized") {
      return res.status(409).json({ error: "Already finalized" });
    }

    const [updated] = await db
      .update(payableSnapshotsTable)
      .set({ status: "finalized", updatedAt: new Date() })
      .where(eq(payableSnapshotsTable.id, id))
      .returning();

    return res.json({ snapshot: updated });
  },
);

export default router;

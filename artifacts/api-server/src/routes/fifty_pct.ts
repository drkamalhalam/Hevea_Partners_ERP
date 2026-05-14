/**
 * fifty_pct.ts
 *
 * 50% Revenue Model Settlement Engine API.
 * Routes mounted at /fifty-pct.
 *
 * Architecture:
 *   Gross Revenue × 50% → Landowner Side (bears all op costs + LCA)
 *   Gross Revenue × 50% → Economic Participant Pool (NEVER reduced by costs)
 *
 *   EPP distributed by verified economic participation percentages.
 *   Land contribution is EXCLUDED — only additional economic contributions
 *   participate in the EPP.
 *
 * STATIC sub-paths (revenue-lookup, lca-lookup, partners-lookup)
 * are registered BEFORE /:id wildcard.
 */

import { Router } from "express";
import {
  db,
  fiftyPctSessionsTable,
  eppEntriesTable,
  projectsTable,
  salesTransactionsTable,
  usersTable,
  lcaLedgerTable,
  partnersTable,
} from "@workspace/db";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";
import {
  requireSettlementAccess,
  getProjectScopeFilter,
  logSettlementAccess,
  enforceProjectAccess,
} from "../middlewares/settlement_security";
import { z } from "zod/v4";

const router = Router();

// ── Helper: resolve actor from Clerk userId ────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── Helper: compute derived values ────────────────────────────────────────

function computeSplit(grossRevenue: number) {
  const split = Math.round((grossRevenue / 2) * 100) / 100;
  return { landownerSplit: split, participantPoolSplit: split };
}

function computeLandownerNet(
  landownerSplit: number,
  operationalCost: number,
  lcaAmount: number,
) {
  return Math.max(0, Math.round((landownerSplit - operationalCost - lcaAmount) * 100) / 100);
}

function computeEppAllocated(poolSplit: number, pct: number) {
  return Math.round((poolSplit * pct) / 100 * 100) / 100;
}

// ── Validation schemas ─────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  projectId: z.string().uuid(),
  periodLabel: z.string().min(1),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  periodYear: z.number().int().optional(),
  grossRevenue: z.number().positive(),
  revenueSource: z.enum(["sales_records", "manual"]).default("manual"),
  linkedSaleIds: z.array(z.string().uuid()).default([]),
  operationalCost: z.number().min(0).default(0),
  lcaAmount: z.number().min(0).default(0),
  lcaSource: z.enum(["manual", "ledger"]).default("manual"),
  notes: z.string().optional(),
});

const UpdateSessionSchema = z.object({
  periodLabel: z.string().min(1).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  periodYear: z.number().int().optional(),
  grossRevenue: z.number().positive().optional(),
  revenueSource: z.enum(["sales_records", "manual"]).optional(),
  linkedSaleIds: z.array(z.string().uuid()).optional(),
  operationalCost: z.number().min(0).optional(),
  lcaAmount: z.number().min(0).optional(),
  lcaSource: z.enum(["manual", "ledger"]).optional(),
  notes: z.string().optional(),
});

const CreateEppEntrySchema = z.object({
  participantId: z.string().uuid().optional(),
  participantKey: z.string().min(1),
  participantName: z.string().min(1),
  participationPct: z.number().min(0).max(100),
  contributionType: z
    .enum(["economic_only", "landowner_additional", "external"])
    .default("economic_only"),
  isLandownerAdditional: z.boolean().default(false),
  notes: z.string().optional(),
});

const UpdateEppEntrySchema = z.object({
  participantKey: z.string().min(1).optional(),
  participantName: z.string().min(1).optional(),
  participationPct: z.number().min(0).max(100).optional(),
  contributionType: z
    .enum(["economic_only", "landowner_additional", "external"])
    .optional(),
  isLandownerAdditional: z.boolean().optional(),
  notes: z.string().optional(),
});

// ── Recompute and persist session EPP totals ──────────────────────────────

async function refreshSessionEppTotals(sessionId: string, poolSplit: number) {
  const allEntries = await db
    .select({ allocated: eppEntriesTable.allocatedAmount })
    .from(eppEntriesTable)
    .where(eq(eppEntriesTable.sessionId, sessionId));

  const eppTotalAllocated = allEntries.reduce(
    (s, e) => s + parseFloat(String(e.allocated)),
    0,
  );
  const eppRemainder = Math.max(0, poolSplit - eppTotalAllocated);

  await db
    .update(fiftyPctSessionsTable)
    .set({
      eppTotalAllocated: String(Math.round(eppTotalAllocated * 100) / 100),
      eppRemainder: String(Math.round(eppRemainder * 100) / 100),
      updatedAt: new Date(),
    })
    .where(eq(fiftyPctSessionsTable.id, sessionId));
}

// ══════════════════════════════════════════════════════════════════════
// STATIC ROUTES (must be before /:id)
// ══════════════════════════════════════════════════════════════════════

// ── GET /fifty-pct/revenue-lookup ─────────────────────────────────────────

router.get("/revenue-lookup", async (req, res) => {
  const { projectId, from, to } = req.query as {
    projectId?: string;
    from?: string;
    to?: string;
  };

  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  const conditions: ReturnType<typeof eq>[] = [
    eq(salesTransactionsTable.projectId, projectId),
    eq(salesTransactionsTable.status, "confirmed"),
  ];
  if (from) conditions.push(gte(salesTransactionsTable.saleDate, from));
  if (to) conditions.push(lte(salesTransactionsTable.saleDate, to));

  const sales = await db
    .select({
      id: salesTransactionsTable.id,
      saleNumber: salesTransactionsTable.saleNumber,
      saleDate: salesTransactionsTable.saleDate,
      buyerName: salesTransactionsTable.buyerName,
      grossRevenue: salesTransactionsTable.totalGrossRevenue,
    })
    .from(salesTransactionsTable)
    .where(and(...conditions))
    .orderBy(desc(salesTransactionsTable.saleDate));

  const totalGrossRevenue = sales.reduce(
    (s, r) => s + parseFloat(String(r.grossRevenue)),
    0,
  );

  return res.json({ sales, totalGrossRevenue: Math.round(totalGrossRevenue * 100) / 100 });
});

// ── GET /fifty-pct/lca-lookup ─────────────────────────────────────────────

router.get("/lca-lookup", async (req, res) => {
  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId is required" });

  const entries = await db
    .select()
    .from(lcaLedgerTable)
    .where(
      and(
        eq(lcaLedgerTable.projectId, projectId),
        eq(lcaLedgerTable.isActive, true),
      ),
    )
    .orderBy(lcaLedgerTable.year);

  const totalBalance = entries.reduce(
    (s, e) => s + parseFloat(String(e.balance ?? "0")),
    0,
  );

  return res.json({
    entries,
    totalBalance: Math.round(totalBalance * 100) / 100,
  });
});

// ── GET /fifty-pct/partners-lookup ───────────────────────────────────────

router.get("/partners-lookup", async (req, res) => {
  const partners = await db
    .select({
      id: partnersTable.id,
      name: partnersTable.name,
      phone: partnersTable.phone,
    })
    .from(partnersTable)
    .where(eq(partnersTable.isActive, true))
    .orderBy(partnersTable.name);

  return res.json({ partners });
});

// ══════════════════════════════════════════════════════════════════════
// SESSION COLLECTION ROUTES
// ══════════════════════════════════════════════════════════════════════

// ── GET /fifty-pct ────────────────────────────────────────────────────────

router.get("/", requireSettlementAccess, async (req, res) => {
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "fifty_pct_sessions", "list");
    return res.json({ sessions: [], total: 0 });
  }

  const { projectId, status } = req.query as {
    projectId?: string;
    status?: string;
  };

  const conditions: ReturnType<typeof eq>[] = [];
  if (projectId) conditions.push(eq(fiftyPctSessionsTable.projectId, projectId));
  if (status) conditions.push(eq(fiftyPctSessionsTable.status, status));
  if (projectScope !== null) conditions.push(inArray(fiftyPctSessionsTable.projectId, projectScope));

  const sessions = await db
    .select()
    .from(fiftyPctSessionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(fiftyPctSessionsTable.createdAt));

  logSettlementAccess(req, "fifty_pct_sessions", "list");
  return res.json({ sessions, total: sessions.length });
});

// ── POST /fifty-pct ───────────────────────────────────────────────────────

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

    const d = parsed.data;
    const gross = d.grossRevenue;
    const { landownerSplit, participantPoolSplit } = computeSplit(gross);
    const landownerNet = computeLandownerNet(landownerSplit, d.operationalCost, d.lcaAmount);

    const [session] = await db
      .insert(fiftyPctSessionsTable)
      .values({
        projectId: d.projectId,
        periodLabel: d.periodLabel,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        periodYear: d.periodYear,
        grossRevenue: String(gross),
        revenueSource: d.revenueSource,
        linkedSaleIds: d.linkedSaleIds,
        landownerSplit: String(landownerSplit),
        participantPoolSplit: String(participantPoolSplit),
        operationalCost: String(d.operationalCost),
        lcaAmount: String(d.lcaAmount),
        lcaSource: d.lcaSource,
        landownerNet: String(landownerNet),
        notes: d.notes,
        calculatedBy: actor?.id,
        calculatedByName: actor?.displayName ?? null,
        status: "draft",
      })
      .returning();

    return res.status(201).json({ session });
  },
);

// ══════════════════════════════════════════════════════════════════════
// SESSION INSTANCE ROUTES  /:id
// ══════════════════════════════════════════════════════════════════════

// ── GET /fifty-pct/:id ───────────────────────────────────────────────────

router.get("/:id", requireSettlementAccess, async (req, res) => {
  const { id } = req.params as { id: string };

  const [session] = await db
    .select()
    .from(fiftyPctSessionsTable)
    .where(eq(fiftyPctSessionsTable.id, id))
    .limit(1);

  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!enforceProjectAccess(req, res, session.projectId, "fifty_pct_sessions")) return;

  const entries = await db
    .select()
    .from(eppEntriesTable)
    .where(eq(eppEntriesTable.sessionId, id))
    .orderBy(eppEntriesTable.createdAt);

  const project = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, session.projectId))
    .limit(1);

  logSettlementAccess(req, "fifty_pct_sessions", "view", id, session.projectId ?? undefined);
  return res.json({
    session: { ...session, projectName: project[0]?.name ?? null },
    eppEntries: entries,
  });
});

// ── PATCH /fifty-pct/:id ─────────────────────────────────────────────────

router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Session not found" });
    if (existing.status === "confirmed") {
      return res.status(409).json({ error: "Cannot edit a confirmed session" });
    }

    const parsed = UpdateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const d = parsed.data;
    const gross = d.grossRevenue ?? parseFloat(String(existing.grossRevenue));
    const opCost = d.operationalCost ?? parseFloat(String(existing.operationalCost));
    const lca = d.lcaAmount ?? parseFloat(String(existing.lcaAmount));
    const { landownerSplit, participantPoolSplit } = computeSplit(gross);
    const landownerNet = computeLandownerNet(landownerSplit, opCost, lca);

    // Build typed update payload
    const setPayload: Partial<typeof fiftyPctSessionsTable.$inferInsert> & { updatedAt: Date } = {
      landownerSplit: String(landownerSplit),
      participantPoolSplit: String(participantPoolSplit),
      landownerNet: String(landownerNet),
      updatedAt: new Date(),
    };

    if (d.periodLabel !== undefined) setPayload.periodLabel = d.periodLabel;
    if (d.periodStart !== undefined) setPayload.periodStart = d.periodStart;
    if (d.periodEnd !== undefined) setPayload.periodEnd = d.periodEnd;
    if (d.periodYear !== undefined) setPayload.periodYear = d.periodYear;
    if (d.grossRevenue !== undefined) setPayload.grossRevenue = String(gross);
    if (d.revenueSource !== undefined) setPayload.revenueSource = d.revenueSource;
    if (d.linkedSaleIds !== undefined) setPayload.linkedSaleIds = d.linkedSaleIds;
    if (d.operationalCost !== undefined) setPayload.operationalCost = String(opCost);
    if (d.lcaAmount !== undefined) setPayload.lcaAmount = String(lca);
    if (d.lcaSource !== undefined) setPayload.lcaSource = d.lcaSource;
    if (d.notes !== undefined) setPayload.notes = d.notes;

    // If gross changed, recompute all EPP entry amounts
    if (d.grossRevenue !== undefined) {
      const entries = await db
        .select({ id: eppEntriesTable.id, participationPct: eppEntriesTable.participationPct })
        .from(eppEntriesTable)
        .where(eq(eppEntriesTable.sessionId, id));

      for (const entry of entries) {
        const newAmt = computeEppAllocated(participantPoolSplit, parseFloat(String(entry.participationPct)));
        await db
          .update(eppEntriesTable)
          .set({ allocatedAmount: String(newAmt) })
          .where(eq(eppEntriesTable.id, entry.id));
      }
    }

    const [updated] = await db
      .update(fiftyPctSessionsTable)
      .set(setPayload)
      .where(eq(fiftyPctSessionsTable.id, id))
      .returning();

    // Recompute EPP totals
    await refreshSessionEppTotals(id, participantPoolSplit);

    // Fetch fresh record
    const [fresh] = await db
      .select()
      .from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, id))
      .limit(1);

    return res.json({ session: fresh ?? updated });
  },
);

// ── POST /fifty-pct/:id/confirm ───────────────────────────────────────────

router.post(
  "/:id/confirm",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Session not found" });
    if (existing.status === "confirmed") {
      return res.status(409).json({ error: "Already confirmed" });
    }

    const { userId: clerkUserId } = getAuth(req);
    const actor = clerkUserId ? await resolveActor(clerkUserId) : null;

    const [updated] = await db
      .update(fiftyPctSessionsTable)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedBy: actor?.id,
        confirmedByName: actor?.displayName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(fiftyPctSessionsTable.id, id))
      .returning();

    return res.json({ session: updated });
  },
);

// ── DELETE /fifty-pct/:id (archive) ──────────────────────────────────────

router.delete(
  "/:id",
  requireRole("admin"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [existing] = await db
      .select({ id: fiftyPctSessionsTable.id })
      .from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Session not found" });

    await db
      .update(fiftyPctSessionsTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(fiftyPctSessionsTable.id, id));

    return res.json({ ok: true });
  },
);

// ══════════════════════════════════════════════════════════════════════
// EPP ENTRY ROUTES  /:id/epp
// ══════════════════════════════════════════════════════════════════════

// ── GET /fifty-pct/:id/epp ───────────────────────────────────────────────

router.get("/:id/epp", requireSettlementAccess, async (req, res) => {
  const { id } = req.params as { id: string };

  const [session] = await db
    .select({ projectId: fiftyPctSessionsTable.projectId })
    .from(fiftyPctSessionsTable)
    .where(eq(fiftyPctSessionsTable.id, id))
    .limit(1);

  if (session && !enforceProjectAccess(req, res, session.projectId, "fifty_pct_epp")) return;

  const entries = await db
    .select()
    .from(eppEntriesTable)
    .where(eq(eppEntriesTable.sessionId, id))
    .orderBy(eppEntriesTable.createdAt);

  const totalPct = entries.reduce(
    (s, e) => s + parseFloat(String(e.participationPct)),
    0,
  );
  const totalAllocated = entries.reduce(
    (s, e) => s + parseFloat(String(e.allocatedAmount)),
    0,
  );

  logSettlementAccess(req, "fifty_pct_epp", "list", id);
  return res.json({
    entries,
    totalPct: Math.round(totalPct * 10000) / 10000,
    totalAllocated: Math.round(totalAllocated * 100) / 100,
  });
});

// ── POST /fifty-pct/:id/epp ──────────────────────────────────────────────

router.post(
  "/:id/epp",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id } = req.params as { id: string };

    const [session] = await db
      .select()
      .from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, id))
      .limit(1);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status === "confirmed") {
      return res.status(409).json({ error: "Cannot add entries to a confirmed session" });
    }

    const parsed = CreateEppEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const d = parsed.data;
    const poolSplit = parseFloat(String(session.participantPoolSplit));
    const allocatedAmount = computeEppAllocated(poolSplit, d.participationPct);

    const [entry] = await db
      .insert(eppEntriesTable)
      .values({
        sessionId: id,
        projectId: session.projectId,
        participantId: d.participantId,
        participantKey: d.participantKey,
        participantName: d.participantName,
        participationPct: String(d.participationPct),
        allocatedAmount: String(allocatedAmount),
        contributionType: d.contributionType,
        isLandownerAdditional: d.isLandownerAdditional,
        notes: d.notes,
      })
      .returning();

    await refreshSessionEppTotals(id, poolSplit);
    return res.status(201).json({ entry });
  },
);

// ── PATCH /fifty-pct/:id/epp/:entryId ───────────────────────────────────

router.patch(
  "/:id/epp/:entryId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id, entryId } = req.params as { id: string; entryId: string };

    const [session] = await db
      .select()
      .from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, id))
      .limit(1);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status === "confirmed") {
      return res.status(409).json({ error: "Cannot edit entries in a confirmed session" });
    }

    const parsed = UpdateEppEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    const d = parsed.data;
    const poolSplit = parseFloat(String(session.participantPoolSplit));

    const setPayload: Partial<typeof eppEntriesTable.$inferInsert> = {};
    if (d.participantKey !== undefined) setPayload.participantKey = d.participantKey;
    if (d.participantName !== undefined) setPayload.participantName = d.participantName;
    if (d.contributionType !== undefined) setPayload.contributionType = d.contributionType;
    if (d.isLandownerAdditional !== undefined) setPayload.isLandownerAdditional = d.isLandownerAdditional;
    if (d.notes !== undefined) setPayload.notes = d.notes;
    if (d.participationPct !== undefined) {
      setPayload.participationPct = String(d.participationPct);
      setPayload.allocatedAmount = String(computeEppAllocated(poolSplit, d.participationPct));
    }

    const [updated] = await db
      .update(eppEntriesTable)
      .set(setPayload)
      .where(and(eq(eppEntriesTable.id, entryId), eq(eppEntriesTable.sessionId, id)))
      .returning();

    if (!updated) return res.status(404).json({ error: "EPP entry not found" });

    await refreshSessionEppTotals(id, poolSplit);
    return res.json({ entry: updated });
  },
);

// ── DELETE /fifty-pct/:id/epp/:entryId ───────────────────────────────────

router.delete(
  "/:id/epp/:entryId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { id, entryId } = req.params as { id: string; entryId: string };

    const [session] = await db
      .select()
      .from(fiftyPctSessionsTable)
      .where(eq(fiftyPctSessionsTable.id, id))
      .limit(1);

    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status === "confirmed") {
      return res.status(409).json({ error: "Cannot remove entries from a confirmed session" });
    }

    const deleted = await db
      .delete(eppEntriesTable)
      .where(and(eq(eppEntriesTable.id, entryId), eq(eppEntriesTable.sessionId, id)))
      .returning({ id: eppEntriesTable.id });

    if (!deleted.length) return res.status(404).json({ error: "EPP entry not found" });

    const poolSplit = parseFloat(String(session.participantPoolSplit));
    await refreshSessionEppTotals(id, poolSplit);
    return res.json({ ok: true });
  },
);

// ── GET /fifty-pct/:id/summary ────────────────────────────────────────────

router.get("/:id/summary", requireSettlementAccess, async (req, res) => {
  const { id } = req.params as { id: string };

  const [session] = await db
    .select()
    .from(fiftyPctSessionsTable)
    .where(eq(fiftyPctSessionsTable.id, id))
    .limit(1);

  if (!session) return res.status(404).json({ error: "Session not found" });
  if (!enforceProjectAccess(req, res, session.projectId, "fifty_pct_sessions")) return;

  const entries = await db
    .select()
    .from(eppEntriesTable)
    .where(eq(eppEntriesTable.sessionId, id))
    .orderBy(desc(eppEntriesTable.participationPct));

  const project = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, session.projectId))
    .limit(1);

  const gross = parseFloat(String(session.grossRevenue));
  const landownerSplit = parseFloat(String(session.landownerSplit));
  const poolSplit = parseFloat(String(session.participantPoolSplit));
  const opCost = parseFloat(String(session.operationalCost));
  const lca = parseFloat(String(session.lcaAmount));
  const landownerNet = parseFloat(String(session.landownerNet));

  const totalPct = entries.reduce(
    (s, e) => s + parseFloat(String(e.participationPct)),
    0,
  );
  const totalAllocated = entries.reduce(
    (s, e) => s + parseFloat(String(e.allocatedAmount)),
    0,
  );
  const remainder = Math.max(0, poolSplit - totalAllocated);

  const warnings: string[] = [];
  if (Math.abs(totalPct - 100) > 0.5 && entries.length > 0) {
    warnings.push(
      `EPP participation percentages sum to ${totalPct.toFixed(2)}% (expected 100%). Some pool amount may be unallocated.`,
    );
  }
  if (remainder > 0.01) {
    warnings.push(
      `₹${remainder.toFixed(2)} of the Economic Participant Pool is unallocated.`,
    );
  }
  if (opCost > landownerSplit) {
    warnings.push(
      `Operational cost exceeds the landowner's 50% gross share — landowner net is floored at 0.`,
    );
  }

  return res.json({
    session: { ...session, projectName: project[0]?.name ?? null },
    eppEntries: entries.map((e) => ({
      ...e,
      participationPct: parseFloat(String(e.participationPct)),
      allocatedAmount: parseFloat(String(e.allocatedAmount)),
    })),
    summary: {
      grossRevenue: gross,
      landownerSide: {
        gross: landownerSplit,
        operationalCost: opCost,
        lcaAmount: lca,
        net: landownerNet,
      },
      economicParticipantPool: {
        gross: poolSplit,
        totalPct: Math.round(totalPct * 10000) / 10000,
        totalAllocated: Math.round(totalAllocated * 100) / 100,
        remainder: Math.round(remainder * 100) / 100,
        entries: entries.map((e) => ({
          ...e,
          participationPct: parseFloat(String(e.participationPct)),
          allocatedAmount: parseFloat(String(e.allocatedAmount)),
        })),
      },
      warnings,
    },
  });
  logSettlementAccess(req, "fifty_pct_sessions", "summary", id, session.projectId ?? undefined);
});

export default router;

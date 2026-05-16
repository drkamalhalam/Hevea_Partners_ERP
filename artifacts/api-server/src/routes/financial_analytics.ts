/**
 * financial_analytics.ts
 *
 * Financial Analytics Dashboard API.
 * Aggregates data across all financial modules for the analytics dashboard.
 *
 * Endpoints (all read-only, any authenticated role):
 *   GET /financial-analytics/summary              — master KPIs
 *   GET /financial-analytics/revenue-trend        — period-wise gross/net trend
 *   GET /financial-analytics/settlement-analytics — settlement completion + override stats
 *   GET /financial-analytics/project-profitability — per-project financial breakdown
 *   GET /financial-analytics/allocation-breakdown  — revenue allocation (pie chart data)
 */

import { Router } from "express";
import {
  requireSettlementAccess,
  getProjectScopeFilter,
  logSettlementAccess,
} from "../middlewares/settlement_security";
import {
  db,
  fiftyPctSessionsTable,
  eppEntriesTable,
  lcaLedgerTable,
  negativeBalanceEntriesTable,
  distributionRecordsTable,
  settlementRecordsTable,
  payableAdjustmentsTable,
  projectsTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";

const router = Router();

// ── Auth guard ─────────────────────────────────────────────────────────────
// requireSettlementAccess (imported) blocks employee + operational_staff.
// All analytics endpoints use it to enforce the settlement access matrix.

// ── Helpers ────────────────────────────────────────────────────────────────

const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toFixed = (v: number) => v.toFixed(2);

// ── GET /financial-analytics/summary ──────────────────────────────────────

router.get("/summary", requireSettlementAccess, async (req, res) => {
  const { projectId } = req.query as { projectId?: string };
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    return res.json({ grossRevenue: "0.00", landownerSplit: "0.00", participantPoolSplit: "0.00",
      operationalCost: "0.00", lcaDeducted: "0.00", landownerNet: "0.00", eppTotalAllocated: "0.00",
      sessions: { confirmed: 0, draft: 0 }, lca: { totalDue: "0.00", totalPaid: "0.00", totalPending: "0.00", pendingCount: 0 },
      negativeBalance: { totalDeficit: "0.00" }, distribution: { totalGross: "0.00", totalPaid: "0.00", totalPending: "0.00", paidCount: 0, pendingCount: 0 },
      settlements: { total: 0, finalized: 0, disputed: 0, overridden: 0, totalRecommended: "0.00", totalActual: "0.00" },
      recoverableAdjustments: { total: "0.00", count: 0 } });
  }
  const scopeFilter = (col: Parameters<typeof eq>[0]) =>
    projectId ? eq(col, projectId) : projectScope !== null ? inArray(col, projectScope) : undefined;

  const sessionFilter = and(
    inArray(fiftyPctSessionsTable.status, ["confirmed", "draft"]),
    scopeFilter(fiftyPctSessionsTable.projectId),
  );

  const [sessionAgg] = await db
    .select({
      totalGross:       sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.grossRevenue}), 0)`,
      totalLandowner:   sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.landownerSplit}), 0)`,
      totalPool:        sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.participantPoolSplit}), 0)`,
      totalOpCost:      sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.operationalCost}), 0)`,
      totalLcaDed:      sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.lcaAmount}), 0)`,
      totalLandNet:     sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.landownerNet}), 0)`,
      confirmedCount:   sql<number>`COUNT(*) FILTER (WHERE ${fiftyPctSessionsTable.status} = 'confirmed')`,
      draftCount:       sql<number>`COUNT(*) FILTER (WHERE ${fiftyPctSessionsTable.status} = 'draft')`,
    })
    .from(fiftyPctSessionsTable)
    .where(sessionFilter);

  const eppFilter = scopeFilter(eppEntriesTable.projectId);
  const [eppAgg] = await db
    .select({ totalAllocated: sql<string>`COALESCE(SUM(${eppEntriesTable.allocatedAmount}), 0)` })
    .from(eppEntriesTable)
    .where(eppFilter);

  const lcaFilter = scopeFilter(lcaLedgerTable.projectId);
  const [lcaAgg] = await db
    .select({
      totalDue:    sql<number>`COALESCE(SUM(${lcaLedgerTable.totalDue}), 0)`,
      totalPaid:   sql<number>`COALESCE(SUM(${lcaLedgerTable.amountPaid}), 0)`,
      totalBal:    sql<number>`COALESCE(SUM(${lcaLedgerTable.balance}), 0)`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${lcaLedgerTable.status} IN ('pending', 'partial'))`,
    })
    .from(lcaLedgerTable)
    .where(and(lcaFilter, sql`${lcaLedgerTable.balance} > 0`));

  // Latest closingBalance per (project, partner) — sum of negative ones
  const negBalRows = await db.execute(sql`
    SELECT SUM(cb) AS total_negative FROM (
      SELECT DISTINCT ON (project_id, partner_id) closing_balance::numeric AS cb
      FROM negative_balance_entries
      ${projectId ? sql`WHERE project_id = ${projectId}::uuid` : sql``}
      ORDER BY project_id, partner_id, recorded_at DESC
    ) t WHERE cb < 0
  `);
  const totalNegBalance = Math.abs(toNum((negBalRows.rows[0] as Record<string, unknown>)?.total_negative ?? 0));

  const distFilter = and(
    eq(distributionRecordsTable.isActive, true),
    scopeFilter(distributionRecordsTable.projectId),
  );
  const [distAgg] = await db
    .select({
      totalGross:    sql<string>`COALESCE(SUM(${distributionRecordsTable.grossRevenue}), 0)`,
      totalPaid:     sql<string>`COALESCE(SUM(${distributionRecordsTable.totalPaid}), 0)`,
      totalPending:  sql<string>`COALESCE(SUM(${distributionRecordsTable.pendingPayable}), 0)`,
      paidCount:     sql<number>`COUNT(*) FILTER (WHERE ${distributionRecordsTable.status} = 'paid')`,
      pendingCount:  sql<number>`COUNT(*) FILTER (WHERE ${distributionRecordsTable.status} IN ('pending','partial'))`,
    })
    .from(distributionRecordsTable)
    .where(distFilter);

  const settlFilter = scopeFilter(settlementRecordsTable.projectId);
  const [settlAgg] = await db
    .select({
      total:          sql<number>`COUNT(*)`,
      finalized:      sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.status} = 'finalized')`,
      disputed:       sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.status} = 'disputed')`,
      overridden:     sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.isOverridden} = true)`,
      totalRecommended: sql<string>`COALESCE(SUM(${settlementRecordsTable.recommendedAmount}), 0)`,
      totalActual:    sql<string>`COALESCE(SUM(${settlementRecordsTable.actualAmount}), 0)`,
    })
    .from(settlementRecordsTable)
    .where(and(settlFilter, sql`${settlementRecordsTable.status} != 'archived'`));

  const adjFilter = and(
    inArray(payableAdjustmentsTable.status, ["draft", "confirmed"]),
    scopeFilter(payableAdjustmentsTable.projectId),
  );
  const [adjAgg] = await db
    .select({
      totalAdj: sql<string>`COALESCE(SUM(${payableAdjustmentsTable.amount}), 0)`,
      count:    sql<number>`COUNT(*)`,
    })
    .from(payableAdjustmentsTable)
    .where(adjFilter);

  return res.json({
    grossRevenue:         toFixed(toNum(sessionAgg?.totalGross)),
    landownerSplit:       toFixed(toNum(sessionAgg?.totalLandowner)),
    participantPoolSplit: toFixed(toNum(sessionAgg?.totalPool)),
    operationalCost:      toFixed(toNum(sessionAgg?.totalOpCost)),
    lcaDeducted:          toFixed(toNum(sessionAgg?.totalLcaDed)),
    landownerNet:         toFixed(toNum(sessionAgg?.totalLandNet)),
    eppTotalAllocated:    toFixed(toNum(eppAgg?.totalAllocated)),
    sessions: {
      confirmed: Number(sessionAgg?.confirmedCount ?? 0),
      draft:     Number(sessionAgg?.draftCount ?? 0),
    },
    lca: {
      totalDue:  toFixed(toNum(lcaAgg?.totalDue)),
      totalPaid: toFixed(toNum(lcaAgg?.totalPaid)),
      totalPending: toFixed(toNum(lcaAgg?.totalBal)),
      pendingCount: Number(lcaAgg?.pendingCount ?? 0),
    },
    negativeBalance: {
      totalDeficit: toFixed(totalNegBalance),
    },
    distribution: {
      totalGross:   toFixed(toNum(distAgg?.totalGross)),
      totalPaid:    toFixed(toNum(distAgg?.totalPaid)),
      totalPending: toFixed(toNum(distAgg?.totalPending)),
      paidCount:    Number(distAgg?.paidCount ?? 0),
      pendingCount: Number(distAgg?.pendingCount ?? 0),
    },
    settlements: {
      total:     Number(settlAgg?.total ?? 0),
      finalized: Number(settlAgg?.finalized ?? 0),
      disputed:  Number(settlAgg?.disputed ?? 0),
      overridden: Number(settlAgg?.overridden ?? 0),
      totalRecommended: toFixed(toNum(settlAgg?.totalRecommended)),
      totalActual:      toFixed(toNum(settlAgg?.totalActual)),
    },
    recoverableAdjustments: {
      total: toFixed(toNum(adjAgg?.totalAdj)),
      count: Number(adjAgg?.count ?? 0),
    },
  });
  logSettlementAccess(req, "financial_analytics", "summary");
});

// ── GET /financial-analytics/revenue-trend ────────────────────────────────

router.get("/revenue-trend", requireSettlementAccess, async (req, res) => {
  const { projectId, limit: limitStr } = req.query as { projectId?: string; limit?: string };
  const limitN = Math.min(parseInt(limitStr ?? "20", 10), 50);
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "financial_analytics", "revenue_trend");
    return res.json({ trend: [], rawSessions: [] });
  }
  const scopeFilter = (col: Parameters<typeof eq>[0]) =>
    projectId ? eq(col, projectId) : projectScope !== null ? inArray(col, projectScope) : undefined;

  const filter = and(scopeFilter(fiftyPctSessionsTable.projectId));

  const rows = await db
    .select({
      periodLabel:         fiftyPctSessionsTable.periodLabel,
      periodYear:          fiftyPctSessionsTable.periodYear,
      grossRevenue:        fiftyPctSessionsTable.grossRevenue,
      landownerSplit:      fiftyPctSessionsTable.landownerSplit,
      participantPoolSplit: fiftyPctSessionsTable.participantPoolSplit,
      operationalCost:     fiftyPctSessionsTable.operationalCost,
      lcaAmount:           fiftyPctSessionsTable.lcaAmount,
      landownerNet:        fiftyPctSessionsTable.landownerNet,
      status:              fiftyPctSessionsTable.status,
      projectId:           fiftyPctSessionsTable.projectId,
      projectName:         projectsTable.name,
      confirmedAt:         fiftyPctSessionsTable.confirmedAt,
    })
    .from(fiftyPctSessionsTable)
    .leftJoin(projectsTable, eq(fiftyPctSessionsTable.projectId, projectsTable.id))
    .where(filter)
    .orderBy(desc(fiftyPctSessionsTable.confirmedAt))
    .limit(limitN);

  // Aggregate by period label across projects
  const byPeriod: Record<string, {
    periodLabel: string;
    grossRevenue: number;
    landownerSplit: number;
    participantPoolSplit: number;
    operationalCost: number;
    lcaAmount: number;
    landownerNet: number;
    sessionCount: number;
  }> = {};

  for (const r of rows) {
    const k = r.periodLabel;
    if (!byPeriod[k]) {
      byPeriod[k] = { periodLabel: k, grossRevenue: 0, landownerSplit: 0, participantPoolSplit: 0, operationalCost: 0, lcaAmount: 0, landownerNet: 0, sessionCount: 0 };
    }
    byPeriod[k].grossRevenue        += toNum(r.grossRevenue);
    byPeriod[k].landownerSplit      += toNum(r.landownerSplit);
    byPeriod[k].participantPoolSplit += toNum(r.participantPoolSplit);
    byPeriod[k].operationalCost     += toNum(r.operationalCost);
    byPeriod[k].lcaAmount           += toNum(r.lcaAmount);
    byPeriod[k].landownerNet        += toNum(r.landownerNet);
    byPeriod[k].sessionCount++;
  }

  const trend = Object.values(byPeriod).map(p => ({
    ...p,
    grossRevenue:        parseFloat(p.grossRevenue.toFixed(2)),
    landownerSplit:      parseFloat(p.landownerSplit.toFixed(2)),
    participantPoolSplit: parseFloat(p.participantPoolSplit.toFixed(2)),
    operationalCost:     parseFloat(p.operationalCost.toFixed(2)),
    lcaAmount:           parseFloat(p.lcaAmount.toFixed(2)),
    landownerNet:        parseFloat(p.landownerNet.toFixed(2)),
  }));

  logSettlementAccess(req, "financial_analytics", "revenue_trend");
  return res.json({ trend, rawSessions: rows });
});

// ── GET /financial-analytics/settlement-analytics ─────────────────────────

router.get("/settlement-analytics", requireSettlementAccess, async (req, res) => {
  const { projectId } = req.query as { projectId?: string };
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "financial_analytics", "settlement_analytics");
    return res.json({ byType: [], lcaByYear: [] });
  }
  const scopeFilter = (col: Parameters<typeof eq>[0]) =>
    projectId ? eq(col, projectId) : projectScope !== null ? inArray(col, projectScope) : undefined;

  const baseFilter = and(
    sql`${settlementRecordsTable.status} != 'archived'`,
    scopeFilter(settlementRecordsTable.projectId),
  );

  // By type aggregation
  const byTypeRows = await db
    .select({
      settlementType:   settlementRecordsTable.settlementType,
      total:            sql<number>`COUNT(*)`,
      finalized:        sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.status} = 'finalized')`,
      disputed:         sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.status} = 'disputed')`,
      overridden:       sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.isOverridden} = true)`,
      sumRecommended:   sql<string>`COALESCE(SUM(${settlementRecordsTable.recommendedAmount}), 0)`,
      sumActual:        sql<string>`COALESCE(SUM(${settlementRecordsTable.actualAmount}), 0)`,
    })
    .from(settlementRecordsTable)
    .where(baseFilter)
    .groupBy(settlementRecordsTable.settlementType);

  const byType = byTypeRows.map(r => {
    const rec = toNum(r.sumRecommended);
    const act = toNum(r.sumActual);
    const diffPct = rec > 0 ? ((act - rec) / rec * 100) : 0;
    return {
      settlementType: r.settlementType,
      total:     Number(r.total),
      finalized: Number(r.finalized),
      disputed:  Number(r.disputed),
      overridden: Number(r.overridden),
      completionRate: r.total > 0 ? parseFloat((Number(r.finalized) / Number(r.total) * 100).toFixed(1)) : 0,
      overrideRate:   r.total > 0 ? parseFloat((Number(r.overridden) / Number(r.total) * 100).toFixed(1)) : 0,
      sumRecommended: toFixed(rec),
      sumActual:      toFixed(act),
      overrideDiffPct: parseFloat(diffPct.toFixed(1)),
    };
  });

  // LCA by year
  const lcaByYear = await db
    .select({
      year:       lcaLedgerTable.year,
      totalDue:   sql<number>`SUM(${lcaLedgerTable.totalDue})`,
      totalPaid:  sql<number>`SUM(${lcaLedgerTable.amountPaid})`,
      totalBal:   sql<number>`SUM(${lcaLedgerTable.balance})`,
      count:      sql<number>`COUNT(*)`,
    })
    .from(lcaLedgerTable)
    .where(scopeFilter(lcaLedgerTable.projectId))
    .groupBy(lcaLedgerTable.year)
    .orderBy(lcaLedgerTable.year);

  logSettlementAccess(req, "financial_analytics", "settlement_analytics");
  return res.json({
    byType,
    lcaByYear: lcaByYear.map(r => ({
      year: r.year,
      totalDue:  parseFloat(toFixed(toNum(r.totalDue))),
      totalPaid: parseFloat(toFixed(toNum(r.totalPaid))),
      totalBal:  parseFloat(toFixed(toNum(r.totalBal))),
      count:     Number(r.count),
      paymentRate: r.totalDue > 0 ? parseFloat((toNum(r.totalPaid) / toNum(r.totalDue) * 100).toFixed(1)) : 0,
    })),
  });
});

// ── GET /financial-analytics/project-profitability ────────────────────────

router.get("/project-profitability", requireSettlementAccess, async (req, res) => {
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "financial_analytics", "project_profitability");
    return res.json({ projects: [] });
  }
  const scopeFilter = (col: Parameters<typeof eq>[0]) =>
    projectScope !== null ? inArray(col, projectScope) : undefined;

  // Aggregate fifty_pct_sessions by project
  const sessionsByProject = await db
    .select({
      projectId:           fiftyPctSessionsTable.projectId,
      projectName:         projectsTable.name,
      grossRevenue:        sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.grossRevenue}), 0)`,
      landownerSplit:      sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.landownerSplit}), 0)`,
      participantPoolSplit: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.participantPoolSplit}), 0)`,
      operationalCost:     sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.operationalCost}), 0)`,
      lcaAmount:           sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.lcaAmount}), 0)`,
      landownerNet:        sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.landownerNet}), 0)`,
      sessionCount:        sql<number>`COUNT(*)`,
      confirmedCount:      sql<number>`COUNT(*) FILTER (WHERE ${fiftyPctSessionsTable.status} = 'confirmed')`,
    })
    .from(fiftyPctSessionsTable)
    .leftJoin(projectsTable, eq(fiftyPctSessionsTable.projectId, projectsTable.id))
    .where(scopeFilter(fiftyPctSessionsTable.projectId))
    .groupBy(fiftyPctSessionsTable.projectId, projectsTable.name)
    .orderBy(desc(sql`SUM(${fiftyPctSessionsTable.grossRevenue})`));

  // EPP per project
  const eppByProject = await db
    .select({
      projectId:      eppEntriesTable.projectId,
      totalAllocated: sql<string>`COALESCE(SUM(${eppEntriesTable.allocatedAmount}), 0)`,
      participantCount: sql<number>`COUNT(DISTINCT ${eppEntriesTable.participantKey})`,
    })
    .from(eppEntriesTable)
    .where(scopeFilter(eppEntriesTable.projectId))
    .groupBy(eppEntriesTable.projectId);

  const eppMap = Object.fromEntries(eppByProject.map(r => [r.projectId, r]));

  // Distribution per project
  const distByProject = await db
    .select({
      projectId:    distributionRecordsTable.projectId,
      totalPaid:    sql<string>`COALESCE(SUM(${distributionRecordsTable.totalPaid}), 0)`,
      totalPending: sql<string>`COALESCE(SUM(${distributionRecordsTable.pendingPayable}), 0)`,
    })
    .from(distributionRecordsTable)
    .where(and(eq(distributionRecordsTable.isActive, true), scopeFilter(distributionRecordsTable.projectId)))
    .groupBy(distributionRecordsTable.projectId);

  const distMap = Object.fromEntries(distByProject.map(r => [r.projectId, r]));

  // LCA per project
  const lcaByProject = await db
    .select({
      projectId:   lcaLedgerTable.projectId,
      totalPaid:   sql<number>`COALESCE(SUM(${lcaLedgerTable.amountPaid}), 0)`,
      totalBal:    sql<number>`COALESCE(SUM(${lcaLedgerTable.balance}), 0)`,
    })
    .from(lcaLedgerTable)
    .where(scopeFilter(lcaLedgerTable.projectId))
    .groupBy(lcaLedgerTable.projectId);

  const lcaMap = Object.fromEntries(lcaByProject.map(r => [r.projectId, r]));

  const projects = sessionsByProject.map(s => {
    const epp  = eppMap[s.projectId!] ?? { totalAllocated: "0", participantCount: 0 };
    const dist = distMap[s.projectId!] ?? { totalPaid: "0", totalPending: "0" };
    const lca  = lcaMap[s.projectId!] ?? { totalPaid: 0, totalBal: 0 };
    const gross = toNum(s.grossRevenue);
    const net   = toNum(s.landownerNet);
    const margin = gross > 0 ? parseFloat(((net / gross) * 100).toFixed(1)) : 0;
    return {
      projectId:           s.projectId,
      projectName:         s.projectName ?? s.projectId,
      grossRevenue:        toFixed(gross),
      landownerSplit:      toFixed(toNum(s.landownerSplit)),
      participantPoolSplit: toFixed(toNum(s.participantPoolSplit)),
      operationalCost:     toFixed(toNum(s.operationalCost)),
      lcaAmount:           toFixed(toNum(s.lcaAmount)),
      landownerNet:        toFixed(net),
      landownerMarginPct:  margin,
      eppAllocated:        toFixed(toNum(epp.totalAllocated)),
      eppParticipants:     Number(epp.participantCount),
      distributionPaid:    toFixed(toNum(dist.totalPaid)),
      distributionPending: toFixed(toNum(dist.totalPending)),
      lcaPaid:             toFixed(toNum(lca.totalPaid)),
      lcaPending:          toFixed(toNum(lca.totalBal)),
      sessionCount:        Number(s.sessionCount),
      confirmedCount:      Number(s.confirmedCount),
    };
  });

  logSettlementAccess(req, "financial_analytics", "project_profitability");
  return res.json({ projects });
});

// ── GET /financial-analytics/allocation-breakdown ─────────────────────────

router.get("/allocation-breakdown", requireSettlementAccess, async (req, res) => {
  const { projectId } = req.query as { projectId?: string };
  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "financial_analytics", "allocation_breakdown");
    return res.json({ grossRevenue: "0.00", breakdown: [] });
  }
  const scopeFilter = (col: Parameters<typeof eq>[0]) =>
    projectId ? eq(col, projectId) : projectScope !== null ? inArray(col, projectScope) : undefined;

  const filter = and(
    eq(fiftyPctSessionsTable.status, "confirmed"),
    scopeFilter(fiftyPctSessionsTable.projectId),
  );

  const [agg] = await db
    .select({
      grossRevenue:        sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.grossRevenue}), 0)`,
      operationalCost:     sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.operationalCost}), 0)`,
      lcaAmount:           sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.lcaAmount}), 0)`,
      landownerNet:        sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.landownerNet}), 0)`,
      participantPoolSplit: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.participantPoolSplit}), 0)`,
    })
    .from(fiftyPctSessionsTable)
    .where(filter);

  const gross    = toNum(agg?.grossRevenue);
  const opCost   = toNum(agg?.operationalCost);
  const lca      = toNum(agg?.lcaAmount);
  const landNet  = toNum(agg?.landownerNet);
  const epp      = toNum(agg?.participantPoolSplit);

  const pct = (v: number) => gross > 0 ? parseFloat(((v / gross) * 100).toFixed(1)) : 0;

  logSettlementAccess(req, "financial_analytics", "allocation_breakdown");
  return res.json({
    grossRevenue: toFixed(gross),
    breakdown: [
      { name: "Landowner Net",       value: parseFloat(toFixed(landNet)), pct: pct(landNet),  fill: "#10b981" },
      { name: "Participant Pool",     value: parseFloat(toFixed(epp)),     pct: pct(epp),      fill: "#3b82f6" },
      { name: "Operational Costs",   value: parseFloat(toFixed(opCost)),  pct: pct(opCost),   fill: "#f59e0b" },
      { name: "LCA Deducted",        value: parseFloat(toFixed(lca)),     pct: pct(lca),      fill: "#8b5cf6" },
    ],
  });
});

export default router;

/**
 * global_analytics.ts
 *
 * Global Business Analytics Dashboard API.
 * Admin and Developer only — aggregates across ALL modules and commercial models.
 *
 * Endpoints:
 *   GET /global-analytics/overview  — comprehensive KPIs, monthly trend, project comparison
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  projectsTable,
  productionRecordsTable,
  expendituresTable,
  fiftyPctSessionsTable,
  distributionRecordsTable,
  lcaLedgerTable,
  disputesTable,
  operationalTasksTable,
} from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";

const router = Router();

const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toFixed2 = (v: number) => v.toFixed(2);

// ── GET /global-analytics/overview ────────────────────────────────────────

router.get("/overview", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const [
    projectStats,
    revenueStats,
    expenditureStats,
    distributionStats,
    lcaStats,
    disputeStats,
    taskStats,
    revenueMonthly,
    expenditureMonthly,
    projectComparisonRevenue,
    projectComparisonExpenditure,
    fiftyPctStats,
    expByCategoryResult,
  ] = await Promise.all([
    // Project counts by lifecycle + activation + model
    db
      .select({
        total: sql<number>`COUNT(*)`,
        active: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.activationStatus} = 'active')`,
        draft: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.activationStatus} = 'draft')`,
        suspended: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.activationStatus} = 'suspended')`,
        closed: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.activationStatus} = 'closed')`,
        readyForActivation: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.activationStatus} = 'ready_for_activation')`,
        prematurity: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.lifecycleStatus} = 'prematurity')`,
        matureProduction: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.lifecycleStatus} = 'mature_production')`,
        lifecycleClosed: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.lifecycleStatus} = 'closed')`,
        ownershipModel: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.commercialModel} = 'ownership_contribution')`,
        revenueModel: sql<number>`COUNT(*) FILTER (WHERE ${projectsTable.commercialModel} = 'fifty_percent_revenue')`,
      })
      .from(projectsTable),

    // Revenue from production records
    db
      .select({
        totalRevenue: sql<string>`COALESCE(SUM(${productionRecordsTable.revenue}), 0)`,
        totalProductionKg: sql<string>`COALESCE(SUM(${productionRecordsTable.productionKg}), 0)`,
        totalSoldKg: sql<string>`COALESCE(SUM(${productionRecordsTable.soldKg}), 0)`,
        avgSellingPrice: sql<string>`COALESCE(AVG(${productionRecordsTable.sellingPricePerKg}), 0)`,
        recordCount: sql<number>`COUNT(*)`,
      })
      .from(productionRecordsTable),

    // Expenditure totals
    db
      .select({
        total: sql<string>`COALESCE(SUM(${expendituresTable.amount}), 0)`,
        verified: sql<string>`COALESCE(SUM(${expendituresTable.amount}) FILTER (WHERE ${expendituresTable.verificationStatus} = 'verified'), 0)`,
        draft: sql<string>`COALESCE(SUM(${expendituresTable.amount}) FILTER (WHERE ${expendituresTable.verificationStatus} = 'draft'), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(expendituresTable)
      .where(eq(expendituresTable.isActive, true)),

    // Distribution records
    db
      .select({
        totalPaid: sql<string>`COALESCE(SUM(${distributionRecordsTable.totalPaid}), 0)`,
        totalPending: sql<string>`COALESCE(SUM(${distributionRecordsTable.pendingPayable}), 0)`,
        pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${distributionRecordsTable.status} IN ('pending', 'partial'))`,
        paidCount: sql<number>`COUNT(*) FILTER (WHERE ${distributionRecordsTable.status} = 'paid')`,
      })
      .from(distributionRecordsTable)
      .where(eq(distributionRecordsTable.isActive, true)),

    // LCA outstanding
    db
      .select({
        totalDue: sql<string>`COALESCE(SUM(${lcaLedgerTable.totalDue}), 0)`,
        totalPaid: sql<string>`COALESCE(SUM(${lcaLedgerTable.amountPaid}), 0)`,
        totalPending: sql<string>`COALESCE(SUM(${lcaLedgerTable.balance}), 0)`,
        pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${lcaLedgerTable.status} IN ('pending', 'partial'))`,
      })
      .from(lcaLedgerTable),

    // Disputes
    db
      .select({
        total: sql<number>`COUNT(*)`,
        open: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'open')`,
        underReview: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'under_review')`,
        escalated: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'escalated')`,
        resolved: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'resolved')`,
        critical: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.severity} = 'critical' AND ${disputesTable.status} NOT IN ('resolved', 'withdrawn'))`,
        high: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.severity} = 'high' AND ${disputesTable.status} NOT IN ('resolved', 'withdrawn'))`,
        medium: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.severity} = 'medium' AND ${disputesTable.status} NOT IN ('resolved', 'withdrawn'))`,
        low: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.severity} = 'low' AND ${disputesTable.status} NOT IN ('resolved', 'withdrawn'))`,
      })
      .from(disputesTable),

    // Tasks
    db
      .select({
        total: sql<number>`COUNT(*)`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} = 'pending')`,
        inProgress: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} = 'in_progress')`,
        completed: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} = 'completed')`,
        overdue: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} NOT IN ('completed', 'cancelled') AND ${operationalTasksTable.dueDate} < NOW())`,
      })
      .from(operationalTasksTable),

    // Monthly revenue trend (last 18 months)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
        COALESCE(SUM(revenue), 0)::numeric AS revenue,
        COALESCE(SUM(production_kg), 0)::numeric AS production_kg,
        COALESCE(SUM(sold_kg), 0)::numeric AS sold_kg
      FROM production_records
      WHERE recorded_at >= NOW() - INTERVAL '18 months'
      GROUP BY DATE_TRUNC('month', recorded_at)
      ORDER BY DATE_TRUNC('month', recorded_at) ASC
    `),

    // Monthly expenditure trend (last 18 months)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount), 0)::numeric AS expenditure
      FROM expenditures
      WHERE is_active = true AND created_at >= NOW() - INTERVAL '18 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) ASC
    `),

    // Per-project revenue
    db
      .select({
        projectId: productionRecordsTable.projectId,
        projectName: projectsTable.name,
        totalRevenue: sql<string>`COALESCE(SUM(${productionRecordsTable.revenue}), 0)`,
        totalProductionKg: sql<string>`COALESCE(SUM(${productionRecordsTable.productionKg}), 0)`,
        totalSoldKg: sql<string>`COALESCE(SUM(${productionRecordsTable.soldKg}), 0)`,
      })
      .from(productionRecordsTable)
      .leftJoin(projectsTable, eq(productionRecordsTable.projectId, projectsTable.id))
      .groupBy(productionRecordsTable.projectId, projectsTable.name)
      .orderBy(desc(sql`SUM(${productionRecordsTable.revenue})`)),

    // Per-project expenditure
    db
      .select({
        projectId: expendituresTable.projectId,
        totalExpenditure: sql<string>`COALESCE(SUM(${expendituresTable.amount}), 0)`,
      })
      .from(expendituresTable)
      .where(eq(expendituresTable.isActive, true))
      .groupBy(expendituresTable.projectId),

    // 50% model summary
    db
      .select({
        totalGross: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.grossRevenue}), 0)`,
        totalPool: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.participantPoolSplit}), 0)`,
        totalLandownerNet: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.landownerNet}), 0)`,
        confirmedCount: sql<number>`COUNT(*) FILTER (WHERE ${fiftyPctSessionsTable.status} = 'confirmed')`,
      })
      .from(fiftyPctSessionsTable),

    // Expenditure by category
    db.execute(sql`
      SELECT category, COALESCE(SUM(amount), 0)::numeric AS total
      FROM expenditures WHERE is_active = true
      GROUP BY category ORDER BY total DESC
    `),
  ]);

  // ── Build monthly trend (merge revenue + expenditure) ─────────────────────

  const revenueByMonth: Record<string, { revenue: number; productionKg: number; soldKg: number }> = {};
  for (const row of revenueMonthly.rows as Record<string, unknown>[]) {
    const m = String(row.month);
    revenueByMonth[m] = {
      revenue: toNum(row.revenue),
      productionKg: toNum(row.production_kg),
      soldKg: toNum(row.sold_kg),
    };
  }

  const expenditureByMonth: Record<string, number> = {};
  for (const row of expenditureMonthly.rows as Record<string, unknown>[]) {
    const m = String(row.month);
    expenditureByMonth[m] = (expenditureByMonth[m] ?? 0) + toNum(row.expenditure);
  }

  const allMonths = new Set([...Object.keys(revenueByMonth), ...Object.keys(expenditureByMonth)]);
  const monthlyTrend = Array.from(allMonths)
    .sort()
    .map(month => {
      const rev = revenueByMonth[month]?.revenue ?? 0;
      const exp = expenditureByMonth[month] ?? 0;
      return {
        month,
        revenue: parseFloat(rev.toFixed(2)),
        expenditure: parseFloat(exp.toFixed(2)),
        profit: parseFloat((rev - exp).toFixed(2)),
        productionKg: parseFloat((revenueByMonth[month]?.productionKg ?? 0).toFixed(2)),
        soldKg: parseFloat((revenueByMonth[month]?.soldKg ?? 0).toFixed(2)),
      };
    });

  // ── Per-project comparison ────────────────────────────────────────────────

  const expByProject: Record<string, number> = {};
  for (const r of projectComparisonExpenditure) {
    expByProject[r.projectId] = toNum(r.totalExpenditure);
  }

  const projectComparison = projectComparisonRevenue.map(p => {
    const rev = toNum(p.totalRevenue);
    const exp = expByProject[p.projectId!] ?? 0;
    return {
      projectId: p.projectId,
      projectName: p.projectName ?? String(p.projectId),
      revenue: parseFloat(rev.toFixed(2)),
      expenditure: parseFloat(exp.toFixed(2)),
      profit: parseFloat((rev - exp).toFixed(2)),
      productionKg: parseFloat(toNum(p.totalProductionKg).toFixed(2)),
      soldKg: parseFloat(toNum(p.totalSoldKg).toFixed(2)),
    };
  });

  // ── Stock estimate ────────────────────────────────────────────────────────

  const totalProducedKg = toNum(revenueStats[0]?.totalProductionKg);
  const totalSoldKg = toNum(revenueStats[0]?.totalSoldKg);
  const currentStockKg = Math.max(0, totalProducedKg - totalSoldKg);
  const avgPrice = toNum(revenueStats[0]?.avgSellingPrice);

  // ── Pending settlements total ─────────────────────────────────────────────

  const pendingDistribution = toNum(distributionStats[0]?.totalPending);
  const pendingLca = toNum(lcaStats[0]?.totalPending);

  // ── Aggregate fields ─────────────────────────────────────────────────────

  const ps = projectStats[0];
  const rs = revenueStats[0];
  const es = expenditureStats[0];
  const ds = distributionStats[0];
  const ls = lcaStats[0];
  const dis = disputeStats[0];
  const ts = taskStats[0];
  const fs = fiftyPctStats[0];

  const totalRevenue = toNum(rs?.totalRevenue);
  const totalExpenditure = toNum(es?.total);
  const operationalProfit = totalRevenue - totalExpenditure;

  const expenditureByCategoryList = (expByCategoryResult.rows as Record<string, unknown>[]).map(r => ({
    category: String(r.category),
    total: parseFloat(toNum(r.total).toFixed(2)),
  }));

  req.log.info({ endpoint: "global-analytics/overview" }, "Global analytics overview fetched");

  return res.json({
    projects: {
      total: Number(ps?.total ?? 0),
      byActivation: {
        active: Number(ps?.active ?? 0),
        draft: Number(ps?.draft ?? 0),
        suspended: Number(ps?.suspended ?? 0),
        closed: Number(ps?.closed ?? 0),
        readyForActivation: Number(ps?.readyForActivation ?? 0),
      },
      byLifecycle: {
        prematurity: Number(ps?.prematurity ?? 0),
        matureProduction: Number(ps?.matureProduction ?? 0),
        closed: Number(ps?.lifecycleClosed ?? 0),
      },
      byModel: {
        ownershipContribution: Number(ps?.ownershipModel ?? 0),
        fiftyPctRevenue: Number(ps?.revenueModel ?? 0),
      },
    },
    revenue: {
      total: toFixed2(totalRevenue),
      totalProductionKg: toFixed2(toNum(rs?.totalProductionKg)),
      totalSoldKg: toFixed2(toNum(rs?.totalSoldKg)),
      avgSellingPrice: toFixed2(avgPrice),
      recordCount: Number(rs?.recordCount ?? 0),
    },
    expenditure: {
      total: toFixed2(totalExpenditure),
      verified: toFixed2(toNum(es?.verified)),
      draft: toFixed2(toNum(es?.draft)),
      count: Number(es?.count ?? 0),
      byCategory: expenditureByCategoryList,
    },
    operationalProfit: {
      total: toFixed2(operationalProfit),
      margin: totalRevenue > 0 ? parseFloat(((operationalProfit / totalRevenue) * 100).toFixed(1)) : 0,
    },
    distributableProfit: {
      grossRevenue: toFixed2(toNum(fs?.totalGross)),
      poolShare: toFixed2(toNum(fs?.totalPool)),
      landownerNet: toFixed2(toNum(fs?.totalLandownerNet)),
      confirmedSessions: Number(fs?.confirmedCount ?? 0),
    },
    pendingSettlements: {
      totalAmount: toFixed2(pendingDistribution + pendingLca),
      totalCount: Number(ds?.pendingCount ?? 0) + Number(ls?.pendingCount ?? 0),
      distributionPending: toFixed2(pendingDistribution),
      distributionCount: Number(ds?.pendingCount ?? 0),
      lcaPending: toFixed2(pendingLca),
      lcaCount: Number(ls?.pendingCount ?? 0),
      distributionPaid: toFixed2(toNum(ds?.totalPaid)),
      paidCount: Number(ds?.paidCount ?? 0),
    },
    stock: {
      totalProductionKg: toFixed2(totalProducedKg),
      totalSoldKg: toFixed2(totalSoldKg),
      currentStockKg: toFixed2(currentStockKg),
      avgSellingPrice: toFixed2(avgPrice),
      estimatedStockValue: toFixed2(currentStockKg * avgPrice),
    },
    disputes: {
      total: Number(dis?.total ?? 0),
      active: Number(dis?.open ?? 0) + Number(dis?.underReview ?? 0) + Number(dis?.escalated ?? 0),
      open: Number(dis?.open ?? 0),
      underReview: Number(dis?.underReview ?? 0),
      escalated: Number(dis?.escalated ?? 0),
      resolved: Number(dis?.resolved ?? 0),
      bySeverity: {
        critical: Number(dis?.critical ?? 0),
        high: Number(dis?.high ?? 0),
        medium: Number(dis?.medium ?? 0),
        low: Number(dis?.low ?? 0),
      },
    },
    tasks: {
      total: Number(ts?.total ?? 0),
      pending: Number(ts?.pending ?? 0),
      inProgress: Number(ts?.inProgress ?? 0),
      completed: Number(ts?.completed ?? 0),
      overdue: Number(ts?.overdue ?? 0),
      completionRate:
        Number(ts?.total ?? 0) > 0
          ? parseFloat((Number(ts?.completed ?? 0) / Number(ts?.total ?? 0) * 100).toFixed(1))
          : 0,
    },
    monthlyTrend,
    projectComparison,
  });
});

export default router;

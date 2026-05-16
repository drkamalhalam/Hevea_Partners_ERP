/**
 * project_analytics.ts
 *
 * Project-Wise Analytics & Performance Reporting API.
 * Role-aware: admin/developer see all projects; others see only assigned projects.
 *
 * Endpoints:
 *   GET /project-analytics/projects        — list of projects visible to caller
 *   GET /project-analytics/overview        — full per-project analytics summary
 */

import { Router } from "express";
import {
  db,
  usersTable,
  projectsTable,
  productionRecordsTable,
  expendituresTable,
  inventoryStockMovementsTable,
  partnersTable,
  agreementsTable,
  contributionsTable,
  fiftyPctSessionsTable,
  distributionRecordsTable,
  lcaLedgerTable,
  settlementRecordsTable,
  disputesTable,
  operationalTasksTable,
  projectLifecycleHistoryTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc, asc } from "drizzle-orm";

const router = Router();

const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toF = (v: number) => v.toFixed(2);

// ── Helpers ───────────────────────────────────────────────────────────────



// ── GET /project-analytics/projects ──────────────────────────────────────

router.get("/projects", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });

  let projects;
  if (req.canAccessAllProjects) {
    projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, commercialModel: projectsTable.commercialModel, lifecycleStatus: projectsTable.lifecycleStatus, activationStatus: projectsTable.activationStatus })
      .from(projectsTable)
      .where(eq(projectsTable.isActive, true))
      .orderBy(asc(projectsTable.name));
  } else {
    const ids = req.userProjectIds ?? [];
    if (ids.length === 0) return res.json({ projects: [] });
    projects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, commercialModel: projectsTable.commercialModel, lifecycleStatus: projectsTable.lifecycleStatus, activationStatus: projectsTable.activationStatus })
      .from(projectsTable)
      .where(and(eq(projectsTable.isActive, true), inArray(projectsTable.id, ids)))
      .orderBy(asc(projectsTable.name));
  }

  return res.json({ projects });
});

// ── GET /project-analytics/overview?projectId=xxx ────────────────────────

router.get("/overview", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });


  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId is required" });

  // Access control
  if (!req.canAccessAllProjects) {
    const allowed = req.userProjectIds ?? [];
    if (!allowed.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  // Load project details
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) return res.status(404).json({ error: "Project not found" });

  const pid = projectId;

  const [
    productionStats,
    productionMonthly,
    inventoryStats,
    inventoryByTypeRaw,
    expenditureStats,
    expenditureByCat,
    expenditureByPhase,
    expenditureMonthly,
    partnersRows,
    contributionStats,
    agreementStats,
    fiftyPctStats,
    distributionStats,
    lcaStats,
    settlementStats,
    disputeStats,
    disputeList,
    taskStats,
    taskList,
    lifecycleHistory,
  ] = await Promise.all([
    // Production aggregate
    db.select({
      totalRevenue: sql<string>`COALESCE(SUM(${productionRecordsTable.revenue}), 0)`,
      totalProductionKg: sql<string>`COALESCE(SUM(${productionRecordsTable.productionKg}), 0)`,
      totalSoldKg: sql<string>`COALESCE(SUM(${productionRecordsTable.soldKg}), 0)`,
      avgSellingPrice: sql<string>`COALESCE(AVG(${productionRecordsTable.sellingPricePerKg}), 0)`,
      recordCount: sql<number>`COUNT(*)`,
    }).from(productionRecordsTable).where(eq(productionRecordsTable.projectId, pid)),

    // Monthly production trend (last 18 months)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
        COALESCE(SUM(revenue), 0)::numeric AS revenue,
        COALESCE(SUM(production_kg), 0)::numeric AS production_kg,
        COALESCE(SUM(sold_kg), 0)::numeric AS sold_kg,
        COALESCE(AVG(selling_price_per_kg), 0)::numeric AS avg_price,
        COUNT(*) AS record_count
      FROM production_records
      WHERE project_id = ${pid}::uuid
        AND recorded_at >= NOW() - INTERVAL '18 months'
      GROUP BY DATE_TRUNC('month', recorded_at)
      ORDER BY DATE_TRUNC('month', recorded_at) ASC
    `),

    // Inventory aggregate
    db.select({
      totalIn: sql<string>`COALESCE(SUM(${inventoryStockMovementsTable.quantity}) FILTER (WHERE ${inventoryStockMovementsTable.direction} = 'in' AND ${inventoryStockMovementsTable.status} = 'confirmed'), 0)`,
      totalOut: sql<string>`COALESCE(SUM(${inventoryStockMovementsTable.quantity}) FILTER (WHERE ${inventoryStockMovementsTable.direction} = 'out' AND ${inventoryStockMovementsTable.status} = 'confirmed'), 0)`,
      movementCount: sql<number>`COUNT(*) FILTER (WHERE ${inventoryStockMovementsTable.status} = 'confirmed')`,
    }).from(inventoryStockMovementsTable).where(eq(inventoryStockMovementsTable.projectId, pid)),

    // Inventory by stock type
    db.execute(sql`
      SELECT
        stock_type,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'in' AND status = 'confirmed'), 0) AS total_in,
        COALESCE(SUM(quantity::numeric) FILTER (WHERE direction = 'out' AND status = 'confirmed'), 0) AS total_out,
        unit
      FROM inventory_stock_movements
      WHERE project_id = ${pid}::uuid
      GROUP BY stock_type, unit
      ORDER BY stock_type
    `),

    // Expenditure aggregate
    db.select({
      total: sql<string>`COALESCE(SUM(${expendituresTable.amount}), 0)`,
      verified: sql<string>`COALESCE(SUM(${expendituresTable.amount}) FILTER (WHERE ${expendituresTable.verificationStatus} = 'verified'), 0)`,
      draft: sql<string>`COALESCE(SUM(${expendituresTable.amount}) FILTER (WHERE ${expendituresTable.verificationStatus} = 'draft'), 0)`,
      count: sql<number>`COUNT(*)`,
    }).from(expendituresTable).where(and(eq(expendituresTable.projectId, pid), eq(expendituresTable.isActive, true))),

    // Expenditure by category
    db.execute(sql`
      SELECT category, COALESCE(SUM(amount), 0)::numeric AS total, COUNT(*) AS count
      FROM expenditures WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY category ORDER BY total DESC
    `),

    // Expenditure by lifecycle phase
    db.execute(sql`
      SELECT lifecycle_phase_snapshot AS phase, COALESCE(SUM(amount), 0)::numeric AS total, COUNT(*) AS count
      FROM expenditures WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY lifecycle_phase_snapshot ORDER BY total DESC
    `),

    // Monthly expenditure trend (last 18 months)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount), 0)::numeric AS expenditure
      FROM expenditures
      WHERE project_id = ${pid}::uuid AND is_active = true
        AND created_at >= NOW() - INTERVAL '18 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at) ASC
    `),

    // Partners linked to this project (via agreements or contributions)
    db.execute(sql`
      SELECT DISTINCT p.id, p.name, p.role, p.email, p.phone
      FROM partners p
      WHERE p.id IN (
        SELECT DISTINCT partner_id FROM agreements WHERE project_id = ${pid}::uuid
        UNION
        SELECT DISTINCT partner_id FROM contributions WHERE project_id = ${pid}::uuid AND is_active = true
      )
      AND p.is_active = true
      ORDER BY p.name
    `),

    // Contribution aggregate
    db.select({
      totalAmount: sql<string>`COALESCE(SUM(${contributionsTable.amount}), 0)`,
      verified: sql<string>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.verificationStatus} = 'verified'), 0)`,
      pending: sql<string>`COALESCE(SUM(${contributionsTable.amount}) FILTER (WHERE ${contributionsTable.verificationStatus} IN ('draft','pending')), 0)`,
      count: sql<number>`COUNT(*)`,
    }).from(contributionsTable).where(and(eq(contributionsTable.projectId, pid), eq(contributionsTable.isActive, true))),

    // Agreement counts
    db.select({
      total: sql<number>`COUNT(*)`,
      active: sql<number>`COUNT(*) FILTER (WHERE ${agreementsTable.status} = 'active')`,
      draft: sql<number>`COUNT(*) FILTER (WHERE ${agreementsTable.status} = 'draft')`,
      terminated: sql<number>`COUNT(*) FILTER (WHERE ${agreementsTable.status} = 'terminated')`,
    }).from(agreementsTable).where(eq(agreementsTable.projectId, pid)),

    // 50% model session stats
    db.select({
      grossRevenue: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.grossRevenue}), 0)`,
      landownerNet: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.landownerNet}), 0)`,
      poolShare: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.participantPoolSplit}), 0)`,
      opCost: sql<string>`COALESCE(SUM(${fiftyPctSessionsTable.operationalCost}), 0)`,
      confirmedCount: sql<number>`COUNT(*) FILTER (WHERE ${fiftyPctSessionsTable.status} = 'confirmed')`,
      draftCount: sql<number>`COUNT(*) FILTER (WHERE ${fiftyPctSessionsTable.status} = 'draft')`,
    }).from(fiftyPctSessionsTable).where(eq(fiftyPctSessionsTable.projectId, pid)),

    // Distribution records
    db.select({
      totalPaid: sql<string>`COALESCE(SUM(${distributionRecordsTable.totalPaid}), 0)`,
      totalPending: sql<string>`COALESCE(SUM(${distributionRecordsTable.pendingPayable}), 0)`,
      paidCount: sql<number>`COUNT(*) FILTER (WHERE ${distributionRecordsTable.status} = 'paid')`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${distributionRecordsTable.status} IN ('pending','partial'))`,
    }).from(distributionRecordsTable).where(and(eq(distributionRecordsTable.projectId, pid), eq(distributionRecordsTable.isActive, true))),

    // LCA ledger
    db.select({
      totalDue: sql<string>`COALESCE(SUM(${lcaLedgerTable.totalDue}), 0)`,
      totalPaid: sql<string>`COALESCE(SUM(${lcaLedgerTable.amountPaid}), 0)`,
      totalPending: sql<string>`COALESCE(SUM(${lcaLedgerTable.balance}), 0)`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${lcaLedgerTable.status} IN ('pending','partial'))`,
      entryCount: sql<number>`COUNT(*)`,
    }).from(lcaLedgerTable).where(eq(lcaLedgerTable.projectId, pid)),

    // Settlement records
    db.select({
      total: sql<number>`COUNT(*)`,
      finalized: sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.status} = 'finalized')`,
      disputed: sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.status} = 'disputed')`,
      overridden: sql<number>`COUNT(*) FILTER (WHERE ${settlementRecordsTable.isOverridden} = true)`,
      totalActual: sql<string>`COALESCE(SUM(${settlementRecordsTable.actualAmount}) FILTER (WHERE ${settlementRecordsTable.status} = 'finalized'), 0)`,
    }).from(settlementRecordsTable).where(and(eq(settlementRecordsTable.projectId, pid), sql`${settlementRecordsTable.status} != 'archived'`)),

    // Dispute aggregate
    db.select({
      total: sql<number>`COUNT(*)`,
      active: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} NOT IN ('resolved','withdrawn'))`,
      open: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'open')`,
      underReview: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'under_review')`,
      escalated: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'escalated')`,
      resolved: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.status} = 'resolved')`,
      critical: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.severity} = 'critical' AND ${disputesTable.status} NOT IN ('resolved','withdrawn'))`,
      high: sql<number>`COUNT(*) FILTER (WHERE ${disputesTable.severity} = 'high' AND ${disputesTable.status} NOT IN ('resolved','withdrawn'))`,
    }).from(disputesTable).where(eq(disputesTable.projectId, pid)),

    // Open disputes (list, latest 5)
    db.select({
      id: disputesTable.id,
      title: disputesTable.title,
      disputeType: disputesTable.disputeType,
      severity: disputesTable.severity,
      status: disputesTable.status,
      raisedAt: disputesTable.raisedAt,
    }).from(disputesTable)
      .where(and(eq(disputesTable.projectId, pid), sql`${disputesTable.status} NOT IN ('resolved','withdrawn')`))
      .orderBy(desc(disputesTable.raisedAt)).limit(5),

    // Task aggregate
    db.select({
      total: sql<number>`COUNT(*)`,
      pending: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} = 'pending')`,
      inProgress: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} = 'in_progress')`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} = 'completed')`,
      overdue: sql<number>`COUNT(*) FILTER (WHERE ${operationalTasksTable.status} NOT IN ('completed','cancelled') AND ${operationalTasksTable.dueDate} < NOW())`,
    }).from(operationalTasksTable).where(eq(operationalTasksTable.projectId, pid)),

    // Pending/overdue tasks (latest 5)
    db.select({
      id: operationalTasksTable.id,
      title: operationalTasksTable.title,
      taskType: operationalTasksTable.taskType,
      priority: operationalTasksTable.priority,
      status: operationalTasksTable.status,
      dueDate: operationalTasksTable.dueDate,
    }).from(operationalTasksTable)
      .where(and(eq(operationalTasksTable.projectId, pid), inArray(operationalTasksTable.status, ["pending", "in_progress"])))
      .orderBy(asc(operationalTasksTable.dueDate)).limit(5),

    // Lifecycle history
    db.select({
      fromStatus: projectLifecycleHistoryTable.fromStatus,
      toStatus: projectLifecycleHistoryTable.toStatus,
      changedAt: projectLifecycleHistoryTable.changedAt,
      remarks: projectLifecycleHistoryTable.remarks,
      changedByName: projectLifecycleHistoryTable.changedByName,
    }).from(projectLifecycleHistoryTable)
      .where(eq(projectLifecycleHistoryTable.projectId, pid))
      .orderBy(asc(projectLifecycleHistoryTable.changedAt)),
  ]);

  // ── Merge monthly trend (production + expenditure) ────────────────────

  const revByMonth: Record<string, { revenue: number; productionKg: number; soldKg: number; avgPrice: number }> = {};
  for (const r of productionMonthly.rows as Record<string, unknown>[]) {
    const m = String(r.month);
    revByMonth[m] = {
      revenue: toNum(r.revenue),
      productionKg: toNum(r.production_kg),
      soldKg: toNum(r.sold_kg),
      avgPrice: toNum(r.avg_price),
    };
  }

  const expByMonth: Record<string, number> = {};
  for (const r of expenditureMonthly.rows as Record<string, unknown>[]) {
    const m = String(r.month);
    expByMonth[m] = toNum(r.expenditure);
  }

  const allMonths = new Set([...Object.keys(revByMonth), ...Object.keys(expByMonth)]);
  const monthlyTrend = Array.from(allMonths).sort().map(month => {
    const rev = revByMonth[month]?.revenue ?? 0;
    const exp = expByMonth[month] ?? 0;
    return {
      month,
      revenue: parseFloat(rev.toFixed(2)),
      expenditure: parseFloat(exp.toFixed(2)),
      profit: parseFloat((rev - exp).toFixed(2)),
      productionKg: parseFloat((revByMonth[month]?.productionKg ?? 0).toFixed(2)),
      soldKg: parseFloat((revByMonth[month]?.soldKg ?? 0).toFixed(2)),
      avgPrice: parseFloat((revByMonth[month]?.avgPrice ?? 0).toFixed(2)),
      revenuePerKg: (revByMonth[month]?.soldKg ?? 0) > 0
        ? parseFloat((rev / (revByMonth[month]?.soldKg ?? 1)).toFixed(2))
        : 0,
    };
  });

  // ── Compute derived metrics ───────────────────────────────────────────

  const ps = productionStats[0];
  const es = expenditureStats[0];
  const ds = distributionStats[0];
  const ls = lcaStats[0];
  const ss = settlementStats[0];
  const dis = disputeStats[0];
  const ts = taskStats[0];
  const fs = fiftyPctStats[0];
  const cs = contributionStats[0];
  const as_ = agreementStats[0];
  const invS = inventoryStats[0];

  const totalRevenue = toNum(ps?.totalRevenue);
  const totalProductionKg = toNum(ps?.totalProductionKg);
  const totalSoldKg = toNum(ps?.totalSoldKg);
  const totalExpenditure = toNum(es?.total);
  const operationalProfit = totalRevenue - totalExpenditure;
  const profitMargin = totalRevenue > 0 ? (operationalProfit / totalRevenue) * 100 : 0;
  const currentStockKg = Math.max(0, totalProductionKg - totalSoldKg);
  const avgPrice = toNum(ps?.avgSellingPrice);
  const sellThroughRate = totalProductionKg > 0 ? (totalSoldKg / totalProductionKg) * 100 : 0;

  const inventoryByType = (inventoryByTypeRaw.rows as Record<string, unknown>[]).map(r => ({
    stockType: String(r.stock_type),
    unit: String(r.unit),
    totalIn: parseFloat(toNum(r.total_in).toFixed(3)),
    totalOut: parseFloat(toNum(r.total_out).toFixed(3)),
    balance: parseFloat((toNum(r.total_in) - toNum(r.total_out)).toFixed(3)),
  }));

  req.log.info({ endpoint: "project-analytics/overview", projectId: pid }, "Project analytics fetched");

  return res.json({
    project: {
      id: project.id,
      name: project.name,
      projectCode: project.projectCode,
      location: project.location,
      district: project.district,
      state: project.state,
      landArea: project.landArea,
      landAreaUnit: project.landAreaUnit,
      landNotionalValue: project.landNotionalValue,
      commercialModel: project.commercialModel,
      lifecycleStatus: project.lifecycleStatus,
      activationStatus: project.activationStatus,
      startDate: project.startDate,
      expectedMaturityDate: project.expectedMaturityDate,
      termYears: project.termYears,
    },
    production: {
      totalRevenue: toF(totalRevenue),
      totalProductionKg: toF(totalProductionKg),
      totalSoldKg: toF(totalSoldKg),
      currentStockKg: toF(currentStockKg),
      avgSellingPrice: toF(avgPrice),
      recordCount: Number(ps?.recordCount ?? 0),
      sellThroughRate: parseFloat(sellThroughRate.toFixed(1)),
      estimatedStockValue: toF(currentStockKg * avgPrice),
    },
    inventory: {
      totalIn: toF(toNum(invS?.totalIn)),
      totalOut: toF(toNum(invS?.totalOut)),
      balance: toF(Math.max(0, toNum(invS?.totalIn) - toNum(invS?.totalOut))),
      movementCount: Number(invS?.movementCount ?? 0),
      byStockType: inventoryByType,
    },
    expenditure: {
      total: toF(totalExpenditure),
      verified: toF(toNum(es?.verified)),
      draft: toF(toNum(es?.draft)),
      count: Number(es?.count ?? 0),
      byCategory: (expenditureByCat.rows as Record<string, unknown>[]).map(r => ({
        category: String(r.category).replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        total: parseFloat(toNum(r.total).toFixed(2)),
        count: Number(r.count),
      })),
      byPhase: (expenditureByPhase.rows as Record<string, unknown>[]).map(r => ({
        phase: String(r.phase),
        total: parseFloat(toNum(r.total).toFixed(2)),
        count: Number(r.count),
      })),
    },
    revenue: {
      production: toF(totalRevenue),
      fiftyPctGross: toF(toNum(fs?.grossRevenue)),
      fiftyPctLandownerNet: toF(toNum(fs?.landownerNet)),
      fiftyPctPoolShare: toF(toNum(fs?.poolShare)),
      fiftyPctOpCost: toF(toNum(fs?.opCost)),
      confirmedSessions: Number(fs?.confirmedCount ?? 0),
      draftSessions: Number(fs?.draftCount ?? 0),
    },
    profitability: {
      operationalProfit: toF(operationalProfit),
      profitMargin: parseFloat(profitMargin.toFixed(1)),
      revenuePerKg: totalSoldKg > 0 ? parseFloat((totalRevenue / totalSoldKg).toFixed(2)) : 0,
      expenditurePerKg: totalProductionKg > 0 ? parseFloat((totalExpenditure / totalProductionKg).toFixed(2)) : 0,
    },
    partnerships: {
      partners: (partnersRows.rows as Record<string, unknown>[]).map(r => ({
        id: String(r.id),
        name: String(r.name),
        role: String(r.role),
        email: r.email ? String(r.email) : null,
        phone: r.phone ? String(r.phone) : null,
      })),
      partnerCount: (partnersRows.rows as Record<string, unknown>[]).length,
      contributions: {
        totalAmount: toF(toNum(cs?.totalAmount)),
        verified: toF(toNum(cs?.verified)),
        pending: toF(toNum(cs?.pending)),
        count: Number(cs?.count ?? 0),
      },
    },
    agreements: {
      total: Number(as_?.total ?? 0),
      active: Number(as_?.active ?? 0),
      draft: Number(as_?.draft ?? 0),
      terminated: Number(as_?.terminated ?? 0),
    },
    settlements: {
      distribution: {
        totalPaid: toF(toNum(ds?.totalPaid)),
        totalPending: toF(toNum(ds?.totalPending)),
        paidCount: Number(ds?.paidCount ?? 0),
        pendingCount: Number(ds?.pendingCount ?? 0),
      },
      lca: {
        totalDue: toF(toNum(ls?.totalDue)),
        totalPaid: toF(toNum(ls?.totalPaid)),
        totalPending: toF(toNum(ls?.totalPending)),
        pendingCount: Number(ls?.pendingCount ?? 0),
        entryCount: Number(ls?.entryCount ?? 0),
      },
      records: {
        total: Number(ss?.total ?? 0),
        finalized: Number(ss?.finalized ?? 0),
        disputed: Number(ss?.disputed ?? 0),
        overridden: Number(ss?.overridden ?? 0),
        totalActual: toF(toNum(ss?.totalActual)),
        completionRate: Number(ss?.total ?? 0) > 0
          ? parseFloat((Number(ss?.finalized ?? 0) / Number(ss?.total ?? 0) * 100).toFixed(1))
          : 0,
      },
    },
    governance: {
      disputes: {
        total: Number(dis?.total ?? 0),
        active: Number(dis?.active ?? 0),
        open: Number(dis?.open ?? 0),
        underReview: Number(dis?.underReview ?? 0),
        escalated: Number(dis?.escalated ?? 0),
        resolved: Number(dis?.resolved ?? 0),
        critical: Number(dis?.critical ?? 0),
        high: Number(dis?.high ?? 0),
      },
      tasks: {
        total: Number(ts?.total ?? 0),
        pending: Number(ts?.pending ?? 0),
        inProgress: Number(ts?.inProgress ?? 0),
        completed: Number(ts?.completed ?? 0),
        overdue: Number(ts?.overdue ?? 0),
        completionRate: Number(ts?.total ?? 0) > 0
          ? parseFloat((Number(ts?.completed ?? 0) / Number(ts?.total ?? 0) * 100).toFixed(1))
          : 0,
      },
    },
    pendingActions: {
      disputes: disputeList.map(d => ({
        id: d.id,
        title: d.title,
        disputeType: d.disputeType,
        severity: d.severity,
        status: d.status,
        raisedAt: d.raisedAt,
      })),
      tasks: taskList.map(t => ({
        id: t.id,
        title: t.title,
        taskType: t.taskType,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate,
      })),
      pendingSettlementAmount: toF(toNum(ds?.totalPending) + toNum(ls?.totalPending)),
      pendingSettlementCount: Number(ds?.pendingCount ?? 0) + Number(ls?.pendingCount ?? 0),
    },
    lifecycleHistory: lifecycleHistory.map(h => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedAt: h.changedAt,
      remarks: h.remarks,
      changedByName: h.changedByName,
    })),
    monthlyTrend,
  });
});

export default router;

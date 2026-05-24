/**
 * financial_reports.ts
 *
 * Comprehensive Financial Reporting API — per-project, partner-wise, and year-wise.
 * Role-aware: admin/developer see all; others see only assigned projects.
 *
 * Endpoints:
 *   GET /financial-reports/projects                 — list accessible projects
 *   GET /financial-reports/partners?projectId=      — list partners for project
 *   GET /financial-reports/statement?projectId=&year=  — full P&L + revenue + expenditure
 *   GET /financial-reports/lca?projectId=           — LCA ledger with carry-forward
 *   GET /financial-reports/burden?projectId=&year=  — burden + recoverable per partner
 *   GET /financial-reports/settlements?projectId=&year= — distribution + settlement records
 *   GET /financial-reports/year-summary             — year-over-year cross-project
 *   GET /financial-reports/partner-report?projectId=&partnerId= — partner financials
 */

import { Router } from "express";
import { sumMoney } from "../lib/money";
import {
  db,
  projectsTable,
  productionRecordsTable,
  expendituresTable,
  lcaLedgerTable,
  lcaPaymentEventsTable,
  landownerLedgerTable,
  settlementRecordsTable,
  distributionRecordsTable,
  fiftyPctSessionsTable,
  partnersTable,
  contributionsTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc, asc } from "drizzle-orm";
import { requireFinancialAccess, auditMiddleware } from "../middlewares/reportAccessControl";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────
const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toF = (v: number) => parseFloat(v.toFixed(2));
const isPrivileged = (role: string) => role === "admin" || role === "developer";

function yearFilter(col: Parameters<typeof sql>[0], year?: string): string {
  if (!year || year === "all") return "";
  return `AND EXTRACT(YEAR FROM ${col}) = ${parseInt(year, 10)}`;
}

// ── GET /financial-reports/projects ──────────────────────────────────────

router.get("/projects", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };
  const allowed = req.canAccessAllProjects ? null : (req.userProjectIds ?? []);

  const projects = allowed !== null && allowed.length === 0
    ? []
    : await db
        .select({
          id: projectsTable.id,
          name: projectsTable.name,
          projectCode: projectsTable.projectCode,
          commercialModel: projectsTable.commercialModel,
          lifecycleStatus: projectsTable.lifecycleStatus,
          activationStatus: projectsTable.activationStatus,
          startDate: projectsTable.startDate,
        })
        .from(projectsTable)
        .where(
          allowed !== null
            ? and(eq(projectsTable.isActive, true), inArray(projectsTable.id, allowed))
            : eq(projectsTable.isActive, true),
        )
        .orderBy(asc(projectsTable.name));

  return res.json({ projects });
});

// ── GET /financial-reports/partners?projectId= ────────────────────────────

router.get("/partners", async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  if (!req.canAccessAllProjects) {
    const allowed = (req.userProjectIds ?? []);
    if (!allowed.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const result = await db.execute(sql`
    SELECT DISTINCT p.id, p.name, p.role, p.email
    FROM partners p
    WHERE p.id IN (
      SELECT DISTINCT partner_id FROM agreements WHERE project_id = ${projectId}::uuid
      UNION
      SELECT DISTINCT partner_id FROM contributions WHERE project_id = ${projectId}::uuid AND is_active = true
      UNION
      SELECT DISTINCT partner_id FROM landowner_ledger_entries WHERE project_id = ${projectId}::uuid
      UNION
      SELECT DISTINCT partner_id FROM distribution_records WHERE project_id = ${projectId}::uuid
    )
    AND p.is_active = true
    ORDER BY p.name
  `);

  return res.json({ partners: result.rows });
});

// ── GET /financial-reports/statement?projectId=&year= ────────────────────

router.get("/statement", requireFinancialAccess, auditMiddleware("financial_reports", "statement"), async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId, year } = req.query as { projectId?: string; year?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });

  if (!req.canAccessAllProjects) {
    const allowed = (req.userProjectIds ?? []);
    if (!allowed.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const pid = projectId;
  const yearInt = year && year !== "all" ? parseInt(year, 10) : null;

  const [
    prodStats,
    prodMonthly,
    prodYears,
    expStats,
    expByCat,
    expMonthly,
    fiftyStats,
    fiftyMonthly,
    fiftyYears,
    lcaSummary,
    landownerSummary,
  ] = await Promise.all([
    // Production aggregate
    db.execute(sql`
      SELECT
        COALESCE(SUM(revenue), 0)::numeric AS total_revenue,
        COALESCE(SUM(production_kg), 0)::numeric AS total_production_kg,
        COALESCE(SUM(sold_kg), 0)::numeric AS total_sold_kg,
        COALESCE(AVG(selling_price_per_kg), 0)::numeric AS avg_price,
        COUNT(*) AS record_count
      FROM production_records
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM recorded_at) = ${yearInt}` : sql``}
    `),

    // Monthly production trend
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
        COALESCE(SUM(revenue), 0)::numeric AS revenue,
        COALESCE(SUM(production_kg), 0)::numeric AS production_kg,
        COALESCE(SUM(sold_kg), 0)::numeric AS sold_kg,
        COALESCE(AVG(selling_price_per_kg), 0)::numeric AS avg_price
      FROM production_records
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM recorded_at) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', recorded_at)
      ORDER BY DATE_TRUNC('month', recorded_at)
    `),

    // Distinct years with production data
    db.execute(sql`
      SELECT DISTINCT EXTRACT(YEAR FROM recorded_at)::int AS yr
      FROM production_records WHERE project_id = ${pid}::uuid
      ORDER BY yr DESC
    `),

    // Expenditure aggregate
    db.execute(sql`
      SELECT
        COALESCE(SUM(amount), 0)::numeric AS total,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0)::numeric AS verified,
        COALESCE(SUM(amount) FILTER (WHERE verification_status IN ('draft','pending')), 0)::numeric AS draft,
        COUNT(*) AS cnt
      FROM expenditures
      WHERE project_id = ${pid}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
    `),

    // Expenditure by category
    db.execute(sql`
      SELECT category, COALESCE(SUM(amount), 0)::numeric AS total, COUNT(*) AS cnt
      FROM expenditures
      WHERE project_id = ${pid}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY category ORDER BY total DESC
    `),

    // Monthly expenditure
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount), 0)::numeric AS expenditure
      FROM expenditures
      WHERE project_id = ${pid}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `),

    // 50% sessions aggregate
    db.execute(sql`
      SELECT
        COALESCE(SUM(gross_revenue), 0)::numeric AS gross_revenue,
        COALESCE(SUM(landowner_net), 0)::numeric AS landowner_net,
        COALESCE(SUM(participant_pool_split), 0)::numeric AS pool_split,
        COALESCE(SUM(operational_cost), 0)::numeric AS op_cost,
        COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed_count,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft_count
      FROM fifty_pct_sessions
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND period_year = ${yearInt}` : sql``}
    `),

    // Monthly 50% sessions
    db.execute(sql`
      SELECT
        period_label AS period,
        period_year AS yr,
        COALESCE(SUM(gross_revenue), 0)::numeric AS gross_revenue,
        COALESCE(SUM(landowner_net), 0)::numeric AS landowner_net,
        COALESCE(SUM(participant_pool_split), 0)::numeric AS pool_split,
        COALESCE(SUM(operational_cost), 0)::numeric AS op_cost,
        status
      FROM fifty_pct_sessions
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND period_year = ${yearInt}` : sql``}
      GROUP BY period_label, period_year, status
      ORDER BY period_year DESC, period_label
    `),

    // Distinct years with 50% data
    db.execute(sql`
      SELECT DISTINCT period_year AS yr
      FROM fifty_pct_sessions WHERE project_id = ${pid}::uuid AND period_year IS NOT NULL
      ORDER BY yr DESC
    `),

    // LCA summary
    db.execute(sql`
      SELECT
        COALESCE(SUM(total_due), 0)::numeric AS total_due,
        COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
        COALESCE(SUM(balance), 0)::numeric AS outstanding,
        COALESCE(SUM(carry_forward), 0)::numeric AS total_carry_forward,
        COALESCE(SUM(gross_due), 0)::numeric AS total_gross_due,
        COUNT(*) FILTER (WHERE status IN ('pending','partial')) AS pending_count,
        COUNT(*) AS total_count
      FROM lca_ledger
      WHERE project_id = ${pid}::uuid AND is_active = true
    `),

    // Landowner ledger summary
    db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'revenue_entitlement' AND direction = 'credit' AND status = 'confirmed'), 0)::numeric AS revenue_credit,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'operational_burden' AND direction = 'debit' AND status = 'confirmed'), 0)::numeric AS burden_debit,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'recoverable_adjustment' AND direction = 'credit' AND status = 'confirmed'), 0)::numeric AS recoverable_credit,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'recoverable_adjustment' AND direction = 'debit' AND status = 'confirmed'), 0)::numeric AS recoverable_debit,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'lca_credit' AND status = 'confirmed'), 0)::numeric AS lca_credit,
        COUNT(*) AS entry_count
      FROM landowner_ledger_entries
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM period_start::date) = ${yearInt}` : sql``}
    `),
  ]);

  // ── Merge monthly revenue + expenditure ────────────────────────────────
  const revMap: Record<string, { revenue: number; productionKg: number; soldKg: number; avgPrice: number }> = {};
  for (const r of prodMonthly.rows as Record<string, unknown>[]) {
    revMap[String(r.month)] = { revenue: toNum(r.revenue), productionKg: toNum(r.production_kg), soldKg: toNum(r.sold_kg), avgPrice: toNum(r.avg_price) };
  }
  const expMap: Record<string, number> = {};
  for (const r of expMonthly.rows as Record<string, unknown>[]) {
    expMap[String(r.month)] = toNum(r.expenditure);
  }
  const allMonths = new Set([...Object.keys(revMap), ...Object.keys(expMap)]);
  const monthlyTrend = Array.from(allMonths).sort().map(month => {
    const rev = revMap[month]?.revenue ?? 0;
    const exp = expMap[month] ?? 0;
    return { month, revenue: toF(rev), expenditure: toF(exp), profit: toF(rev - exp), productionKg: toF(revMap[month]?.productionKg ?? 0), soldKg: toF(revMap[month]?.soldKg ?? 0) };
  });

  // ── P&L derivation ────────────────────────────────────────────────────
  const ps = prodStats.rows[0] as Record<string, unknown>;
  const es = expStats.rows[0] as Record<string, unknown>;
  const fs = fiftyStats.rows[0] as Record<string, unknown>;
  const ls = lcaSummary.rows[0] as Record<string, unknown>;
  const ll = landownerSummary.rows[0] as Record<string, unknown>;

  const isOwnership = project.commercialModel === "ownership_contribution";
  const totalRevenue = isOwnership ? toNum(ps?.total_revenue) : toNum(fs?.gross_revenue);
  const totalExpenditure = toNum(es?.total);
  const grossProfit = totalRevenue - totalExpenditure;
  const lcaPaid = toNum(ls?.total_paid);
  const netProfit = grossProfit - lcaPaid;

  const availableYears = new Set([
    ...((prodYears.rows as Record<string, unknown>[]).map(r => Number(r.yr))),
    ...((fiftyYears.rows as Record<string, unknown>[]).map(r => Number(r.yr))),
  ]);

  req.log.info({ endpoint: "financial-reports/statement", projectId: pid, year }, "Financial statement fetched");

  return res.json({
    project: {
      id: project.id, name: project.name, projectCode: project.projectCode,
      commercialModel: project.commercialModel, lifecycleStatus: project.lifecycleStatus,
      startDate: project.startDate,
    },
    period: { year: yearInt ?? "All", availableYears: Array.from(availableYears).sort((a, b) => b - a) },
    pnl: {
      grossRevenue: toF(totalRevenue),
      totalExpenditure: toF(totalExpenditure),
      grossProfit: toF(grossProfit),
      lcaPaid: toF(lcaPaid),
      netProfit: toF(netProfit),
      profitMargin: totalRevenue > 0 ? parseFloat(((grossProfit / totalRevenue) * 100).toFixed(1)) : 0,
      netMargin: totalRevenue > 0 ? parseFloat(((netProfit / totalRevenue) * 100).toFixed(1)) : 0,
    },
    production: {
      totalRevenue: toF(toNum(ps?.total_revenue)),
      totalProductionKg: toF(toNum(ps?.total_production_kg)),
      totalSoldKg: toF(toNum(ps?.total_sold_kg)),
      avgSellingPrice: toF(toNum(ps?.avg_price)),
      recordCount: Number(ps?.record_count ?? 0),
      monthly: (prodMonthly.rows as Record<string, unknown>[]).map(r => ({
        month: String(r.month),
        revenue: toF(toNum(r.revenue)),
        productionKg: toF(toNum(r.production_kg)),
        soldKg: toF(toNum(r.sold_kg)),
        avgPrice: toF(toNum(r.avg_price)),
      })),
    },
    fiftyPct: {
      grossRevenue: toF(toNum(fs?.gross_revenue)),
      landownerNet: toF(toNum(fs?.landowner_net)),
      poolSplit: toF(toNum(fs?.pool_split)),
      opCost: toF(toNum(fs?.op_cost)),
      confirmedCount: Number(fs?.confirmed_count ?? 0),
      draftCount: Number(fs?.draft_count ?? 0),
      sessions: (fiftyMonthly.rows as Record<string, unknown>[]).map(r => ({
        period: String(r.period), year: Number(r.yr),
        grossRevenue: toF(toNum(r.gross_revenue)),
        landownerNet: toF(toNum(r.landowner_net)),
        poolSplit: toF(toNum(r.pool_split)),
        opCost: toF(toNum(r.op_cost)),
        status: String(r.status),
      })),
    },
    expenditure: {
      total: toF(toNum(es?.total)),
      verified: toF(toNum(es?.verified)),
      draft: toF(toNum(es?.draft)),
      count: Number(es?.cnt ?? 0),
      byCategory: (expByCat.rows as Record<string, unknown>[]).map(r => ({
        category: String(r.category).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        total: toF(toNum(r.total)), count: Number(r.cnt),
      })),
      monthly: (expMonthly.rows as Record<string, unknown>[]).map(r => ({
        month: String(r.month), expenditure: toF(toNum(r.expenditure)),
      })),
    },
    lca: {
      applicable: isOwnership,
      totalDue: toF(toNum(ls?.total_due)),
      totalPaid: toF(toNum(ls?.total_paid)),
      outstanding: toF(toNum(ls?.outstanding)),
      totalCarryForward: toF(toNum(ls?.total_carry_forward)),
      totalGrossDue: toF(toNum(ls?.total_gross_due)),
      pendingCount: Number(ls?.pending_count ?? 0),
      totalEntries: Number(ls?.total_count ?? 0),
    },
    landownerLedger: {
      revenueCredit: toF(toNum(ll?.revenue_credit)),
      burdenDebit: toF(toNum(ll?.burden_debit)),
      recoverableCredit: toF(toNum(ll?.recoverable_credit)),
      recoverableDebit: toF(toNum(ll?.recoverable_debit)),
      lcaCredit: toF(toNum(ll?.lca_credit)),
      netPosition: toF(toNum(ll?.revenue_credit) + toNum(ll?.recoverable_credit) - toNum(ll?.burden_debit) - toNum(ll?.recoverable_debit)),
      entryCount: Number(ll?.entry_count ?? 0),
    },
    monthlyTrend,
  });
});

// ── GET /financial-reports/lca?projectId= ────────────────────────────────

router.get("/lca", requireFinancialAccess, auditMiddleware("financial_reports", "lca"), async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!req.canAccessAllProjects) {
    const allowed = (req.userProjectIds ?? []);
    if (!allowed.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const [entries, payments] = await Promise.all([
    db.select().from(lcaLedgerTable)
      .where(and(eq(lcaLedgerTable.projectId, projectId), eq(lcaLedgerTable.isActive, true)))
      .orderBy(asc(lcaLedgerTable.year)),
    db.select().from(lcaPaymentEventsTable)
      .where(eq(lcaPaymentEventsTable.projectId, projectId))
      .orderBy(desc(lcaPaymentEventsTable.createdAt)),
  ]);

  // NPF Stage 2 — money aggregation via centralized decimal-safe utility.
  const totalDue = sumMoney(entries.map((e) => e.totalDue)).toNumber();
  const totalPaid = sumMoney(entries.map((e) => e.amountPaid)).toNumber();
  const outstanding = sumMoney(entries.map((e) => e.balance)).toNumber();
  const totalCarryForward = sumMoney(entries.map((e) => e.carryForward)).toNumber();
  const negativeEntries = entries.filter(e => e.balance > 0);

  return res.json({
    summary: {
      totalDue: toF(totalDue),
      totalPaid: toF(totalPaid),
      outstanding: toF(outstanding),
      totalCarryForward: toF(totalCarryForward),
      pendingCount: entries.filter(e => e.status === "pending" || e.status === "partial").length,
      paidCount: entries.filter(e => e.status === "paid").length,
      totalEntries: entries.length,
      hasNegativeBalance: negativeEntries.length > 0,
    },
    entries: entries.map(e => ({
      id: e.id,
      year: e.year,
      baseAmount: toF(e.baseAmount),
      escalationFactor: e.escalationFactor,
      grossDue: toF(e.grossDue),
      carryForward: toF(e.carryForward),
      totalDue: toF(e.totalDue),
      amountPaid: toF(e.amountPaid),
      balance: toF(e.balance),
      status: e.status,
      paidAt: e.paidAt,
      notes: e.notes,
      createdAt: e.createdAt,
    })),
    payments: payments.map(p => ({
      id: p.id,
      year: p.year,
      amountPaid: toF(p.amountPaid),
      paymentDate: p.paymentDate,
      paymentRef: p.paymentRef,
      recordedByName: p.recordedByName,
      notes: p.notes,
    })),
  });
});

// ── GET /financial-reports/burden?projectId=&year= ───────────────────────

router.get("/burden", requireFinancialAccess, auditMiddleware("financial_reports", "burden"), async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId, year } = req.query as { projectId?: string; year?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!req.canAccessAllProjects) {
    const allowed = (req.userProjectIds ?? []);
    if (!allowed.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const yearInt = year && year !== "all" ? parseInt(year, 10) : null;

  const [entries, summary, partnerSummary] = await Promise.all([
    db.execute(sql`
      SELECT
        l.id, l.entry_type, l.direction, l.period_label, l.period_start, l.period_end,
        l.description, l.amount, l.gross_revenue, l.ownership_pct, l.revenue_model_type,
        l.is_recoverable, l.recovered_amount, l.recovery_status, l.status, l.notes,
        l.created_at,
        p.name AS partner_name, p.role AS partner_role
      FROM landowner_ledger_entries l
      JOIN partners p ON p.id = l.partner_id
      WHERE l.project_id = ${projectId}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM l.period_start::date) = ${yearInt}` : sql``}
      ORDER BY l.period_start DESC, l.entry_type
    `),

    db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'revenue_entitlement' AND direction = 'credit' AND status = 'confirmed'), 0)::numeric AS total_revenue,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'operational_burden' AND direction = 'debit' AND status = 'confirmed'), 0)::numeric AS total_burden,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'recoverable_adjustment' AND direction = 'credit' AND status = 'confirmed'), 0)::numeric AS total_recoverable_credit,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'recoverable_adjustment' AND direction = 'debit' AND status = 'confirmed'), 0)::numeric AS total_recoverable_debit,
        COALESCE(SUM(amount) FILTER (WHERE is_recoverable = true AND direction = 'debit'), 0)::numeric AS total_recoverable_burden,
        COALESCE(SUM(recovered_amount) FILTER (WHERE is_recoverable = true), 0)::numeric AS total_recovered,
        COUNT(*) AS entry_count
      FROM landowner_ledger_entries
      WHERE project_id = ${projectId}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM period_start::date) = ${yearInt}` : sql``}
    `),

    db.execute(sql`
      SELECT
        p.id AS partner_id, p.name AS partner_name, p.role AS partner_role,
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'revenue_entitlement' AND l.direction = 'credit' AND l.status = 'confirmed'), 0)::numeric AS revenue_credit,
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'operational_burden' AND l.direction = 'debit' AND l.status = 'confirmed'), 0)::numeric AS burden_debit,
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'recoverable_adjustment' AND l.direction = 'credit' AND l.status = 'confirmed'), 0)::numeric AS recoverable_credit,
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'recoverable_adjustment' AND l.direction = 'debit' AND l.status = 'confirmed'), 0)::numeric AS recoverable_debit,
        COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'lca_credit' AND l.status = 'confirmed'), 0)::numeric AS lca_credit,
        COUNT(*) AS entry_count
      FROM landowner_ledger_entries l
      JOIN partners p ON p.id = l.partner_id
      WHERE l.project_id = ${projectId}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM l.period_start::date) = ${yearInt}` : sql``}
      GROUP BY p.id, p.name, p.role
      ORDER BY p.name
    `),
  ]);

  const s = summary.rows[0] as Record<string, unknown>;

  const byPartner = (partnerSummary.rows as Record<string, unknown>[]).map(r => {
    const rev = toNum(r.revenue_credit);
    const burden = toNum(r.burden_debit);
    const recCredit = toNum(r.recoverable_credit);
    const recDebit = toNum(r.recoverable_debit);
    const lca = toNum(r.lca_credit);
    const net = rev + recCredit - burden - recDebit - lca;
    return {
      partnerId: String(r.partner_id),
      partnerName: String(r.partner_name),
      partnerRole: String(r.partner_role),
      revenueCredit: toF(rev),
      burdenDebit: toF(burden),
      recoverableCredit: toF(recCredit),
      recoverableDebit: toF(recDebit),
      lcaCredit: toF(lca),
      netPosition: toF(net),
      isNegative: net < 0,
      entryCount: Number(r.entry_count),
    };
  });

  return res.json({
    summary: {
      totalRevenue: toF(toNum(s?.total_revenue)),
      totalBurden: toF(toNum(s?.total_burden)),
      totalRecoverableCredit: toF(toNum(s?.total_recoverable_credit)),
      totalRecoverableDebit: toF(toNum(s?.total_recoverable_debit)),
      totalRecoverableBurden: toF(toNum(s?.total_recoverable_burden)),
      totalRecovered: toF(toNum(s?.total_recovered)),
      netPosition: toF(toNum(s?.total_revenue) + toNum(s?.total_recoverable_credit) - toNum(s?.total_burden) - toNum(s?.total_recoverable_debit)),
      entryCount: Number(s?.entry_count ?? 0),
      negativePartners: byPartner.filter(p => p.isNegative).length,
    },
    byPartner,
    entries: (entries.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      entryType: String(r.entry_type),
      direction: String(r.direction),
      periodLabel: String(r.period_label),
      periodStart: String(r.period_start),
      periodEnd: String(r.period_end),
      description: String(r.description),
      amount: toF(toNum(r.amount)),
      grossRevenue: r.gross_revenue ? toF(toNum(r.gross_revenue)) : null,
      ownershipPct: r.ownership_pct ? toNum(r.ownership_pct) : null,
      revenueModelType: r.revenue_model_type ? String(r.revenue_model_type) : null,
      isRecoverable: Boolean(r.is_recoverable),
      recoveredAmount: toF(toNum(r.recovered_amount)),
      recoveryStatus: String(r.recovery_status),
      status: String(r.status),
      notes: r.notes ? String(r.notes) : null,
      partnerName: String(r.partner_name),
      partnerRole: String(r.partner_role),
    })),
  });
});

// ── GET /financial-reports/settlements?projectId=&year= ──────────────────

router.get("/settlements", requireFinancialAccess, auditMiddleware("financial_reports", "settlements"), async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId, year } = req.query as { projectId?: string; year?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!req.canAccessAllProjects) {
    const allowed = (req.userProjectIds ?? []);
    if (!allowed.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const yearInt = year && year !== "all" ? parseInt(year, 10) : null;

  const [distSummary, distRecords, settleSummary, settleRecords] = await Promise.all([
    db.execute(sql`
      SELECT
        COALESCE(SUM(total_paid), 0)::numeric AS total_paid,
        COALESCE(SUM(pending_payable), 0)::numeric AS total_pending,
        COALESCE(SUM(carry_forward_balance), 0)::numeric AS total_carry_forward,
        COALESCE(SUM(gross_revenue), 0)::numeric AS total_gross_revenue,
        COALESCE(SUM(settlement_recommendation), 0)::numeric AS total_recommended,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE status IN ('pending','partial')) AS pending_count,
        COUNT(*) FILTER (WHERE status = 'carried_forward') AS carried_count,
        COUNT(*) AS total_count
      FROM distribution_records
      WHERE project_id = ${projectId}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM period_start::date) = ${yearInt}` : sql``}
    `),

    db.execute(sql`
      SELECT
        dr.id, dr.accounting_period_label AS period, dr.period_start, dr.period_end,
        dr.settlement_type, dr.gross_revenue, dr.settlement_recommendation,
        dr.total_paid, dr.pending_payable, dr.carry_forward_balance, dr.status,
        p.name AS partner_name, p.role AS partner_role
      FROM distribution_records dr
      LEFT JOIN partners p ON p.id = dr.partner_id
      WHERE dr.project_id = ${projectId}::uuid AND dr.is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM dr.period_start::date) = ${yearInt}` : sql``}
      ORDER BY dr.period_start DESC NULLS LAST, dr.accounting_period_label DESC
      LIMIT 100
    `),

    db.execute(sql`
      SELECT
        COALESCE(SUM(recommended_amount), 0)::numeric AS total_recommended,
        COALESCE(SUM(actual_amount) FILTER (WHERE status = 'finalized'), 0)::numeric AS total_actual,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_count,
        COUNT(*) FILTER (WHERE status = 'disputed') AS disputed_count,
        COUNT(*) FILTER (WHERE is_overridden = true) AS overridden_count,
        COUNT(*) AS total_count
      FROM settlement_records
      WHERE project_id = ${projectId}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM period_start::date) = ${yearInt}` : sql``}
    `),

    db.execute(sql`
      SELECT
        sr.id, sr.settlement_type, sr.period_label, sr.period_start,
        sr.recommended_amount, sr.actual_amount, sr.status, sr.is_overridden,
        sr.override_remarks,
        p.name AS partner_name
      FROM settlement_records sr
      LEFT JOIN partners p ON p.id = sr.partner_id
      WHERE sr.project_id = ${projectId}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM sr.period_start::date) = ${yearInt}` : sql``}
      ORDER BY sr.period_start DESC NULLS LAST
      LIMIT 100
    `),
  ]);

  const ds = distSummary.rows[0] as Record<string, unknown>;
  const ss = settleSummary.rows[0] as Record<string, unknown>;

  return res.json({
    distribution: {
      summary: {
        totalPaid: toF(toNum(ds?.total_paid)),
        totalPending: toF(toNum(ds?.total_pending)),
        totalCarryForward: toF(toNum(ds?.total_carry_forward)),
        totalGrossRevenue: toF(toNum(ds?.total_gross_revenue)),
        totalRecommended: toF(toNum(ds?.total_recommended)),
        paidCount: Number(ds?.paid_count ?? 0),
        pendingCount: Number(ds?.pending_count ?? 0),
        carriedCount: Number(ds?.carried_count ?? 0),
        totalCount: Number(ds?.total_count ?? 0),
      },
      records: (distRecords.rows as Record<string, unknown>[]).map(r => ({
        id: String(r.id),
        period: String(r.period),
        periodStart: r.period_start ? String(r.period_start) : null,
        settlementType: r.settlement_type ? String(r.settlement_type) : null,
        grossRevenue: toF(toNum(r.gross_revenue)),
        recommendation: toF(toNum(r.settlement_recommendation)),
        totalPaid: toF(toNum(r.total_paid)),
        pendingPayable: toF(toNum(r.pending_payable)),
        carryForward: toF(toNum(r.carry_forward_balance)),
        status: String(r.status),
        partnerName: r.partner_name ? String(r.partner_name) : null,
        partnerRole: r.partner_role ? String(r.partner_role) : null,
      })),
    },
    settlements: {
      summary: {
        totalRecommended: toF(toNum(ss?.total_recommended)),
        totalActual: toF(toNum(ss?.total_actual)),
        finalizedCount: Number(ss?.finalized_count ?? 0),
        disputedCount: Number(ss?.disputed_count ?? 0),
        overriddenCount: Number(ss?.overridden_count ?? 0),
        totalCount: Number(ss?.total_count ?? 0),
      },
      records: (settleRecords.rows as Record<string, unknown>[]).map(r => ({
        id: String(r.id),
        settlementType: String(r.settlement_type),
        periodLabel: String(r.period_label),
        periodStart: r.period_start ? String(r.period_start) : null,
        recommendedAmount: r.recommended_amount ? toF(toNum(r.recommended_amount)) : null,
        actualAmount: r.actual_amount ? toF(toNum(r.actual_amount)) : null,
        status: String(r.status),
        isOverridden: Boolean(r.is_overridden),
        overrideRemarks: r.override_remarks ? String(r.override_remarks) : null,
        partnerName: r.partner_name ? String(r.partner_name) : null,
      })),
    },
  });
});

// ── GET /financial-reports/year-summary ──────────────────────────────────

router.get("/year-summary", requireFinancialAccess, auditMiddleware("financial_reports", "year_summary"), async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const allowed = req.canAccessAllProjects ? null : (req.userProjectIds ?? []);
  if (allowed !== null && allowed.length === 0) return res.json({ years: [], projects: [] });

  const { projectId } = req.query as { projectId?: string };

  const pidFilter = projectId
    ? sql`AND project_id = ${projectId}::uuid`
    : allowed !== null
    ? sql`AND project_id = ANY(ARRAY[${sql.join(allowed.map(id => sql`${id}::uuid`), sql`, `)}]::uuid[])`
    : sql``;

  const [yearlyRevenue, yearlyExpenditure, yearlyLca, yearlyDist, projects] = await Promise.all([
    db.execute(sql`
      SELECT
        EXTRACT(YEAR FROM recorded_at)::int AS yr,
        COALESCE(SUM(revenue), 0)::numeric AS revenue,
        COALESCE(SUM(production_kg), 0)::numeric AS production_kg,
        COALESCE(SUM(sold_kg), 0)::numeric AS sold_kg
      FROM production_records
      WHERE 1=1 ${pidFilter}
      GROUP BY EXTRACT(YEAR FROM recorded_at)
      ORDER BY yr
    `),
    db.execute(sql`
      SELECT
        EXTRACT(YEAR FROM created_at)::int AS yr,
        COALESCE(SUM(amount), 0)::numeric AS expenditure,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0)::numeric AS verified
      FROM expenditures
      WHERE is_active = true ${pidFilter}
      GROUP BY EXTRACT(YEAR FROM created_at)
      ORDER BY yr
    `),
    db.execute(sql`
      SELECT
        EXTRACT(YEAR FROM created_at)::int AS yr,
        COALESCE(SUM(total_due), 0)::numeric AS lca_due,
        COALESCE(SUM(amount_paid), 0)::numeric AS lca_paid,
        COALESCE(SUM(balance), 0)::numeric AS lca_outstanding,
        COALESCE(SUM(carry_forward), 0)::numeric AS carry_forward
      FROM lca_ledger
      WHERE is_active = true ${pidFilter}
      GROUP BY EXTRACT(YEAR FROM created_at)
      ORDER BY yr
    `),
    db.execute(sql`
      SELECT
        EXTRACT(YEAR FROM period_start::date)::int AS yr,
        COALESCE(SUM(total_paid), 0)::numeric AS dist_paid,
        COALESCE(SUM(pending_payable), 0)::numeric AS dist_pending,
        COALESCE(SUM(carry_forward_balance), 0)::numeric AS carry_forward
      FROM distribution_records
      WHERE is_active = true ${pidFilter}
        AND period_start IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM period_start::date)
      ORDER BY yr
    `),
    db.select({ id: projectsTable.id, name: projectsTable.name, commercialModel: projectsTable.commercialModel })
      .from(projectsTable)
      .where(
        allowed !== null
          ? and(eq(projectsTable.isActive, true), inArray(projectsTable.id, allowed))
          : eq(projectsTable.isActive, true),
      ),
  ]);

  // Merge all years
  const allYears = new Set<number>([
    ...((yearlyRevenue.rows as Record<string, unknown>[]).map(r => Number(r.yr))),
    ...((yearlyExpenditure.rows as Record<string, unknown>[]).map(r => Number(r.yr))),
    ...((yearlyLca.rows as Record<string, unknown>[]).map(r => Number(r.yr))),
  ].filter(y => y > 1990 && y < 2100));

  const revMap = new Map((yearlyRevenue.rows as Record<string, unknown>[]).map(r => [Number(r.yr), r]));
  const expMap = new Map((yearlyExpenditure.rows as Record<string, unknown>[]).map(r => [Number(r.yr), r]));
  const lcaMap = new Map((yearlyLca.rows as Record<string, unknown>[]).map(r => [Number(r.yr), r]));
  const distMap = new Map((yearlyDist.rows as Record<string, unknown>[]).map(r => [Number(r.yr), r]));

  const years = Array.from(allYears).sort((a, b) => a - b).map(yr => {
    const rev = toNum(revMap.get(yr)?.revenue);
    const exp = toNum(expMap.get(yr)?.expenditure);
    const lca = lcaMap.get(yr);
    const dist = distMap.get(yr);
    return {
      year: yr,
      revenue: toF(rev),
      expenditure: toF(exp),
      grossProfit: toF(rev - exp),
      profitMargin: rev > 0 ? parseFloat(((rev - exp) / rev * 100).toFixed(1)) : 0,
      productionKg: toF(toNum(revMap.get(yr)?.production_kg)),
      soldKg: toF(toNum(revMap.get(yr)?.sold_kg)),
      verifiedExpenditure: toF(toNum(expMap.get(yr)?.verified)),
      lcaDue: toF(toNum(lca?.lca_due)),
      lcaPaid: toF(toNum(lca?.lca_paid)),
      lcaOutstanding: toF(toNum(lca?.lca_outstanding)),
      carryForwardLca: toF(toNum(lca?.carry_forward)),
      distributionPaid: toF(toNum(dist?.dist_paid)),
      distributionPending: toF(toNum(dist?.dist_pending)),
      carryForwardDist: toF(toNum(dist?.carry_forward)),
    };
  });

  return res.json({
    years,
    totals: {
      revenue: toF(years.reduce((s, y) => s + toNum(y.revenue), 0)),
      expenditure: toF(years.reduce((s, y) => s + toNum(y.expenditure), 0)),
      grossProfit: toF(years.reduce((s, y) => s + toNum(y.grossProfit), 0)),
      lcaDue: toF(years.reduce((s, y) => s + toNum(y.lcaDue), 0)),
      lcaPaid: toF(years.reduce((s, y) => s + toNum(y.lcaPaid), 0)),
      distributionPaid: toF(years.reduce((s, y) => s + toNum(y.distributionPaid), 0)),
    },
    projects: projects.map(p => ({ id: p.id, name: p.name, model: p.commercialModel })),
  });
});

// ── GET /financial-reports/partner-report?projectId=&partnerId= ──────────

router.get("/partner-report", requireFinancialAccess, auditMiddleware("financial_reports", "partner_report"), async (req, res) => {
  if (!req.dbUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = { id: req.dbUserId, role: req.userRole ?? "employee", displayName: req.dbUser?.displayName ?? null };

  const { projectId, partnerId } = req.query as { projectId?: string; partnerId?: string };
  if (!projectId || !partnerId) return res.status(400).json({ error: "projectId and partnerId required" });
  if (!req.canAccessAllProjects) {
    const allowed = (req.userProjectIds ?? []);
    if (!allowed.includes(projectId)) return res.status(403).json({ error: "Forbidden" });
  }

  const [[partner], [project], ledgerSummary, contributions, distributions, lcaData] = await Promise.all([
    db.select({ id: partnersTable.id, name: partnersTable.name, role: partnersTable.role, email: partnersTable.email, phone: partnersTable.phone })
      .from(partnersTable).where(eq(partnersTable.id, partnerId)).limit(1),
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),

    db.execute(sql`
      SELECT
        entry_type, direction, status,
        COALESCE(SUM(amount) FILTER (WHERE status = 'confirmed'), 0)::numeric AS confirmed_total,
        COALESCE(SUM(amount), 0)::numeric AS total,
        COUNT(*) AS cnt,
        MAX(ownership_pct) AS latest_ownership_pct
      FROM landowner_ledger_entries
      WHERE project_id = ${projectId}::uuid AND partner_id = ${partnerId}::uuid
      GROUP BY entry_type, direction, status
      ORDER BY entry_type, direction
    `),

    db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified'), 0)::numeric AS verified,
        COALESCE(SUM(amount), 0)::numeric AS total,
        COUNT(*) AS cnt
      FROM contributions
      WHERE project_id = ${projectId}::uuid AND partner_id = ${partnerId}::uuid AND is_active = true
    `),

    db.execute(sql`
      SELECT
        COALESCE(SUM(total_paid), 0)::numeric AS paid,
        COALESCE(SUM(pending_payable), 0)::numeric AS pending,
        COALESCE(SUM(carry_forward_balance), 0)::numeric AS carry_forward,
        COALESCE(SUM(gross_revenue), 0)::numeric AS gross_revenue,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE status IN ('pending','partial')) AS pending_count,
        COUNT(*) FILTER (WHERE carry_forward_balance > 0) AS carry_forward_count
      FROM distribution_records
      WHERE project_id = ${projectId}::uuid AND partner_id = ${partnerId}::uuid AND is_active = true
    `),

    db.execute(sql`
      SELECT
        COALESCE(SUM(total_due), 0)::numeric AS total_due,
        COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
        COALESCE(SUM(balance), 0)::numeric AS outstanding,
        COALESCE(SUM(carry_forward), 0)::numeric AS carry_forward,
        COUNT(*) FILTER (WHERE status IN ('pending','partial')) AS pending_count
      FROM lca_ledger
      WHERE project_id = ${projectId}::uuid AND is_active = true
    `),
  ]);

  if (!partner || !project) return res.status(404).json({ error: "Partner or project not found" });

  // Aggregate ledger summary
  const ledger = { revenueCredit: 0, burdenDebit: 0, recoverableCredit: 0, recoverableDebit: 0, lcaCredit: 0, otherCredit: 0, otherDebit: 0, ownershipPct: 0 };
  for (const r of ledgerSummary.rows as Record<string, unknown>[]) {
    const amt = toNum(r.confirmed_total);
    if (r.latest_ownership_pct) ledger.ownershipPct = toNum(r.latest_ownership_pct);
    if (r.entry_type === "revenue_entitlement" && r.direction === "credit") ledger.revenueCredit += amt;
    if (r.entry_type === "operational_burden" && r.direction === "debit") ledger.burdenDebit += amt;
    if (r.entry_type === "recoverable_adjustment" && r.direction === "credit") ledger.recoverableCredit += amt;
    if (r.entry_type === "recoverable_adjustment" && r.direction === "debit") ledger.recoverableDebit += amt;
    if (r.entry_type === "lca_credit") ledger.lcaCredit += amt;
    if (r.entry_type === "other_credit") ledger.otherCredit += amt;
    if (r.entry_type === "other_debit") ledger.otherDebit += amt;
  }

  const netLedger = ledger.revenueCredit + ledger.recoverableCredit + ledger.otherCredit - ledger.burdenDebit - ledger.recoverableDebit - ledger.otherDebit;

  const cs = contributions.rows[0] as Record<string, unknown>;
  const ds = distributions.rows[0] as Record<string, unknown>;
  const ls = lcaData.rows[0] as Record<string, unknown>;

  return res.json({
    partner: { id: partner.id, name: partner.name, role: partner.role, email: partner.email, phone: partner.phone },
    project: { id: project.id, name: project.name, commercialModel: project.commercialModel, lifecycleStatus: project.lifecycleStatus },
    ledger: {
      ownershipPct: ledger.ownershipPct,
      revenueCredit: toF(ledger.revenueCredit),
      burdenDebit: toF(ledger.burdenDebit),
      recoverableCredit: toF(ledger.recoverableCredit),
      recoverableDebit: toF(ledger.recoverableDebit),
      lcaCredit: toF(ledger.lcaCredit),
      otherCredit: toF(ledger.otherCredit),
      otherDebit: toF(ledger.otherDebit),
      netPosition: toF(netLedger),
      isNegative: netLedger < 0,
    },
    contributions: {
      total: toF(toNum(cs?.total)),
      verified: toF(toNum(cs?.verified)),
      count: Number(cs?.cnt ?? 0),
    },
    distribution: {
      paid: toF(toNum(ds?.paid)),
      pending: toF(toNum(ds?.pending)),
      carryForward: toF(toNum(ds?.carry_forward)),
      grossRevenue: toF(toNum(ds?.gross_revenue)),
      paidCount: Number(ds?.paid_count ?? 0),
      pendingCount: Number(ds?.pending_count ?? 0),
      carryForwardCount: Number(ds?.carry_forward_count ?? 0),
    },
    lca: {
      totalDue: toF(toNum(ls?.total_due)),
      totalPaid: toF(toNum(ls?.total_paid)),
      outstanding: toF(toNum(ls?.outstanding)),
      carryForward: toF(toNum(ls?.carry_forward)),
      pendingCount: Number(ls?.pending_count ?? 0),
      applicable: project.commercialModel === "ownership_contribution",
    },
    summary: {
      totalReceivable: toF(ledger.revenueCredit + ledger.recoverableCredit + ledger.otherCredit + toNum(ds?.paid)),
      totalPayable: toF(ledger.burdenDebit + ledger.recoverableDebit + ledger.otherDebit + toNum(ls?.total_paid)),
      netPosition: toF(netLedger),
      isNegativeBalance: netLedger < 0,
    },
  });
});

export default router;

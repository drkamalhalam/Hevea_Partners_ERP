/**
 * analytics_hub.ts
 *
 * Advanced Analytics Search & Filtering Engine.
 * Aggregates data across all modules with rich filter dimensions.
 *
 *   GET  /analytics-hub/meta                 — projects, partners, filter options
 *   POST /analytics-hub/search               — main multi-dimensional search
 *   GET  /analytics-hub/saved-views          — list saved views for user
 *   POST /analytics-hub/saved-views          — create saved view
 *   PUT  /analytics-hub/saved-views/:id      — update saved view
 *   DELETE /analytics-hub/saved-views/:id    — delete saved view
 *   POST /analytics-hub/saved-views/:id/pin  — toggle pin
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  projectsTable,
  partnersTable,
  userProjectAssignmentsTable,
  analyticsSavedViewsTable,
} from "@workspace/db";
import { eq, and, inArray, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { getAnalyticsHubScope, logReportAccess } from "../middlewares/reportAccessControl";

const router = Router();
const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  return user ?? null;
}

const isPrivileged = (role: string) => role === "admin" || role === "developer";

async function getAssignedIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(and(eq(userProjectAssignmentsTable.userId, userId), isNull(userProjectAssignmentsTable.revokedAt)));
  return rows.map(r => r.projectId);
}

/** Builds a WHERE clause fragment for project_id filtering. */
function projectWhere(projectIds: string[]): string {
  if (projectIds.length === 0) return "1=0";
  return `project_id IN (${projectIds.map(id => `'${id}'`).join(",")})`;
}

/** ISO date bound fragments */
function dateBounds(field: string, dateStart?: string | null, dateEnd?: string | null): string {
  const parts: string[] = [];
  if (dateStart) parts.push(`${field} >= '${dateStart}'::date`);
  if (dateEnd) parts.push(`${field} <= '${dateEnd}'::date + INTERVAL '1 day'`);
  return parts.length ? parts.join(" AND ") : "TRUE";
}

// ── GET /analytics-hub/meta ───────────────────────────────────────────────────

router.get("/meta", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const allowedIds = isPrivileged(actor.role) ? null : await getAssignedIds(actor.id);

  const projects = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      projectCode: projectsTable.projectCode,
      commercialModel: projectsTable.commercialModel,
      lifecycleStatus: projectsTable.lifecycleStatus,
      activationStatus: projectsTable.activationStatus,
    })
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.isActive, true),
        allowedIds ? inArray(projectsTable.id, allowedIds) : undefined,
      )
    )
    .orderBy(projectsTable.name);

  // Partners linked to accessible projects
  const partnerResult = allowedIds
    ? await db.execute(sql.raw(`
        SELECT DISTINCT p.id, p.name
        FROM partners p
        JOIN project_participants pp ON pp.partner_id = p.id
        WHERE pp.project_id IN (${allowedIds.map(id => `'${id}'`).join(",")}) AND p.is_active = true
        ORDER BY p.name LIMIT 500
      `))
    : await db.execute(sql`
        SELECT DISTINCT p.id, p.name
        FROM partners p
        JOIN project_participants pp ON pp.partner_id = p.id
        WHERE p.is_active = true
        ORDER BY p.name LIMIT 500
      `);

  res.json({
    projects,
    partners: partnerResult.rows,
    filterOptions: {
      lifecyclePhases:    ["prematurity", "mature_production", "closed"],
      activationStatuses: ["draft", "pending_verification", "ready_for_activation", "active", "suspended", "closed"],
      commercialModels:   ["ownership_contribution", "fifty_percent_revenue"],
      expenditureCategories: ["labor", "fertilizer", "transport", "machinery", "maintenance", "consumables", "plantation_operations", "miscellaneous"],
      governanceStatuses: ["clean", "alerts_pending", "disputes_open", "critical"],
      role: actor.role,
    },
  });
});

// ── POST /analytics-hub/search ────────────────────────────────────────────────

const SearchSchema = z.object({
  projectIds:             z.array(z.string().uuid()).optional(),
  dateStart:              z.string().optional().nullable(),
  dateEnd:                z.string().optional().nullable(),
  lifecyclePhases:        z.array(z.string()).optional(),
  activationStatuses:     z.array(z.string()).optional(),
  commercialModels:       z.array(z.string()).optional(),
  partnerIds:             z.array(z.string().uuid()).optional(),
  expenditureCategories:  z.array(z.string()).optional(),
  governanceStatuses:     z.array(z.string()).optional(),
  searchText:             z.string().optional().nullable(),
});

router.post("/search", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const parsed = SearchSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid filters" });
  const filters = parsed.data;

  // ── Resolve accessible project IDs ────────────────────────────────────
  const baseAllowedIds = isPrivileged(actor.role) ? null : await getAssignedIds(actor.id);

  // Build working project set from DB matching all project-level filters
  let projectQuery = db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      projectCode: projectsTable.projectCode,
      commercialModel: projectsTable.commercialModel,
      lifecycleStatus: projectsTable.lifecycleStatus,
      activationStatus: projectsTable.activationStatus,
      startDate: projectsTable.startDate,
      district: projectsTable.district,
      state: projectsTable.state,
    })
    .from(projectsTable)
    .where(eq(projectsTable.isActive, true))
    .$dynamic();

  const projectConditions = [];
  if (baseAllowedIds) projectConditions.push(inArray(projectsTable.id, baseAllowedIds));
  if (filters.projectIds?.length) projectConditions.push(inArray(projectsTable.id, filters.projectIds));
  if (filters.lifecyclePhases?.length) {
    // @ts-expect-error dynamic enum values
    projectConditions.push(inArray(projectsTable.lifecycleStatus, filters.lifecyclePhases));
  }
  if (filters.activationStatuses?.length) {
    // @ts-expect-error dynamic enum values
    projectConditions.push(inArray(projectsTable.activationStatus, filters.activationStatuses));
  }
  if (filters.commercialModels?.length) {
    // @ts-expect-error dynamic enum values
    projectConditions.push(inArray(projectsTable.commercialModel, filters.commercialModels));
  }
  if (filters.searchText) {
    const term = `%${filters.searchText.toLowerCase()}%`;
    projectConditions.push(sql`LOWER(${projectsTable.name}) LIKE ${term}`);
  }
  if (projectConditions.length) {
    projectQuery = projectQuery.where(and(...projectConditions));
  }

  const matchedProjects = await projectQuery.orderBy(projectsTable.name);
  const matchedProjectIds = matchedProjects.map(p => p.id);

  if (matchedProjectIds.length === 0) {
    return void res.json({
      summary: {}, projects: [], financialTimeline: [], expenditureByCategory: [],
      partnerSummary: [], governanceSummary: {}, operationalSummary: {},
      matchedProjectCount: 0,
    });
  }

  const pWhere = projectWhere(matchedProjectIds);
  const dStart = filters.dateStart;
  const dEnd = filters.dateEnd;
  const catFilter = filters.expenditureCategories?.length
    ? `AND category IN (${filters.expenditureCategories.map(c => `'${c}'`).join(",")})` : "";
  const partnerFilter = filters.partnerIds?.length
    ? `AND partner_id IN (${filters.partnerIds.map(id => `'${id}'`).join(",")})` : "";
  const dateBound = (field: string) => dateBounds(field, dStart, dEnd);

  const [
    revenueSummary, expenditureSummary, distributionSummary,
    lcaSummary, contributionSummary, financialTimeline,
    expByCategory, partnerSummary, disputeSummary,
    alertSummary, overrideSummary, prodSummary,
    inventorySummary, projectBreakdown,
  ] = await Promise.all([

    // Revenue
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS transaction_count,
        COALESCE(SUM(net_amount), 0)::numeric AS total_net,
        COALESCE(SUM(gross_amount), 0)::numeric AS total_gross,
        COALESCE(SUM(net_weight_kg), 0)::numeric AS total_kg,
        COALESCE(AVG(rate_per_kg), 0)::numeric AS avg_rate
      FROM sales
      WHERE ${pWhere} AND is_active = true AND ${dateBound("sale_date")}
    `)),

    // Expenditures
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'approved'), 0)::numeric AS approved,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'draft'), 0)::numeric AS draft,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'pending_review'), 0)::numeric AS pending
      FROM expenditures
      WHERE ${pWhere} AND is_active = true AND ${dateBound("created_at")} ${catFilter}
    `)),

    // Distributions
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(net_payable) FILTER (WHERE status = 'settled'), 0)::numeric AS settled,
        COALESCE(SUM(net_payable), 0)::numeric AS total_payable
      FROM distribution_records
      WHERE ${pWhere} AND is_active = true ${partnerFilter}
    `)),

    // LCA
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(carry_forward_amount), 0)::numeric AS total_carry_forward,
        COUNT(*) FILTER (WHERE is_settled = true)::int AS settled_count
      FROM lca_ledger
      WHERE ${pWhere}
    `)),

    // Contributions
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'verified'), 0)::numeric AS verified,
        COALESCE(SUM(amount), 0)::numeric AS total
      FROM contributions
      WHERE ${pWhere} AND is_active = true ${partnerFilter}
    `)),

    // Financial timeline (monthly revenue + expenditure)
    db.execute(sql.raw(`
      SELECT month, SUM(revenue)::numeric AS revenue, SUM(expenditure)::numeric AS expenditure
      FROM (
        SELECT DATE_TRUNC('month', sale_date)::date AS month,
               SUM(net_amount)::numeric AS revenue, 0 AS expenditure
        FROM sales WHERE ${pWhere} AND is_active = true AND sale_date IS NOT NULL
          AND ${dateBound("sale_date")}
        GROUP BY 1
        UNION ALL
        SELECT DATE_TRUNC('month', created_at)::date AS month,
               0 AS revenue, SUM(amount)::numeric AS expenditure
        FROM expenditures WHERE ${pWhere} AND is_active = true AND verification_status = 'approved'
          AND ${dateBound("created_at")} ${catFilter}
        GROUP BY 1
      ) t
      GROUP BY month ORDER BY month LIMIT 36
    `)),

    // Expenditure by category
    db.execute(sql.raw(`
      SELECT category, COUNT(*)::int AS count, SUM(amount)::numeric AS total
      FROM expenditures
      WHERE ${pWhere} AND is_active = true AND verification_status = 'approved'
        AND ${dateBound("created_at")} ${catFilter}
      GROUP BY category ORDER BY total DESC
    `)),

    // Partner summary
    db.execute(sql.raw(`
      SELECT p.name AS partner_name,
        COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'verified'), 0)::numeric AS contributions,
        COALESCE(SUM(dr.net_payable) FILTER (WHERE dr.status = 'settled'), 0)::numeric AS distributions
      FROM partners p
      LEFT JOIN contributions c ON c.partner_id = p.id AND ${pWhere.replace("project_id", "c.project_id")}
      LEFT JOIN distribution_records dr ON dr.partner_id = p.id AND ${pWhere.replace("project_id", "dr.project_id")}
      ${filters.partnerIds?.length ? `WHERE p.id IN (${filters.partnerIds.map(id => `'${id}'`).join(",")})` : "WHERE p.is_active = true"}
      GROUP BY p.id, p.name
      HAVING COALESCE(SUM(c.amount), 0) > 0 OR COALESCE(SUM(dr.net_payable), 0) > 0
      ORDER BY contributions DESC
      LIMIT 20
    `)),

    // Disputes
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('open','escalated'))::int AS open,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'open')::int AS critical,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
      FROM disputes
      WHERE ${pWhere} AND is_active = true
    `)),

    // Operational alerts
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'open')::int AS critical,
        COUNT(*) FILTER (WHERE severity = 'high' AND status = 'open')::int AS high,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open
      FROM operational_alerts
      WHERE ${pWhere} AND is_active = true
    `)).catch(() => ({ rows: [{ total: 0, critical: 0, high: 0, open: 0 }] })),

    // Governance overrides
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS total FROM governance_overrides WHERE ${pWhere}
    `)).catch(() => ({ rows: [{ total: 0 }] })),

    // Production summary
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS batch_count,
        COALESCE(SUM(quantity_produced), 0)::numeric AS total_produced
      FROM production_log
      WHERE ${pWhere} AND ${dateBound("production_date")}
    `)).catch(() => ({ rows: [{ batch_count: 0, total_produced: 0 }] })),

    // Inventory balances
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS stock_types,
        COALESCE(SUM(balance_quantity), 0)::numeric AS total_qty,
        COALESCE(SUM(balance_value), 0)::numeric AS total_value
      FROM inventory
      WHERE ${pWhere}
    `)).catch(() => ({ rows: [{ stock_types: 0, total_qty: 0, total_value: 0 }] })),

    // Per-project breakdown
    db.execute(sql.raw(`
      SELECT
        p.id, p.name, p.project_code, p.commercial_model, p.lifecycle_status, p.activation_status,
        COALESCE(rev.total, 0)::numeric AS revenue,
        COALESCE(exp.total, 0)::numeric AS expenditure,
        COALESCE(dist.total, 0)::numeric AS distributed,
        COALESCE(disp.open_count, 0)::int AS open_disputes,
        COALESCE(part.count, 0)::int AS partner_count
      FROM projects p
      LEFT JOIN (
        SELECT project_id, SUM(net_amount) AS total FROM sales WHERE is_active = true AND ${dateBound("sale_date")} GROUP BY project_id
      ) rev ON rev.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(amount) AS total FROM expenditures WHERE is_active = true AND verification_status = 'approved' AND ${dateBound("created_at")} GROUP BY project_id
      ) exp ON exp.project_id = p.id
      LEFT JOIN (
        SELECT project_id, SUM(net_payable) AS total FROM distribution_records WHERE is_active = true GROUP BY project_id
      ) dist ON dist.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS open_count FROM disputes WHERE is_active = true AND status IN ('open','escalated') GROUP BY project_id
      ) disp ON disp.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(DISTINCT partner_id) AS count FROM project_participants GROUP BY project_id
      ) part ON part.project_id = p.id
      WHERE p.id IN (${matchedProjectIds.map(id => `'${id}'`).join(",")})
      ORDER BY revenue DESC NULLS LAST
    `)),
  ]);

  const rev = (revenueSummary.rows[0] ?? {}) as Record<string, unknown>;
  const exp = (expenditureSummary.rows[0] ?? {}) as Record<string, unknown>;
  const dist = (distributionSummary.rows[0] ?? {}) as Record<string, unknown>;
  const lca = (lcaSummary.rows[0] ?? {}) as Record<string, unknown>;
  const contrib = (contributionSummary.rows[0] ?? {}) as Record<string, unknown>;
  const disp = (disputeSummary.rows[0] ?? {}) as Record<string, unknown>;
  const alerts = (alertSummary.rows[0] ?? {}) as Record<string, unknown>;
  const overrides = (overrideSummary.rows[0] ?? {}) as Record<string, unknown>;
  const prod = (prodSummary.rows[0] ?? {}) as Record<string, unknown>;
  const inv = (inventorySummary.rows[0] ?? {}) as Record<string, unknown>;

  const totalRevenue = toNum(rev.total_net);
  const totalExpenditure = toNum(exp.approved);
  const operatingProfit = totalRevenue - totalExpenditure;

  // ── Role-based data scope enforcement ─────────────────────────────────────
  // Employees and operational_staff see only operational metrics — no financial,
  // ownership, partner, or governance data.  Landowners/investors see financial
  // and ownership data but not privileged governance overrides detail.
  const scope = getAnalyticsHubScope(actor.role);
  logReportAccess(req, "analytics_hub", "search");

  const emptyGov = {
    disputes: { total: 0, open: 0, critical: 0, resolved: 0 },
    alerts:   { total: 0, open: 0, critical: 0, high: 0 },
    overrides: 0,
  };

  res.json({
    matchedProjectCount: matchedProjectIds.length,
    projects: matchedProjects,
    summary: {
      totalRevenue:        scope.canViewFinancial ? totalRevenue : 0,
      totalExpenditure:    scope.canViewFinancial ? totalExpenditure : 0,
      operatingProfit:     scope.canViewFinancial ? operatingProfit : 0,
      profitMargin:        scope.canViewFinancial && totalRevenue > 0 ? ((operatingProfit / totalRevenue) * 100) : 0,
      totalSalesKg:        scope.canViewFinancial ? toNum(rev.total_kg) : 0,
      avgRatePerKg:        scope.canViewFinancial ? toNum(rev.avg_rate) : 0,
      salesTransactions:   scope.canViewFinancial ? Number(rev.transaction_count ?? 0) : 0,
      totalDistributed:    scope.canViewFinancial ? toNum(dist.settled) : 0,
      totalContributions:  scope.canViewFinancial ? toNum(contrib.verified) : 0,
      lcaCarryForward:     scope.canViewFinancial ? toNum(lca.total_carry_forward) : 0,
      openDisputes:        scope.canViewGovernance ? Number(disp.open ?? 0) : 0,
      criticalAlerts:      scope.canViewGovernance ? Number(alerts.critical ?? 0) : 0,
      governanceOverrides: scope.canViewGovernance ? Number(overrides.total ?? 0) : 0,
      productionBatches:   scope.canViewOperational ? Number(prod.batch_count ?? 0) : 0,
      totalProducedKg:     scope.canViewOperational ? toNum(prod.total_produced) : 0,
      inventoryValue:      scope.canViewOperational ? toNum(inv.total_value) : 0,
    },
    financialTimeline: scope.canViewFinancial
      ? (financialTimeline.rows as Record<string, unknown>[]).map(r => ({
          month: String(r.month ?? "").substring(0, 7),
          revenue: toNum(r.revenue),
          expenditure: toNum(r.expenditure),
          profit: toNum(r.revenue) - toNum(r.expenditure),
        }))
      : [],
    expenditureByCategory: scope.canViewFinancial
      ? (expByCategory.rows as Record<string, unknown>[]).map(r => ({
          category: String(r.category ?? ""),
          count: Number(r.count ?? 0),
          total: toNum(r.total),
        }))
      : [],
    partnerSummary: scope.canViewPartners
      ? (partnerSummary.rows as Record<string, unknown>[]).map(r => ({
          name: String(r.partner_name ?? ""),
          contributions: toNum(r.contributions),
          distributions: toNum(r.distributions),
        }))
      : [],
    governanceSummary: scope.canViewGovernance
      ? {
          disputes: { total: Number(disp.total ?? 0), open: Number(disp.open ?? 0), critical: Number(disp.critical ?? 0), resolved: Number(disp.resolved ?? 0) },
          alerts:   { total: Number(alerts.total ?? 0), open: Number(alerts.open ?? 0), critical: Number(alerts.critical ?? 0), high: Number(alerts.high ?? 0) },
          overrides: Number(overrides.total ?? 0),
        }
      : emptyGov,
    operationalSummary: {
      productionBatches:    Number(prod.batch_count ?? 0),
      totalProducedKg:      toNum(prod.total_produced),
      inventoryStockTypes:  Number(inv.stock_types ?? 0),
      inventoryTotalQty:    toNum(inv.total_qty),
      inventoryValue:       toNum(inv.total_value),
    },
    projectBreakdown: (projectBreakdown.rows as Record<string, unknown>[]).map(r => ({
      id:              String(r.id ?? ""),
      name:            String(r.name ?? ""),
      projectCode:     r.project_code ? String(r.project_code) : null,
      commercialModel: String(r.commercial_model ?? ""),
      lifecycleStatus: String(r.lifecycle_status ?? ""),
      activationStatus: String(r.activation_status ?? ""),
      revenue:      scope.canViewFinancial  ? toNum(r.revenue)               : 0,
      expenditure:  scope.canViewFinancial  ? toNum(r.expenditure)           : 0,
      distributed:  scope.canViewFinancial  ? toNum(r.distributed)           : 0,
      openDisputes: scope.canViewGovernance ? Number(r.open_disputes ?? 0)   : 0,
      partnerCount: Number(r.partner_count ?? 0),
    })),
  });
});

// ── Saved Views CRUD ──────────────────────────────────────────────────────────

const SavedViewSchema = z.object({
  name:         z.string().min(1).max(100),
  description:  z.string().optional().nullable(),
  icon:         z.string().optional().nullable(),
  color:        z.string().optional().nullable(),
  filters:      z.record(z.unknown()).default({}),
  widgetConfig: z.array(z.unknown()).default([]),
  activeTab:    z.string().optional().nullable(),
  isPublic:     z.boolean().optional(),
});

router.get("/saved-views", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const views = await db
    .select()
    .from(analyticsSavedViewsTable)
    .where(
      and(
        eq(analyticsSavedViewsTable.isActive, true),
        eq(analyticsSavedViewsTable.userId, actor.id),
      )
    )
    .orderBy(desc(analyticsSavedViewsTable.isPinned), desc(analyticsSavedViewsTable.lastAccessedAt));

  // Also load public views from others
  const publicViews = await db
    .select()
    .from(analyticsSavedViewsTable)
    .where(
      and(
        eq(analyticsSavedViewsTable.isActive, true),
        eq(analyticsSavedViewsTable.isPublic, true),
      )
    )
    .orderBy(desc(analyticsSavedViewsTable.accessCount))
    .limit(20);

  res.json({ views, publicViews: publicViews.filter(v => v.userId !== actor.id) });
});

router.post("/saved-views", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const parsed = SavedViewSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid view", details: parsed.error.flatten() });

  const [view] = await db
    .insert(analyticsSavedViewsTable)
    .values({
      userId:       actor.id,
      userName:     actor.displayName ?? actor.email ?? "Unknown",
      userRole:     actor.role,
      ...parsed.data,
      filters:      parsed.data.filters as Record<string, unknown>,
      widgetConfig: parsed.data.widgetConfig as unknown[],
    })
    .returning();

  res.status(201).json({ view });
});

router.put("/saved-views/:id", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const viewId = String(req.params.id);
  const [existing] = await db
    .select()
    .from(analyticsSavedViewsTable)
    .where(and(eq(analyticsSavedViewsTable.id, viewId), eq(analyticsSavedViewsTable.isActive, true)))
    .limit(1);

  if (!existing) return void res.status(404).json({ error: "View not found" });
  if (existing.userId !== actor.id && !isPrivileged(actor.role)) return void res.status(403).json({ error: "Forbidden" });

  const parsed = SavedViewSchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid", details: parsed.error.flatten() });

  const [updated] = await db
    .update(analyticsSavedViewsTable)
    .set({ ...parsed.data, filters: parsed.data.filters as Record<string, unknown> | undefined, widgetConfig: parsed.data.widgetConfig as unknown[] | undefined, updatedAt: new Date() })
    .where(eq(analyticsSavedViewsTable.id, viewId))
    .returning();

  res.json({ view: updated });
});

router.delete("/saved-views/:id", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const deleteId = String(req.params.id);
  const [existing] = await db
    .select()
    .from(analyticsSavedViewsTable)
    .where(and(eq(analyticsSavedViewsTable.id, deleteId), eq(analyticsSavedViewsTable.isActive, true)))
    .limit(1);

  if (!existing) return void res.status(404).json({ error: "View not found" });
  if (existing.userId !== actor.id && !isPrivileged(actor.role)) return void res.status(403).json({ error: "Forbidden" });

  await db.update(analyticsSavedViewsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(analyticsSavedViewsTable.id, deleteId));

  res.json({ success: true });
});

router.post("/saved-views/:id/pin", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const pinId = String(req.params.id);
  const [existing] = await db
    .select()
    .from(analyticsSavedViewsTable)
    .where(and(eq(analyticsSavedViewsTable.id, pinId), eq(analyticsSavedViewsTable.isActive, true)))
    .limit(1);

  if (!existing) return void res.status(404).json({ error: "View not found" });
  if (existing.userId !== actor.id) return void res.status(403).json({ error: "Forbidden" });

  const [updated] = await db
    .update(analyticsSavedViewsTable)
    .set({ isPinned: !existing.isPinned, updatedAt: new Date() })
    .where(eq(analyticsSavedViewsTable.id, pinId))
    .returning();

  res.json({ view: updated });
});

export { router as analyticsHubRouter };

/**
 * reports.ts — Cross-project reporting aggregation
 *
 * GET /reports/summary           — top-level KPI overview across all projects
 * GET /reports/partner-statement — per-partner financial summary
 * GET /reports/production        — production & sales summary
 * GET /reports/governance-health — governance completeness across projects
 * GET /reports/project-financials — per-project P&L style breakdown
 */

import { Router } from "express";
import { and, desc, eq, sql, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  projectsTable,
  partnersTable,
  agreementsTable,
  contributionsTable,
  salesTransactionsTable,
  productionRecordsTable,
  usersTable,
  partnerClaimantsTable,
  projectNomineesTable,
  userProjectAssignmentsTable,
  activityTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";

const router = Router();

async function resolveUser(clerkId: string) {
  const [u] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkId))
    .limit(1);
  return u ?? null;
}

async function visibleProjectIds(userId: string, role: string): Promise<string[] | null> {
  if (role === "admin" || role === "developer") return null; // all projects
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map((r) => r.projectId);
}

// GET /reports/summary
router.get("/summary", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "Forbidden" }); return; }

    const visibleIds = await visibleProjectIds(me.id, me.role);

    // Projects
    const projects = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        status: projectsTable.status,
        lifecycleStatus: projectsTable.lifecycleStatus,
        location: projectsTable.location,
      })
      .from(projectsTable)
      .where(visibleIds ? inArray(projectsTable.id, visibleIds) : undefined);

    // Partners
    const partnerCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(partnersTable);

    // Agreements
    const agreementStats = await db
      .select({
        status: agreementsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(agreementsTable)
      .groupBy(agreementsTable.status);

    // Contributions total
    const contribTotal = await db
      .select({ total: sql<string>`coalesce(sum(amount), 0)::text` })
      .from(contributionsTable)
      .where(
        visibleIds
          ? inArray(contributionsTable.projectId, visibleIds)
          : undefined,
      );

    // Production — latest year summary
    const productionStats = await db
      .select({
        totalKg: sql<string>`coalesce(sum(quantity_kg), 0)::text`,
        totalRevenue: sql<string>`coalesce(sum(revenue), 0)::text`,
        recordCount: sql<number>`count(*)::int`,
      })
      .from(productionRecordsTable)
      .where(
        visibleIds
          ? inArray(productionRecordsTable.projectId, visibleIds)
          : undefined,
      );

    // Sales
    const salesStats = await db
      .select({
        totalValue: sql<string>`coalesce(sum(total_amount), 0)::text`,
        transactionCount: sql<number>`count(*)::int`,
      })
      .from(salesTransactionsTable)
      .where(
        visibleIds
          ? inArray(salesTransactionsTable.projectId, visibleIds)
          : undefined,
      );

    const lifecycle = {
      prematurity: projects.filter((p) => p.lifecycleStatus === "prematurity").length,
      mature_production: projects.filter((p) => p.lifecycleStatus === "mature_production").length,
      closed: projects.filter((p) => p.lifecycleStatus === "closed").length,
    };

    const agreementByStatus: Record<string, number> = {};
    for (const r of agreementStats) {
      agreementByStatus[r.status] = r.count;
    }

    res.json({
      generatedAt: new Date().toISOString(),
      projects: {
        total: projects.length,
        tapping: projects.filter((p) => p.status === "tapping").length,
        lifecycle,
        list: projects,
      },
      partners: { total: partnerCount[0]?.count ?? 0 },
      agreements: {
        byStatus: agreementByStatus,
        total: agreementStats.reduce((s, r) => s + r.count, 0),
        active: agreementByStatus["active"] ?? 0,
      },
      contributions: {
        totalAmount: contribTotal[0]?.total ?? "0",
      },
      production: {
        totalKg: productionStats[0]?.totalKg ?? "0",
        totalRevenue: productionStats[0]?.totalRevenue ?? "0",
        recordCount: productionStats[0]?.recordCount ?? 0,
      },
      sales: {
        totalValue: salesStats[0]?.totalValue ?? "0",
        transactionCount: salesStats[0]?.transactionCount ?? 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate summary report");
    res.status(500).json({ error: "Failed to generate summary report" });
  }
});

// GET /reports/partner-statement?partnerId=
router.get("/partner-statement", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "Forbidden" }); return; }

    const { partnerId } = req.query as Record<string, string>;

    // Fetch all or single partner
    const partnerFilter = partnerId
      ? [eq(partnersTable.id, partnerId)]
      : [];

    const partners = await db
      .select()
      .from(partnersTable)
      .where(partnerFilter.length ? and(...partnerFilter) : undefined)
      .limit(50);

    const partnerIds = partners.map((p) => p.id);
    if (partnerIds.length === 0) {
      res.json({ statements: [], generatedAt: new Date().toISOString() });
      return;
    }

    // Agreements per partner (as landowner)
    const agreements = await db
      .select({
        id: agreementsTable.id,
        landOwnerId: agreementsTable.landOwnerId,
        projectId: agreementsTable.projectId,
        status: agreementsTable.status,
        ownershipShareLandowner: agreementsTable.ownershipShareLandowner,
        landArea: agreementsTable.landArea,
      })
      .from(agreementsTable)
      .where(inArray(agreementsTable.landOwnerId, partnerIds));

    // Contributions per partner
    const contributions = await db
      .select({
        partnerId: contributionsTable.partnerId,
        projectId: contributionsTable.projectId,
        contributionType: contributionsTable.contributionType,
        verificationStatus: contributionsTable.verificationStatus,
        totalAmount: sql<string>`coalesce(sum(amount), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(contributionsTable)
      .where(inArray(contributionsTable.partnerId, partnerIds))
      .groupBy(
        contributionsTable.partnerId,
        contributionsTable.projectId,
        contributionsTable.contributionType,
        contributionsTable.verificationStatus,
      );

    // Claimants per partner
    const claimants = await db
      .select({
        partnerId: partnerClaimantsTable.partnerId,
        count: sql<number>`count(*)::int`,
      })
      .from(partnerClaimantsTable)
      .where(
        and(
          inArray(partnerClaimantsTable.partnerId, partnerIds),
          eq(partnerClaimantsTable.isActive, true),
        ),
      )
      .groupBy(partnerClaimantsTable.partnerId);

    const claimantMap = new Map(claimants.map((c) => [c.partnerId, c.count]));

    const statements = partners.map((partner) => {
      const partnerAgreements = agreements.filter((a) => a.landOwnerId === partner.id);
      const partnerContribs = contributions.filter((c) => c.partnerId === partner.id);

      const totalContributed = partnerContribs.reduce(
        (s, c) => s + parseFloat(c.totalAmount ?? "0"),
        0,
      );
      const verifiedContribs = partnerContribs.filter((c) => c.verificationStatus === "verified");
      const confirmedTotal = verifiedContribs.reduce(
        (s, c) => s + parseFloat(c.totalAmount ?? "0"),
        0,
      );

      return {
        partner: {
          id: partner.id,
          name: partner.name,
          phone: partner.phone,
          address: partner.address,
        },
        agreements: {
          total: partnerAgreements.length,
          active: partnerAgreements.filter((a) => a.status === "active").length,
          totalLandArea: partnerAgreements.reduce(
            (s, a) => s + (a.landArea ?? 0),
            0,
          ),
          items: partnerAgreements,
        },
        contributions: {
          totalAmount: totalContributed,
          verifiedAmount: confirmedTotal,
          pendingAmount: totalContributed - confirmedTotal,
          byType: partnerContribs.reduce(
            (acc, c) => {
              acc[c.contributionType] = (acc[c.contributionType] ?? 0) + parseFloat(c.totalAmount ?? "0");
              return acc;
            },
            {} as Record<string, number>,
          ),
        },
        claimants: claimantMap.get(partner.id) ?? 0,
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      partnerId: partnerId ?? null,
      statements,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate partner statement");
    res.status(500).json({ error: "Failed to generate partner statement" });
  }
});

// GET /reports/production?projectId=&year=
router.get("/production", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "Forbidden" }); return; }

    const { projectId, year } = req.query as Record<string, string>;
    const visibleIds = await visibleProjectIds(me.id, me.role);

    const conds: any[] = [];
    if (projectId) conds.push(eq(productionRecordsTable.projectId, projectId));
    if (visibleIds) conds.push(inArray(productionRecordsTable.projectId, visibleIds));

    const productionRows = await db
      .select({
        projectId: productionRecordsTable.projectId,
        month: sql<string>`to_char(record_date, 'YYYY-MM')`,
        totalKg: sql<string>`sum(quantity_kg)::text`,
        revenue: sql<string>`coalesce(sum(revenue), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(productionRecordsTable)
      .where(conds.length ? and(...conds) : undefined)
      .groupBy(productionRecordsTable.projectId, sql`to_char(record_date, 'YYYY-MM')`)
      .orderBy(sql`to_char(record_date, 'YYYY-MM')`);

    // Sales aggregation
    const salesConds: any[] = [];
    if (projectId) salesConds.push(eq(salesTransactionsTable.projectId, projectId));
    if (visibleIds) salesConds.push(inArray(salesTransactionsTable.projectId, visibleIds));

    const salesRows = await db
      .select({
        projectId: salesTransactionsTable.projectId,
        month: sql<string>`to_char(sale_date, 'YYYY-MM')`,
        totalSales: sql<string>`sum(total_amount)::text`,
        totalQuantityKg: sql<string>`coalesce(sum(quantity_kg), 0)::text`,
        transactionCount: sql<number>`count(*)::int`,
      })
      .from(salesTransactionsTable)
      .where(salesConds.length ? and(...salesConds) : undefined)
      .groupBy(salesTransactionsTable.projectId, sql`to_char(sale_date, 'YYYY-MM')`)
      .orderBy(sql`to_char(sale_date, 'YYYY-MM')`);

    // Overall totals
    const prodTotals = await db
      .select({
        totalKg: sql<string>`coalesce(sum(quantity_kg), 0)::text`,
        totalRevenue: sql<string>`coalesce(sum(revenue), 0)::text`,
        recordCount: sql<number>`count(*)::int`,
      })
      .from(productionRecordsTable)
      .where(conds.length ? and(...conds) : undefined);

    const salesTotals = await db
      .select({
        totalSales: sql<string>`coalesce(sum(total_amount), 0)::text`,
        transactionCount: sql<number>`count(*)::int`,
      })
      .from(salesTransactionsTable)
      .where(salesConds.length ? and(...salesConds) : undefined);

    res.json({
      generatedAt: new Date().toISOString(),
      projectId: projectId ?? null,
      production: {
        totals: prodTotals[0] ?? { totalKg: "0", totalRevenue: "0", recordCount: 0 },
        byMonth: productionRows,
      },
      sales: {
        totals: salesTotals[0] ?? { totalSales: "0", transactionCount: 0 },
        byMonth: salesRows,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate production report");
    res.status(500).json({ error: "Failed to generate production report" });
  }
});

// GET /reports/governance-health
router.get("/governance-health", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "Forbidden" }); return; }

    const visibleIds = await visibleProjectIds(me.id, me.role);

    const projects = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        lifecycleStatus: projectsTable.lifecycleStatus,
        status: projectsTable.status,
      })
      .from(projectsTable)
      .where(visibleIds ? inArray(projectsTable.id, visibleIds) : undefined);

    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) {
      res.json({ projects: [], generatedAt: new Date().toISOString() });
      return;
    }

    // Nominees per project
    const nominees = await db
      .select({
        projectId: projectNomineesTable.projectId,
        count: sql<number>`count(*)::int`,
      })
      .from(projectNomineesTable)
      .where(and(
        inArray(projectNomineesTable.projectId, projectIds),
        eq(projectNomineesTable.isActive, true),
      ))
      .groupBy(projectNomineesTable.projectId);

    // Agreements per project
    const agreementsByProject = await db
      .select({
        projectId: agreementsTable.projectId,
        status: agreementsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(agreementsTable)
      .where(inArray(agreementsTable.projectId, projectIds))
      .groupBy(agreementsTable.projectId, agreementsTable.status);

    const nomineeMap = new Map(nominees.map((n) => [n.projectId, n.count]));
    const agreementsMap = new Map<string, Record<string, number>>();
    for (const a of agreementsByProject) {
      if (!agreementsMap.has(a.projectId)) agreementsMap.set(a.projectId, {});
      agreementsMap.get(a.projectId)![a.status] = a.count;
    }

    const projectHealth = projects.map((p) => {
      const hasNominee = (nomineeMap.get(p.id) ?? 0) > 0;
      const agrMap = agreementsMap.get(p.id) ?? {};
      const totalAgreements = Object.values(agrMap).reduce((s, v) => s + v, 0);
      const activeAgreements = agrMap["active"] ?? 0;

      const issues: string[] = [];
      if (!hasNominee && p.lifecycleStatus === "prematurity") issues.push("No nominee registered");
      if (totalAgreements === 0) issues.push("No agreements");
      if (totalAgreements > 0 && activeAgreements === 0) issues.push("No active agreements");

      const score = Math.max(0, 100 - issues.length * 25);

      return {
        projectId: p.id,
        projectName: p.name,
        lifecycleStatus: p.lifecycleStatus,
        hasNominee,
        totalAgreements,
        activeAgreements,
        issues,
        score,
        status: issues.length === 0 ? "complete" : issues.some((i) => i.includes("nominee")) ? "attention_required" : "incomplete",
      };
    });

    const overallScore = projectHealth.length
      ? Math.round(projectHealth.reduce((s, p) => s + p.score, 0) / projectHealth.length)
      : 100;

    res.json({
      generatedAt: new Date().toISOString(),
      overallScore,
      totalProjects: projects.length,
      completeCount: projectHealth.filter((p) => p.status === "complete").length,
      attentionCount: projectHealth.filter((p) => p.status === "attention_required").length,
      incompleteCount: projectHealth.filter((p) => p.status === "incomplete").length,
      projects: projectHealth,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate governance health report");
    res.status(500).json({ error: "Failed to generate governance health report" });
  }
});

// GET /reports/activity?limit=&projectId=
router.get("/activity", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "Forbidden" }); return; }

    const { projectId, limit: limitStr } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(limitStr ?? "50", 10), 200);

    const conds: any[] = [];
    if (projectId) conds.push(eq(activityTable.projectId, projectId));

    const rows = await db
      .select()
      .from(activityTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(activityTable.createdAt))
      .limit(limit);

    res.json({
      generatedAt: new Date().toISOString(),
      activities: rows.map((r) => ({
        id: r.id,
        type: r.type,
        description: r.description,
        entityId: r.entityId,
        entityType: r.entityType,
        userId: r.userId,
        projectId: r.projectId,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
      total: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to generate activity report");
    res.status(500).json({ error: "Failed to generate activity report" });
  }
});

export default router;

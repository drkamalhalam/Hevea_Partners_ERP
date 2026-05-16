/**
 * enterprise_intelligence.ts
 *
 * Enterprise Governance Intelligence Layer — admin/developer only.
 * Mounted at /api/enterprise-intelligence.
 *
 * Transforms raw ERP data into strategic intelligence:
 *
 *   GET  /summary        — portfolio-wide KPIs and financial aggregates
 *   GET  /risk-flags     — severity-bucketed risk flags across all projects
 *   GET  /project-scores — per-project composite health scores (0-100)
 */

import { Router } from "express";
import { requireRole } from "../middlewares/auth";
import {
  db,
  projectsTable,
  contributionsTable,
  inventoryStockMovementsTable,
  projectOwnershipFreezesTable,
  projectParticipantsTable,
} from "@workspace/db";
import { eq, and, isNull, inArray, not, lt, sql } from "drizzle-orm";

const router = Router();
router.use(requireRole("admin", "developer"));

// ── helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

// ── GET /summary ─────────────────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  const [
    lifecycleRows,
    verifiedCapital,
    reimbursementExposure,
    pendingOwnershipValue,
    govWarnings,
    governanceLocked,
    crystallizedCount,
    totalProjects,
  ] = await Promise.all([
    // Project counts by lifecycle status
    db
      .select({
        lifecycleStatus: projectsTable.lifecycleStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(projectsTable)
      .groupBy(projectsTable.lifecycleStatus),

    // Total verified, ownership-affecting contribution capital
    db
      .select({
        total: sql<number>`COALESCE(SUM(${contributionsTable.amount}), 0)`,
      })
      .from(contributionsTable)
      .where(
        and(
          eq(contributionsTable.verificationStatus, "verified"),
          eq(contributionsTable.affectsOwnership, true),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .then(([r]) => Number(r?.total ?? 0)),

    // Total verified reimbursement exposure (operational burden)
    db
      .select({
        total: sql<number>`COALESCE(SUM(${contributionsTable.amount}), 0)`,
      })
      .from(contributionsTable)
      .where(
        and(
          eq(contributionsTable.reimbursementFlag, true),
          eq(contributionsTable.verificationStatus, "verified"),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .then(([r]) => Number(r?.total ?? 0)),

    // Ownership-affecting entries still pending/draft (unresolved capital)
    db
      .select({
        total: sql<number>`COALESCE(SUM(${contributionsTable.amount}), 0)`,
      })
      .from(contributionsTable)
      .where(
        and(
          inArray(contributionsTable.verificationStatus, ["draft", "pending_verification"]),
          eq(contributionsTable.affectsOwnership, true),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .then(([r]) => Number(r?.total ?? 0)),

    // Projects with governance configuration warnings
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .where(
        not(eq(projectsTable.configurationStatus, "VALID")),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Governance-locked projects
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .where(eq(projectsTable.governanceLocked, true))
      .then(([r]) => Number(r?.count ?? 0)),

    // Mature/closed projects with ownership crystallized
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .where(
        and(
          inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
          not(isNull(projectsTable.ownershipFrozenAt)),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),

    // Total project count
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectsTable)
      .then(([r]) => Number(r?.count ?? 0)),
  ]);

  const matureOrClosed = lifecycleRows
    .filter((r) => ["mature_production", "closed"].includes(r.lifecycleStatus))
    .reduce((acc, r) => acc + Number(r.count), 0);

  return res.json({
    portfolioSize: totalProjects,
    lifecycleDistribution: lifecycleRows.map((r) => ({
      status: r.lifecycleStatus,
      count: Number(r.count),
      pct: totalProjects > 0 ? Math.round((Number(r.count) / totalProjects) * 100) : 0,
    })),
    financial: {
      verifiedCapital,
      reimbursementExposure,
      pendingOwnershipValue,
    },
    governance: {
      configurationWarnings: govWarnings,
      governanceLocked,
      crystallizedProjects: crystallizedCount,
      crystallizationGaps: matureOrClosed - crystallizedCount,
    },
    fetchedAt: new Date().toISOString(),
  });
});

// ── GET /risk-flags ───────────────────────────────────────────────────────────
router.get("/risk-flags", async (req, res) => {
  type Severity = "critical" | "high" | "medium" | "low";

  interface RiskFlag {
    projectId: string;
    projectName: string;
    severity: Severity;
    category: "inventory" | "financial" | "governance" | "ownership" | "operational";
    code: string;
    message: string;
  }

  const flags: RiskFlag[] = [];

  const [
    allProjects,
    negativeStockRows,
    staleOwnershipRows,
    ownershipGapProjects,
    invalidConfigProjects,
    lockedProjects,
    hasLandownerRows,
    highUnverifiedRows,
  ] = await Promise.all([
    // All projects — for name lookups
    db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        lifecycleStatus: projectsTable.lifecycleStatus,
        configurationStatus: projectsTable.configurationStatus,
        governanceLocked: projectsTable.governanceLocked,
        ownershipFrozenAt: projectsTable.ownershipFrozenAt,
        commercialModel: projectsTable.commercialModel,
      })
      .from(projectsTable),

    // CRITICAL: Negative confirmed stock balances
    db
      .select({
        projectId: inventoryStockMovementsTable.projectId,
        stockType: inventoryStockMovementsTable.stockType,
      })
      .from(inventoryStockMovementsTable)
      .where(eq(inventoryStockMovementsTable.isActive, true))
      .groupBy(
        inventoryStockMovementsTable.projectId,
        inventoryStockMovementsTable.stockType,
      )
      .having(
        sql`(
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)
        ) < 0`,
      ),

    // HIGH: Stale ownership-affecting contributions (draft/pending > 30 days)
    db
      .selectDistinct({ projectId: contributionsTable.projectId })
      .from(contributionsTable)
      .where(
        and(
          inArray(contributionsTable.verificationStatus, ["draft", "pending_verification"]),
          eq(contributionsTable.affectsOwnership, true),
          lt(contributionsTable.createdAt, sql`NOW() - INTERVAL '30 days'`),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      ),

    // HIGH: Mature/closed projects with no ownership freeze
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(
        and(
          inArray(projectsTable.lifecycleStatus, ["mature_production", "closed"]),
          isNull(projectsTable.ownershipFrozenAt),
        ),
      ),

    // MEDIUM: Projects with invalid configuration
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(not(eq(projectsTable.configurationStatus, "VALID"))),

    // MEDIUM: Governance-locked projects
    db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.governanceLocked, true)),

    // LOW: Projects with landowner participant (to find those without)
    db
      .selectDistinct({ projectId: projectParticipantsTable.projectId })
      .from(projectParticipantsTable)
      .where(eq(projectParticipantsTable.role, "landowner")),

    // LOW: Projects with >50% unverified ownership contributions
    db
      .select({
        projectId: contributionsTable.projectId,
        verifiedCount: sql<number>`COUNT(*) FILTER (WHERE ${contributionsTable.verificationStatus} = 'verified')::int`,
        totalCount: sql<number>`COUNT(*)::int`,
      })
      .from(contributionsTable)
      .where(
        and(
          eq(contributionsTable.affectsOwnership, true),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .groupBy(contributionsTable.projectId)
      .having(
        sql`(
          COUNT(*) FILTER (WHERE ${contributionsTable.verificationStatus} = 'verified')::float /
          NULLIF(COUNT(*), 0)
        ) < 0.5`,
      ),
  ]);

  // Build lookup maps
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const landownerSet = new Set(hasLandownerRows.map((r) => r.projectId));
  const ownershipGapSet = new Set(ownershipGapProjects.map((r) => r.id));
  const invalidConfigSet = new Set(invalidConfigProjects.map((r) => r.id));
  const lockedSet = new Set(lockedProjects.map((r) => r.id));
  const staleOwnershipSet = new Set(staleOwnershipRows.map((r) => r.projectId));

  // Deduplicate by (projectId, code)
  const seen = new Set<string>();
  function addFlag(f: RiskFlag) {
    const key = `${f.projectId}::${f.code}`;
    if (!seen.has(key)) {
      seen.add(key);
      flags.push(f);
    }
  }

  // CRITICAL — negative stock
  for (const row of negativeStockRows) {
    const p = projectMap.get(row.projectId);
    if (!p) continue;
    addFlag({
      projectId: row.projectId,
      projectName: p.name,
      severity: "critical",
      category: "inventory",
      code: "NEGATIVE_STOCK",
      message: `Negative confirmed stock balance for stock type "${row.stockType}" — outbound movements exceed inbound receipts.`,
    });
  }

  // HIGH — mature project without crystallization
  for (const row of ownershipGapProjects) {
    const p = projectMap.get(row.id);
    if (!p) continue;
    // Only flag ownership_contribution model (fifty_percent_revenue doesn't crystallize)
    if (p.commercialModel !== "ownership_contribution") continue;
    addFlag({
      projectId: row.id,
      projectName: p.name,
      severity: "high",
      category: "ownership",
      code: "OWNERSHIP_NOT_CRYSTALLIZED",
      message: `Project is ${p.lifecycleStatus} but has no ownership crystallization record — run Data Health backfill to resolve.`,
    });
  }

  // HIGH — stale ownership entries
  for (const row of staleOwnershipRows) {
    const p = projectMap.get(row.projectId!);
    if (!p) continue;
    addFlag({
      projectId: row.projectId!,
      projectName: p.name,
      severity: "high",
      category: "financial",
      code: "STALE_OWNERSHIP_ENTRIES",
      message: "Ownership-affecting contributions have been in draft/pending verification for more than 30 days — ownership ledger is incomplete.",
    });
  }

  // MEDIUM — invalid configuration
  for (const id of invalidConfigSet) {
    if (ownershipGapSet.has(id)) continue; // already a HIGH flag
    const p = projectMap.get(id);
    if (!p) continue;
    addFlag({
      projectId: id,
      projectName: p.name,
      severity: "medium",
      category: "governance",
      code: "INVALID_CONFIGURATION",
      message: `Project configuration status is "${p.configurationStatus}" — write operations are blocked until resolved.`,
    });
  }

  // MEDIUM — governance locked
  for (const id of lockedSet) {
    const p = projectMap.get(id);
    if (!p) continue;
    addFlag({
      projectId: id,
      projectName: p.name,
      severity: "medium",
      category: "governance",
      code: "GOVERNANCE_LOCKED",
      message: "Project is governance-locked — all write operations are blocked. A governance scan is required.",
    });
  }

  // LOW — no landowner participant
  for (const p of allProjects) {
    if (!landownerSet.has(p.id)) {
      addFlag({
        projectId: p.id,
        projectName: p.name,
        severity: "low",
        category: "governance",
        code: "NO_LANDOWNER_PARTICIPANT",
        message: "No landowner participant profile recorded for this project — onboarding is incomplete.",
      });
    }
  }

  // LOW — high unverified rate
  for (const row of highUnverifiedRows) {
    const p = projectMap.get(row.projectId!);
    if (!p) continue;
    const rate = Number(row.totalCount) > 0
      ? Math.round((Number(row.verifiedCount) / Number(row.totalCount)) * 100)
      : 0;
    addFlag({
      projectId: row.projectId!,
      projectName: p.name,
      severity: "low",
      category: "financial",
      code: "HIGH_UNVERIFIED_RATE",
      message: `Only ${rate}% of ownership-affecting contributions are verified — financial ledger reliability is low.`,
    });
  }

  // Sort: critical → high → medium → low, then by project name
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  flags.sort((a, b) => {
    const diff = severityOrder[a.severity] - severityOrder[b.severity];
    if (diff !== 0) return diff;
    return a.projectName.localeCompare(b.projectName);
  });

  const counts = {
    critical: flags.filter((f) => f.severity === "critical").length,
    high: flags.filter((f) => f.severity === "high").length,
    medium: flags.filter((f) => f.severity === "medium").length,
    low: flags.filter((f) => f.severity === "low").length,
    total: flags.length,
  };

  req.log.info({ counts }, "enterprise risk flags computed");

  return res.json({ flags, counts, fetchedAt: new Date().toISOString() });
});

// ── GET /project-scores ───────────────────────────────────────────────────────
router.get("/project-scores", async (req, res) => {
  const [
    allProjects,
    contributionStats,
    staleOwnershipProjects,
    negativeStockProjects,
    hasLandownerRows,
    ownershipFreezes,
  ] = await Promise.all([
    db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        lifecycleStatus: projectsTable.lifecycleStatus,
        commercialModel: projectsTable.commercialModel,
        configurationStatus: projectsTable.configurationStatus,
        governanceLocked: projectsTable.governanceLocked,
        ownershipFrozenAt: projectsTable.ownershipFrozenAt,
        activationStatus: projectsTable.activationStatus,
      })
      .from(projectsTable),

    // Per-project contribution verification stats
    db
      .select({
        projectId: contributionsTable.projectId,
        total: sql<number>`COUNT(*)::int`,
        verified: sql<number>`COUNT(*) FILTER (WHERE ${contributionsTable.verificationStatus} = 'verified')::int`,
        staleOwnership: sql<number>`COUNT(*) FILTER (
          WHERE ${contributionsTable.affectsOwnership} = true
          AND ${contributionsTable.verificationStatus} IN ('draft', 'pending_verification')
          AND ${contributionsTable.createdAt} < NOW() - INTERVAL '30 days'
        )::int`,
      })
      .from(contributionsTable)
      .where(
        and(
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      )
      .groupBy(contributionsTable.projectId),

    // Projects with stale ownership entries (for quick lookup)
    db
      .selectDistinct({ projectId: contributionsTable.projectId })
      .from(contributionsTable)
      .where(
        and(
          inArray(contributionsTable.verificationStatus, ["draft", "pending_verification"]),
          eq(contributionsTable.affectsOwnership, true),
          lt(contributionsTable.createdAt, sql`NOW() - INTERVAL '30 days'`),
          eq(contributionsTable.isActive, true),
          isNull(contributionsTable.deletedAt),
        ),
      ),

    // Projects with negative stock (for quick lookup)
    db
      .selectDistinct({ projectId: inventoryStockMovementsTable.projectId })
      .from(inventoryStockMovementsTable)
      .where(eq(inventoryStockMovementsTable.isActive, true))
      .groupBy(
        inventoryStockMovementsTable.projectId,
        inventoryStockMovementsTable.stockType,
      )
      .having(
        sql`(
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)
        ) < 0`,
      ),

    // Projects with a landowner participant
    db
      .selectDistinct({ projectId: projectParticipantsTable.projectId })
      .from(projectParticipantsTable)
      .where(eq(projectParticipantsTable.role, "landowner")),

    // Projects with an ownership freeze record
    db
      .select({ projectId: projectOwnershipFreezesTable.projectId })
      .from(projectOwnershipFreezesTable),
  ]);

  const contribMap = new Map(contributionStats.map((r) => [r.projectId, r]));
  const staleSet = new Set(staleOwnershipProjects.map((r) => r.projectId));
  const negStockSet = new Set(negativeStockProjects.map((r) => r.projectId));
  const landownerSet = new Set(hasLandownerRows.map((r) => r.projectId));
  const freezeSet = new Set(ownershipFreezes.map((r) => r.projectId));

  const scores = allProjects.map((p) => {
    const stats = contribMap.get(p.id);
    const total = Number(stats?.total ?? 0);
    const verified = Number(stats?.verified ?? 0);

    // ── Dimension 1: Contribution Verification Rate (0-25 pts)
    const verifiedRate = total > 0 ? verified / total : 1;
    const verificationPts = clamp(Math.round(verifiedRate * 25), 0, 25);

    // ── Dimension 2: Ownership Crystallization (0-20 pts)
    // - 20: not mature/closed (not yet applicable) OR crystallized
    // - 0: mature/closed AND no freeze
    const isMatureOrClosed = ["mature_production", "closed"].includes(p.lifecycleStatus);
    const isCrystallized = freezeSet.has(p.id) || p.ownershipFrozenAt !== null;
    const crystalPts =
      p.commercialModel !== "ownership_contribution"
        ? 20 // 50% revenue model — crystallization N/A, full credit
        : !isMatureOrClosed
        ? 20 // not yet due, full credit
        : isCrystallized
        ? 20
        : 0;

    // ── Dimension 3: No Stale Ownership Entries (0-25 pts)
    const stalePts = staleSet.has(p.id) ? 0 : 25;

    // ── Dimension 4: No Negative Stock (0-20 pts)
    const stockPts = negStockSet.has(p.id) ? 0 : 20;

    // ── Dimension 5: Governance Completeness (0-10 pts)
    let govPts = 0;
    if (landownerSet.has(p.id)) govPts += 5;
    if (p.configurationStatus === "VALID") govPts += 3;
    if (!p.governanceLocked) govPts += 2;

    const score = clamp(verificationPts + crystalPts + stalePts + stockPts + govPts);

    const label =
      score >= 85 ? "Excellent"
      : score >= 70 ? "Good"
      : score >= 50 ? "Attention Needed"
      : "At Risk";

    const tier: "green" | "yellow" | "orange" | "red" =
      score >= 85 ? "green"
      : score >= 70 ? "yellow"
      : score >= 50 ? "orange"
      : "red";

    return {
      projectId: p.id,
      projectName: p.name,
      lifecycleStatus: p.lifecycleStatus,
      commercialModel: p.commercialModel,
      score,
      label,
      tier,
      breakdown: {
        verificationPts,
        crystalPts,
        stalePts,
        stockPts,
        govPts,
        verifiedRate: Math.round(verifiedRate * 100),
        totalContributions: total,
      },
    };
  });

  // Sort by score ascending (lowest first — most at-risk visible first)
  scores.sort((a, b) => a.score - b.score);

  req.log.info({ count: scores.length }, "project health scores computed");

  return res.json({ scores, fetchedAt: new Date().toISOString() });
});

export default router;

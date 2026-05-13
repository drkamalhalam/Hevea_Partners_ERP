import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  partnersTable,
  landownerLedgerTable,
  lcaLedgerTable,
  burdenRecoveryAdjustmentsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";

import { requireFinancialRole } from "../middlewares/auth";
import { logFinancialAccess } from "../lib/financialAudit";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(
      and(
        eq(userProjectAssignmentsTable.userId, userId),
        isNull(userProjectAssignmentsTable.revokedAt),
      ),
    );
  return rows.map((r) => r.projectId);
}

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── GET /analytics/landowner-profitability ────────────────────────────────────

router.get("/landowner-profitability", requireFinancialRole, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  logFinancialAccess(req, "landowner_profitability", "read", req.query.projectId as string | undefined);

  const { projectId, partnerId, fromYear, toYear } = req.query as {
    projectId?: string;
    partnerId?: string;
    fromYear?: string;
    toYear?: string;
  };

  // ── Project access gate ──────────────────────────────────────────────────
  let allowedProjectIds: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    allowedProjectIds = await getAssignedProjectIds(actor.id);
    if (allowedProjectIds.length === 0) {
      return res.json({
        summary: {
          grossEntitlement: 0, operationalBurden: 0, lcaIncome: 0,
          recoverableAdj: 0, netProfitability: 0, totalLcaReceivable: 0,
          costBurdenRatio: 0, recoveryEfficiency: 100, lcaDependencyRatio: 0,
        },
        yearlyBreakdown: [],
        costBurdenAnalysis: {
          totalBurdenRecoverable: 0, totalBurdenRecovered: 0, totalBurdenPending: 0,
          byCategory: [],
          byStatus: { pending: 0, partial: 0, recovered: 0, waived: 0 },
        },
        sustainabilityIndicators: {
          profitabilityScore: "moderate",
          costBurdenRating: "low",
          lcaComplianceRating: "compliant",
          recoveryRating: "excellent",
          overallSustainability: "moderate",
        },
        projects: [],
      });
    }
  }

  // ── Fetch confirmed ledger entries ───────────────────────────────────────
  const ledgerConds: ReturnType<typeof eq>[] = [
    eq(landownerLedgerTable.status, "confirmed"),
  ];
  if (projectId) ledgerConds.push(eq(landownerLedgerTable.projectId, projectId));
  if (partnerId) ledgerConds.push(eq(landownerLedgerTable.partnerId, partnerId));
  if (allowedProjectIds) {
    if (allowedProjectIds.length === 0) return res.json([]);
    ledgerConds.push(inArray(landownerLedgerTable.projectId, allowedProjectIds));
  }

  const allLedgerEntries = await db
    .select()
    .from(landownerLedgerTable)
    .where(and(...ledgerConds));

  // Year filter on periodStart
  const fromYearNum = fromYear ? parseInt(fromYear) : null;
  const toYearNum = toYear ? parseInt(toYear) : null;
  const ledgerEntries = allLedgerEntries.filter((e) => {
    const year = parseInt(e.periodStart.substring(0, 4));
    if (fromYearNum !== null && year < fromYearNum) return false;
    if (toYearNum !== null && year > toYearNum) return false;
    return true;
  });

  // ── Compute summary totals ────────────────────────────────────────────────
  let grossEntitlement = 0;
  let operationalBurden = 0;
  let lcaIncome = 0;
  let recoverableAdjCredit = 0;
  let recoverableAdjDebit = 0;

  for (const e of ledgerEntries) {
    const amt = Number(e.amount);
    if (e.entryType === "revenue_entitlement" && e.direction === "credit") {
      grossEntitlement += amt;
    } else if (e.entryType === "operational_burden" && e.direction === "debit") {
      operationalBurden += amt;
    } else if (e.entryType === "lca_credit" && e.direction === "credit") {
      lcaIncome += amt;
    } else if (e.entryType === "recoverable_adjustment") {
      if (e.direction === "credit") recoverableAdjCredit += amt;
      else recoverableAdjDebit += amt;
    }
  }

  const recoverableAdj = recoverableAdjCredit - recoverableAdjDebit;
  const netProfitability = grossEntitlement - operationalBurden + lcaIncome + recoverableAdj;
  const costBurdenRatio = grossEntitlement > 0 ? (operationalBurden / grossEntitlement) * 100 : 0;

  // ── Year-wise breakdown ────────────────────────────────────────────────────
  const yearMap = new Map<number, {
    grossEntitlement: number;
    operationalBurden: number;
    lcaIncome: number;
    recoverableAdj: number;
  }>();

  for (const e of ledgerEntries) {
    const year = parseInt(e.periodStart.substring(0, 4));
    if (!yearMap.has(year)) {
      yearMap.set(year, { grossEntitlement: 0, operationalBurden: 0, lcaIncome: 0, recoverableAdj: 0 });
    }
    const row = yearMap.get(year)!;
    const amt = Number(e.amount);
    if (e.entryType === "revenue_entitlement" && e.direction === "credit") {
      row.grossEntitlement += amt;
    } else if (e.entryType === "operational_burden" && e.direction === "debit") {
      row.operationalBurden += amt;
    } else if (e.entryType === "lca_credit" && e.direction === "credit") {
      row.lcaIncome += amt;
    } else if (e.entryType === "recoverable_adjustment") {
      if (e.direction === "credit") row.recoverableAdj += amt;
      else row.recoverableAdj -= amt;
    }
  }

  const yearlyBreakdown = Array.from(yearMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, data]) => ({
      year,
      grossEntitlement: data.grossEntitlement,
      operationalBurden: data.operationalBurden,
      lcaIncome: data.lcaIncome,
      recoverableAdj: data.recoverableAdj,
      netProfitability:
        data.grossEntitlement - data.operationalBurden + data.lcaIncome + data.recoverableAdj,
    }));

  // ── LCA ledger for receivable + compliance ────────────────────────────────
  const lcaConds: ReturnType<typeof eq>[] = [];
  if (projectId) lcaConds.push(eq(lcaLedgerTable.projectId, projectId));
  if (allowedProjectIds && allowedProjectIds.length > 0) {
    lcaConds.push(inArray(lcaLedgerTable.projectId, allowedProjectIds));
  }

  const lcaEntries = await db
    .select()
    .from(lcaLedgerTable)
    .where(lcaConds.length > 0 ? and(...lcaConds) : undefined);

  const totalLcaDue = lcaEntries.reduce((s, r) => s + Number(r.totalDue), 0);
  const totalLcaPaid = lcaEntries.reduce((s, r) => s + Number(r.amountPaid), 0);
  const totalLcaReceivable = lcaEntries.reduce((s, r) => s + Number(r.balance), 0);
  const lcaComplianceRate = totalLcaDue > 0 ? (totalLcaPaid / totalLcaDue) * 100 : 100;

  // ── Burden recovery adjustments ────────────────────────────────────────────
  const brConds: ReturnType<typeof eq>[] = [];
  if (projectId) brConds.push(eq(burdenRecoveryAdjustmentsTable.projectId, projectId));
  if (partnerId) brConds.push(eq(burdenRecoveryAdjustmentsTable.targetPartnerId, partnerId));
  if (allowedProjectIds && allowedProjectIds.length > 0) {
    brConds.push(inArray(burdenRecoveryAdjustmentsTable.projectId, allowedProjectIds));
  }

  const burdenAdjustments = await db
    .select()
    .from(burdenRecoveryAdjustmentsTable)
    .where(brConds.length > 0 ? and(...brConds) : undefined);

  const totalBurdenRecoverable = burdenAdjustments.reduce(
    (s, r) => s + Number(r.recoverableAmount), 0,
  );
  const totalBurdenRecovered = burdenAdjustments.reduce(
    (s, r) => s + Number(r.recoveredAmount), 0,
  );
  const totalBurdenPending = totalBurdenRecoverable - totalBurdenRecovered;

  const categoryMap = new Map<string, number>();
  for (const adj of burdenAdjustments) {
    const cat = adj.costCategory ?? "Uncategorized";
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + Number(adj.recoverableAmount));
  }
  const byCategory = Array.from(categoryMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([category, amount]) => ({ category, amount }));

  const byStatus = {
    pending: burdenAdjustments.filter((a) => a.recoveryStatus === "pending").length,
    partial: burdenAdjustments.filter((a) => a.recoveryStatus === "partial").length,
    recovered: burdenAdjustments.filter((a) => a.recoveryStatus === "recovered").length,
    waived: burdenAdjustments.filter((a) => a.recoveryStatus === "waived").length,
  };

  const recoveryEfficiency =
    totalBurdenRecoverable > 0 ? (totalBurdenRecovered / totalBurdenRecoverable) * 100 : 100;
  const lcaDependencyRatio = grossEntitlement > 0 ? (lcaIncome / grossEntitlement) * 100 : 0;

  // ── Sustainability indicators ─────────────────────────────────────────────
  const profitabilityScore: string = (() => {
    if (netProfitability > 0 && costBurdenRatio < 30) return "strong";
    if (netProfitability > 0 && costBurdenRatio < 60) return "moderate";
    if (netProfitability > 0) return "at_risk";
    return "critical";
  })();

  const costBurdenRating: string = (() => {
    if (costBurdenRatio < 20) return "low";
    if (costBurdenRatio < 40) return "moderate";
    if (costBurdenRatio < 70) return "high";
    return "critical";
  })();

  const lcaComplianceRating: string = (() => {
    if (lcaComplianceRate >= 95) return "compliant";
    if (lcaComplianceRate >= 50) return "partial";
    return "outstanding";
  })();

  const recoveryRating: string = (() => {
    if (recoveryEfficiency >= 90) return "excellent";
    if (recoveryEfficiency >= 70) return "good";
    if (recoveryEfficiency >= 40) return "lagging";
    return "critical";
  })();

  const severityScore = (r: string): number => {
    const m: Record<string, number> = {
      strong: 0, low: 0, compliant: 0, excellent: 0,
      moderate: 1, good: 1, partial: 1,
      at_risk: 2, high: 2, lagging: 2,
      critical: 3, outstanding: 3,
    };
    return m[r] ?? 3;
  };

  const maxSeverity = Math.max(
    severityScore(profitabilityScore),
    severityScore(costBurdenRating),
    severityScore(lcaComplianceRating),
    severityScore(recoveryRating),
  );

  const overallSustainability: string = (() => {
    if (maxSeverity === 0) return "strong";
    if (maxSeverity === 1) return "moderate";
    if (maxSeverity === 2) return "at_risk";
    return "critical";
  })();

  // ── Per-project breakdown ──────────────────────────────────────────────────
  const projMap = new Map<string, {
    projectId: string;
    partnerId: string;
    grossEntitlement: number;
    operationalBurden: number;
    lcaIncome: number;
    recoverableAdj: number;
  }>();

  for (const e of ledgerEntries) {
    const key = `${e.projectId}:${e.partnerId}`;
    if (!projMap.has(key)) {
      projMap.set(key, {
        projectId: e.projectId,
        partnerId: e.partnerId,
        grossEntitlement: 0,
        operationalBurden: 0,
        lcaIncome: 0,
        recoverableAdj: 0,
      });
    }
    const row = projMap.get(key)!;
    const amt = Number(e.amount);
    if (e.entryType === "revenue_entitlement" && e.direction === "credit") {
      row.grossEntitlement += amt;
    } else if (e.entryType === "operational_burden" && e.direction === "debit") {
      row.operationalBurden += amt;
    } else if (e.entryType === "lca_credit" && e.direction === "credit") {
      row.lcaIncome += amt;
    } else if (e.entryType === "recoverable_adjustment") {
      if (e.direction === "credit") row.recoverableAdj += amt;
      else row.recoverableAdj -= amt;
    }
  }

  // Resolve project + partner names
  const projIds = [...new Set(ledgerEntries.map((e) => e.projectId))];
  const partIds = [...new Set(ledgerEntries.map((e) => e.partnerId))];

  const [projRows, partRows] = await Promise.all([
    projIds.length > 0
      ? db.select({ id: projectsTable.id, name: projectsTable.name })
          .from(projectsTable)
          .where(inArray(projectsTable.id, projIds))
      : Promise.resolve([]),
    partIds.length > 0
      ? db.select({ id: partnersTable.id, name: partnersTable.name })
          .from(partnersTable)
          .where(inArray(partnersTable.id, partIds))
      : Promise.resolve([]),
  ]);

  const projNames = new Map(projRows.map((p) => [p.id, p.name]));
  const partNames = new Map(partRows.map((p) => [p.id, p.name]));

  const projects = Array.from(projMap.values()).map((row) => ({
    projectId: row.projectId,
    projectName: projNames.get(row.projectId) ?? "Unknown",
    partnerId: row.partnerId,
    partnerName: partNames.get(row.partnerId) ?? "Unknown",
    grossEntitlement: row.grossEntitlement,
    operationalBurden: row.operationalBurden,
    lcaIncome: row.lcaIncome,
    recoverableAdj: row.recoverableAdj,
    netProfitability:
      row.grossEntitlement - row.operationalBurden + row.lcaIncome + row.recoverableAdj,
    costBurdenRatio:
      row.grossEntitlement > 0 ? (row.operationalBurden / row.grossEntitlement) * 100 : 0,
  }));

  return res.json({
    summary: {
      grossEntitlement,
      operationalBurden,
      lcaIncome,
      recoverableAdj,
      netProfitability,
      totalLcaReceivable,
      costBurdenRatio,
      recoveryEfficiency,
      lcaDependencyRatio,
    },
    yearlyBreakdown,
    costBurdenAnalysis: {
      totalBurdenRecoverable,
      totalBurdenRecovered,
      totalBurdenPending,
      byCategory,
      byStatus,
    },
    sustainabilityIndicators: {
      profitabilityScore,
      costBurdenRating,
      lcaComplianceRating,
      recoveryRating,
      overallSustainability,
    },
    projects,
  });
});

export default router;

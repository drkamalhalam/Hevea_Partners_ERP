/**
 * settlement_governance.ts
 *
 * Distribution Governance & Settlement Monitoring
 *
 * Six alert categories:
 *   PENDING_SETTLEMENT      — distribution_records pending/partial > 0
 *   LARGE_OVERRIDE          — settlement_records override diff > threshold (20%)
 *   UNPAID_LCA              — lca_ledger pending/partial with balance > 0
 *   NEGATIVE_BALANCE        — negative_balance_entries closingBalance < 0 (latest per pair)
 *   MISSING_FINALIZATION    — settlement_records recommended/overridden older than 14 days
 *   UNRESOLVED_DISPUTE      — settlement_records status = 'disputed'
 *
 * Severity: CRITICAL > HIGH > MEDIUM > LOW
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  usersTable,
  projectsTable,
  partnersTable,
  distributionRecordsTable,
  settlementRecordsTable,
  lcaLedgerTable,
  negativeBalanceEntriesTable,
  lossAbsorptionRecordsTable,
} from "@workspace/db";
import { eq, and, desc, sql, lt, inArray, ne, gt } from "drizzle-orm";

const router = Router();

// ── Thresholds ────────────────────────────────────────────────────────────

const OVERRIDE_THRESHOLD_PCT   = 0.20; // 20% diff = HIGH, 50% = CRITICAL
const FINALIZATION_STALE_DAYS  = 14;
const LARGE_PENDING_AMOUNT     = 100_000; // ₹1L+  = HIGH pending
const CRITICAL_PENDING_AMOUNT  = 500_000; // ₹5L+  = CRITICAL

type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type AlertCategory =
  | "PENDING_SETTLEMENT"
  | "LARGE_OVERRIDE"
  | "UNPAID_LCA"
  | "NEGATIVE_BALANCE"
  | "MISSING_FINALIZATION"
  | "UNRESOLVED_DISPUTE";

interface GovernanceAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  partnerId: string | null;
  partnerName: string | null;
  amount: number | null;
  referenceId: string | null;
  referenceType: string | null;
  detectedAt: string;
  actionUrl: string | null;
  metadata: Record<string, unknown>;
}

// ── Helper: resolve user ──────────────────────────────────────────────────

async function resolveUser(clerkUserId: string) {
  const [u] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return u ?? null;
}

// ── Alert generators ──────────────────────────────────────────────────────

async function pendingSettlementAlerts(): Promise<GovernanceAlert[]> {
  const rows = await db
    .select({
      id: distributionRecordsTable.id,
      projectId: distributionRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: distributionRecordsTable.partnerId,
      partnerName: partnersTable.name,
      accountingPeriodLabel: distributionRecordsTable.accountingPeriodLabel,
      pendingPayable: distributionRecordsTable.pendingPayable,
      status: distributionRecordsTable.status,
      createdAt: distributionRecordsTable.createdAt,
    })
    .from(distributionRecordsTable)
    .leftJoin(projectsTable, eq(distributionRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(distributionRecordsTable.partnerId, partnersTable.id))
    .where(
      and(
        inArray(distributionRecordsTable.status, ["pending", "partial"]),
        eq(distributionRecordsTable.isActive, true),
        sql`${distributionRecordsTable.pendingPayable}::numeric > 0`
      )
    )
    .orderBy(desc(distributionRecordsTable.pendingPayable));

  return rows.map((r) => {
    const amt = parseFloat(r.pendingPayable ?? "0");
    const sev: AlertSeverity =
      amt >= CRITICAL_PENDING_AMOUNT ? "CRITICAL"
      : amt >= LARGE_PENDING_AMOUNT  ? "HIGH"
      : r.status === "pending"       ? "MEDIUM"
      : "LOW";
    return {
      id: `pending_settlement_${r.id}`,
      category: "PENDING_SETTLEMENT",
      severity: sev,
      title: `Pending Settlement — ${r.accountingPeriodLabel}`,
      description: `₹${amt.toLocaleString("en-IN")} outstanding for ${r.partnerName ?? "all partners"} on ${r.projectName ?? r.projectId}`,
      projectId: r.projectId,
      projectName: r.projectName ?? null,
      partnerId: r.partnerId ?? null,
      partnerName: r.partnerName ?? null,
      amount: amt,
      referenceId: r.id,
      referenceType: "distribution_record",
      detectedAt: new Date().toISOString(),
      actionUrl: `/distribution-records`,
      metadata: { status: r.status, periodLabel: r.accountingPeriodLabel },
    };
  });
}

async function largeOverrideAlerts(): Promise<GovernanceAlert[]> {
  const rows = await db
    .select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      periodLabel: settlementRecordsTable.periodLabel,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      actualAmount: settlementRecordsTable.actualAmount,
      overrideCount: settlementRecordsTable.overrideCount,
      overrideRemarks: settlementRecordsTable.overrideRemarks,
      settlementType: settlementRecordsTable.settlementType,
      status: settlementRecordsTable.status,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(
      and(
        eq(settlementRecordsTable.isOverridden, true),
        ne(settlementRecordsTable.status, "archived"),
      )
    );

  const alerts: GovernanceAlert[] = [];
  for (const r of rows) {
    const rec = parseFloat(r.recommendedAmount ?? "0");
    const act = parseFloat(r.actualAmount ?? "0");
    if (rec === 0) continue;
    const diffPct = Math.abs(act - rec) / rec;
    if (diffPct < OVERRIDE_THRESHOLD_PCT) continue;

    const sev: AlertSeverity = diffPct >= 0.5 ? "CRITICAL" : diffPct >= 0.3 ? "HIGH" : "MEDIUM";
    alerts.push({
      id: `large_override_${r.id}`,
      category: "LARGE_OVERRIDE",
      severity: sev,
      title: `Large Override Difference — ${r.periodLabel}`,
      description: `Actual ₹${act.toLocaleString("en-IN")} vs recommended ₹${rec.toLocaleString("en-IN")} (${(diffPct * 100).toFixed(1)}% diff, ${r.overrideCount} overrides)`,
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      partnerId: r.partnerId ?? null,
      partnerName: r.partnerName ?? null,
      amount: Math.abs(act - rec),
      referenceId: r.id,
      referenceType: "settlement_record",
      detectedAt: new Date().toISOString(),
      actionUrl: `/final-settlement`,
      metadata: { recommendedAmount: rec, actualAmount: act, diffPct, overrideCount: r.overrideCount, settlementType: r.settlementType },
    });
  }
  return alerts;
}

async function unpaidLcaAlerts(): Promise<GovernanceAlert[]> {
  const rows = await db
    .select({
      id: lcaLedgerTable.id,
      projectId: lcaLedgerTable.projectId,
      projectName: projectsTable.name,
      year: lcaLedgerTable.year,
      totalDue: lcaLedgerTable.totalDue,
      balance: lcaLedgerTable.balance,
      status: lcaLedgerTable.status,
    })
    .from(lcaLedgerTable)
    .leftJoin(projectsTable, eq(lcaLedgerTable.projectId, projectsTable.id))
    .where(
      and(
        inArray(lcaLedgerTable.status, ["pending", "partial"]),
        sql`${lcaLedgerTable.balance} > 0`
      )
    )
    .orderBy(desc(lcaLedgerTable.balance));

  return rows.map((r) => {
    const bal = typeof r.balance === "number" ? r.balance : parseFloat(String(r.balance));
    const due = typeof r.totalDue === "number" ? r.totalDue : parseFloat(String(r.totalDue));
    const sev: AlertSeverity =
      bal >= CRITICAL_PENDING_AMOUNT ? "CRITICAL"
      : bal >= LARGE_PENDING_AMOUNT  ? "HIGH"
      : r.status === "pending"       ? "MEDIUM"
      : "LOW";
    return {
      id: `unpaid_lca_${r.id}`,
      category: "UNPAID_LCA",
      severity: sev,
      title: `Unpaid LCA — Year ${r.year}`,
      description: `Outstanding LCA balance of ₹${bal.toLocaleString("en-IN")} (total due ₹${due.toLocaleString("en-IN")}) for ${r.projectName ?? r.projectId}`,
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      partnerId: null,
      partnerName: null,
      amount: bal,
      referenceId: r.id,
      referenceType: "lca_ledger",
      detectedAt: new Date().toISOString(),
      actionUrl: `/lca-ledger`,
      metadata: { year: r.year, totalDue: due, balance: bal, status: r.status },
    };
  });
}

async function negativeBalanceAlerts(): Promise<GovernanceAlert[]> {
  // Latest closingBalance per (project, partner) — negative = in deficit
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (project_id, partner_id)
      id,
      project_id,
      partner_id,
      closing_balance,
      reference_type,
      recorded_at,
      recovery_status,
      p.name AS project_name,
      pt.name AS partner_name
    FROM negative_balance_entries nbe
    LEFT JOIN projects p ON p.id = nbe.project_id
    LEFT JOIN partners pt ON pt.id = nbe.partner_id
    WHERE nbe.closing_balance < 0
    ORDER BY project_id, partner_id, recorded_at DESC
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => {
    const bal = parseFloat(String(r.closing_balance ?? "0"));
    const absBal = Math.abs(bal);
    const sev: AlertSeverity =
      absBal >= CRITICAL_PENDING_AMOUNT ? "CRITICAL"
      : absBal >= LARGE_PENDING_AMOUNT  ? "HIGH"
      : "MEDIUM";
    return {
      id: `negative_balance_${r.id}`,
      category: "NEGATIVE_BALANCE",
      severity: sev,
      title: `Negative Balance Accumulation`,
      description: `Net deficit of ₹${absBal.toLocaleString("en-IN")} for ${r.partner_name ?? r.partner_id ?? "partner"} on ${r.project_name ?? r.project_id} (recovery: ${r.recovery_status})`,
      projectId: (r.project_id as string) ?? null,
      projectName: (r.project_name as string) ?? null,
      partnerId: (r.partner_id as string) ?? null,
      partnerName: (r.partner_name as string) ?? null,
      amount: absBal,
      referenceId: (r.id as string) ?? null,
      referenceType: "negative_balance_entry",
      detectedAt: new Date().toISOString(),
      actionUrl: `/loss-absorption`,
      metadata: { closingBalance: bal, recoveryStatus: r.recovery_status, referenceType: r.reference_type },
    };
  });
}

async function missingFinalizationAlerts(): Promise<GovernanceAlert[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FINALIZATION_STALE_DAYS);

  const rows = await db
    .select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      periodLabel: settlementRecordsTable.periodLabel,
      status: settlementRecordsTable.status,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      overrideCount: settlementRecordsTable.overrideCount,
      settlementType: settlementRecordsTable.settlementType,
      createdAt: settlementRecordsTable.createdAt,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(
      and(
        inArray(settlementRecordsTable.status, ["recommended", "overridden"]),
        lt(settlementRecordsTable.createdAt, cutoff),
        ne(settlementRecordsTable.status, "archived")
      )
    )
    .orderBy(settlementRecordsTable.createdAt);

  return rows.map((r) => {
    const ageDays = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000);
    const sev: AlertSeverity = ageDays >= 60 ? "CRITICAL" : ageDays >= 30 ? "HIGH" : "MEDIUM";
    return {
      id: `missing_finalization_${r.id}`,
      category: "MISSING_FINALIZATION",
      severity: sev,
      title: `Unfinalized Settlement — ${r.periodLabel}`,
      description: `Settlement in "${r.status}" state for ${ageDays} days — recommended ₹${parseFloat(r.recommendedAmount ?? "0").toLocaleString("en-IN")} (${r.overrideCount} overrides)`,
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      partnerId: r.partnerId ?? null,
      partnerName: r.partnerName ?? null,
      amount: parseFloat(r.recommendedAmount ?? "0"),
      referenceId: r.id,
      referenceType: "settlement_record",
      detectedAt: new Date().toISOString(),
      actionUrl: `/final-settlement`,
      metadata: { status: r.status, ageDays, settlementType: r.settlementType, overrideCount: r.overrideCount },
    };
  });
}

async function unresolvedDisputeAlerts(): Promise<GovernanceAlert[]> {
  const rows = await db
    .select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      periodLabel: settlementRecordsTable.periodLabel,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      actualAmount: settlementRecordsTable.actualAmount,
      overrideRemarks: settlementRecordsTable.overrideRemarks,
      settlementType: settlementRecordsTable.settlementType,
      createdAt: settlementRecordsTable.createdAt,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(eq(settlementRecordsTable.status, "disputed"))
    .orderBy(settlementRecordsTable.createdAt);

  return rows.map((r) => {
    const ageDays = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000);
    return {
      id: `dispute_${r.id}`,
      category: "UNRESOLVED_DISPUTE",
      severity: "HIGH" as AlertSeverity,
      title: `Disputed Settlement — ${r.periodLabel}`,
      description: `Dispute open for ${ageDays} days on ${r.projectName ?? r.projectId}${r.partnerName ? ` (${r.partnerName})` : ""}`,
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      partnerId: r.partnerId ?? null,
      partnerName: r.partnerName ?? null,
      amount: parseFloat(r.recommendedAmount ?? "0"),
      referenceId: r.id,
      referenceType: "settlement_record",
      detectedAt: new Date().toISOString(),
      actionUrl: `/final-settlement`,
      metadata: { ageDays, settlementType: r.settlementType, remarks: r.overrideRemarks },
    };
  });
}

// ── GET /settlement-governance/summary ───────────────────────────────────

router.get("/summary", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const [
    pendingAlerts,
    overrideAlerts,
    lcaAlerts,
    negBalAlerts,
    finalizationAlerts,
    disputeAlerts,
  ] = await Promise.all([
    pendingSettlementAlerts(),
    largeOverrideAlerts(),
    unpaidLcaAlerts(),
    negativeBalanceAlerts(),
    missingFinalizationAlerts(),
    unresolvedDisputeAlerts(),
  ]);

  const allAlerts = [
    ...pendingAlerts,
    ...overrideAlerts,
    ...lcaAlerts,
    ...negBalAlerts,
    ...finalizationAlerts,
    ...disputeAlerts,
  ];

  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const byCategory: Record<string, number> = {};
  let totalExposure = 0;

  for (const a of allAlerts) {
    bySeverity[a.severity]++;
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    if (a.amount) totalExposure += a.amount;
  }

  const healthScore = Math.max(0, 100
    - bySeverity.CRITICAL * 25
    - bySeverity.HIGH * 10
    - bySeverity.MEDIUM * 5
    - bySeverity.LOW * 1
  );

  return res.json({
    totalAlerts: allAlerts.length,
    bySeverity,
    byCategory,
    totalExposure: totalExposure.toFixed(2),
    healthScore: Math.min(100, healthScore),
    summary: {
      pendingSettlements: pendingAlerts.length,
      largeOverrides: overrideAlerts.length,
      unpaidLca: lcaAlerts.length,
      negativeBalances: negBalAlerts.length,
      missingFinalizations: finalizationAlerts.length,
      unresolvedDisputes: disputeAlerts.length,
    },
  });
});

// ── GET /settlement-governance/alerts ───────────────────────────────────

router.get("/alerts", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { category, severity, projectId } = req.query as Record<string, string | undefined>;

  const [
    pendingAlerts,
    overrideAlerts,
    lcaAlerts,
    negBalAlerts,
    finalizationAlerts,
    disputeAlerts,
  ] = await Promise.all([
    pendingSettlementAlerts(),
    largeOverrideAlerts(),
    unpaidLcaAlerts(),
    negativeBalanceAlerts(),
    missingFinalizationAlerts(),
    unresolvedDisputeAlerts(),
  ]);

  let allAlerts = [
    ...pendingAlerts,
    ...overrideAlerts,
    ...lcaAlerts,
    ...negBalAlerts,
    ...finalizationAlerts,
    ...disputeAlerts,
  ];

  if (category) allAlerts = allAlerts.filter(a => a.category === category);
  if (severity) allAlerts = allAlerts.filter(a => a.severity === severity);
  if (projectId) allAlerts = allAlerts.filter(a => a.projectId === projectId);

  // Sort: CRITICAL first, then HIGH, then by amount desc
  const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  allAlerts.sort((a, b) => {
    const sd = sevOrder[a.severity] - sevOrder[b.severity];
    if (sd !== 0) return sd;
    return (b.amount ?? 0) - (a.amount ?? 0);
  });

  return res.json({ alerts: allAlerts, total: allAlerts.length });
});

// ── GET /settlement-governance/tasks ────────────────────────────────────

router.get("/tasks", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as Record<string, string | undefined>;

  // Pending distribution records = actionable payment tasks
  const pendingFilter: ReturnType<typeof eq>[] = [
    eq(distributionRecordsTable.isActive, true),
  ];
  if (projectId) pendingFilter.push(eq(distributionRecordsTable.projectId, projectId));

  const [pendingRecords, settlementsToFinalize, disputes] = await Promise.all([
    db.select({
      id: distributionRecordsTable.id,
      projectId: distributionRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: distributionRecordsTable.partnerId,
      partnerName: partnersTable.name,
      accountingPeriodLabel: distributionRecordsTable.accountingPeriodLabel,
      pendingPayable: distributionRecordsTable.pendingPayable,
      totalPaid: distributionRecordsTable.totalPaid,
      settlementRecommendation: distributionRecordsTable.settlementRecommendation,
      status: distributionRecordsTable.status,
      createdAt: distributionRecordsTable.createdAt,
    })
    .from(distributionRecordsTable)
    .leftJoin(projectsTable, eq(distributionRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(distributionRecordsTable.partnerId, partnersTable.id))
    .where(
      and(
        ...pendingFilter,
        inArray(distributionRecordsTable.status, ["pending", "partial"]),
        sql`${distributionRecordsTable.pendingPayable}::numeric > 0`
      )
    )
    .orderBy(desc(distributionRecordsTable.pendingPayable)),

    db.select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      periodLabel: settlementRecordsTable.periodLabel,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      actualAmount: settlementRecordsTable.actualAmount,
      status: settlementRecordsTable.status,
      overrideCount: settlementRecordsTable.overrideCount,
      settlementType: settlementRecordsTable.settlementType,
      createdAt: settlementRecordsTable.createdAt,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(inArray(settlementRecordsTable.status, ["recommended", "overridden"]))
    .orderBy(settlementRecordsTable.createdAt),

    db.select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      periodLabel: settlementRecordsTable.periodLabel,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      actualAmount: settlementRecordsTable.actualAmount,
      settlementType: settlementRecordsTable.settlementType,
      createdAt: settlementRecordsTable.createdAt,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(eq(settlementRecordsTable.status, "disputed")),
  ]);

  return res.json({
    pendingPayments: pendingRecords,
    pendingFinalizations: settlementsToFinalize,
    openDisputes: disputes,
    taskCounts: {
      pendingPayments: pendingRecords.length,
      pendingFinalizations: settlementsToFinalize.length,
      openDisputes: disputes.length,
      total: pendingRecords.length + settlementsToFinalize.length + disputes.length,
    },
  });
});

// ── GET /settlement-governance/discrepancies ──────────────────────────────

router.get("/discrepancies", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as Record<string, string | undefined>;

  const filters: ReturnType<typeof eq>[] = [
    eq(settlementRecordsTable.isOverridden, true),
    ne(settlementRecordsTable.status, "archived"),
  ];
  if (projectId) filters.push(eq(settlementRecordsTable.projectId, projectId));

  const rows = await db
    .select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      periodLabel: settlementRecordsTable.periodLabel,
      settlementType: settlementRecordsTable.settlementType,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      actualAmount: settlementRecordsTable.actualAmount,
      overrideCount: settlementRecordsTable.overrideCount,
      overrideRemarks: settlementRecordsTable.overrideRemarks,
      status: settlementRecordsTable.status,
      lastOverriddenByRole: settlementRecordsTable.lastOverriddenByRole,
      createdAt: settlementRecordsTable.createdAt,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(and(...filters))
    .orderBy(desc(settlementRecordsTable.overrideCount));

  const enriched = rows.map((r) => {
    const rec = parseFloat(r.recommendedAmount ?? "0");
    const act = parseFloat(r.actualAmount ?? "0");
    const diff = act - rec;
    const diffPct = rec !== 0 ? (diff / rec) * 100 : 0;
    return {
      ...r,
      diff: diff.toFixed(2),
      diffPct: diffPct.toFixed(1),
      diffFlag: Math.abs(diffPct) >= 50 ? "CRITICAL" : Math.abs(diffPct) >= 20 ? "HIGH" : Math.abs(diffPct) >= 10 ? "MEDIUM" : "OK",
    };
  });

  const totalDiscrepancy = enriched.reduce((s, r) => s + Math.abs(parseFloat(r.diff)), 0);

  return res.json({
    discrepancies: enriched,
    total: enriched.length,
    totalDiscrepancyAmount: totalDiscrepancy.toFixed(2),
    flagCounts: {
      CRITICAL: enriched.filter(r => r.diffFlag === "CRITICAL").length,
      HIGH: enriched.filter(r => r.diffFlag === "HIGH").length,
      MEDIUM: enriched.filter(r => r.diffFlag === "MEDIUM").length,
      OK: enriched.filter(r => r.diffFlag === "OK").length,
    },
  });
});

export default router;

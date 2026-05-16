/**
 * settlement_analytics.ts
 *
 * Settlement & Distribution Reporting Engine API.
 * Role-aware: admin/developer see all; others see assigned projects only.
 *
 * Ownership model  — distribution_records, settlement_records, landowner_ledger
 * 50% revenue model — fifty_pct_sessions, epp_entries
 * Both models      — governance_overrides, settlement_override_events, held_distribution_ledger
 *
 * Endpoints:
 *   GET /settlement-analytics/projects
 *   GET /settlement-analytics/overview?projectId=
 *   GET /settlement-analytics/distributions?projectId=&year=
 *   GET /settlement-analytics/settlements?projectId=&year=
 *   GET /settlement-analytics/overrides?projectId=
 *   GET /settlement-analytics/landowner?projectId=
 *   GET /settlement-analytics/epp?projectId=
 *   GET /settlement-analytics/pending?projectId=
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, projectsTable, userProjectAssignmentsTable } from "@workspace/db";
import { eq, and, inArray, isNull, sql, desc, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────
const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toF2 = (v: number) => parseFloat(v.toFixed(2));

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
  return rows.map((r) => r.projectId);
}

async function resolveAllowedIds(actor: { role: string; id: string }): Promise<string[] | null> {
  if (isPrivileged(actor.role)) return null;
  return getAssignedIds(actor.id);
}

async function checkProjectAccess(actor: { role: string; id: string }, projectId: string): Promise<boolean> {
  if (isPrivileged(actor.role)) return true;
  const ids = await getAssignedIds(actor.id);
  return ids.includes(projectId);
}

// ── GET /settlement-analytics/projects ───────────────────────────────────

router.get("/projects", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  const allowed = await resolveAllowedIds(actor);

  const projects =
    allowed !== null && allowed.length === 0
      ? []
      : await db
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
            allowed !== null
              ? and(eq(projectsTable.isActive, true), inArray(projectsTable.id, allowed))
              : eq(projectsTable.isActive, true),
          )
          .orderBy(asc(projectsTable.name));

  return res.json({ projects });
});

// ── GET /settlement-analytics/overview?projectId= ────────────────────────

router.get("/overview", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const pid = projectId;

  const [
    distSummary,
    fiftyPctSummary,
    settlementSummary,
    overrideSummary,
    heldSummary,
    pendingSummary,
    landownerLedgerSummary,
  ] = await Promise.all([
    // Ownership model distribution summary
    db.execute(sql`
      SELECT
        COUNT(*) AS total_records,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE status IN ('pending','partial')) AS pending_count,
        COUNT(*) FILTER (WHERE status = 'carried_forward') AS carried_count,
        COALESCE(SUM(gross_revenue::numeric), 0) AS total_gross,
        COALESCE(SUM(settlement_recommendation::numeric), 0) AS total_recommended,
        COALESCE(SUM(total_paid::numeric), 0) AS total_paid,
        COALESCE(SUM(pending_payable::numeric), 0) AS total_pending,
        COALESCE(SUM(carry_forward_balance::numeric), 0) AS total_carry_forward,
        COUNT(DISTINCT partner_id) AS partner_count,
        MIN(created_at) AS earliest,
        MAX(created_at) AS latest
      FROM distribution_records
      WHERE project_id = ${pid}::uuid AND is_active = true
    `),

    // 50% revenue model summary
    db.execute(sql`
      SELECT
        COUNT(*) AS session_count,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_count,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft_count,
        COALESCE(SUM(gross_revenue::numeric), 0) AS total_gross,
        COALESCE(SUM(landowner_split::numeric), 0) AS total_landowner_split,
        COALESCE(SUM(participant_pool_split::numeric), 0) AS total_participant_split,
        COALESCE(SUM(lca_amount::numeric), 0) AS total_lca,
        COALESCE(SUM(landowner_net::numeric), 0) AS total_landowner_net,
        COALESCE(SUM(epp_total_allocated::numeric), 0) AS total_epp_allocated,
        COALESCE(SUM(epp_remainder::numeric), 0) AS total_epp_remainder
      FROM fifty_pct_sessions
      WHERE project_id = ${pid}::uuid
    `),

    // Settlement records summary
    db.execute(sql`
      SELECT
        COUNT(*) AS total_records,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_count,
        COUNT(*) FILTER (WHERE status = 'overridden') AS overridden_count,
        COUNT(*) FILTER (WHERE status = 'disputed') AS disputed_count,
        COUNT(*) FILTER (WHERE is_overridden = true) AS has_override_count,
        COALESCE(SUM(recommended_amount::numeric), 0) AS total_recommended,
        COALESCE(SUM(actual_amount::numeric), 0) AS total_actual,
        COALESCE(SUM(actual_amount::numeric - recommended_amount::numeric) FILTER (WHERE actual_amount IS NOT NULL AND recommended_amount IS NOT NULL), 0) AS total_deviation,
        SUM(override_count) AS total_override_events
      FROM settlement_records
      WHERE project_id = ${pid}::uuid AND is_active = true
    `),

    // Governance overrides related to settlement
    db.execute(sql`
      SELECT
        COUNT(*) AS total_overrides,
        COUNT(*) FILTER (WHERE module = 'settlement') AS settlement_overrides,
        COUNT(*) FILTER (WHERE module = 'lca') AS lca_overrides,
        COUNT(*) FILTER (WHERE module = 'contributions') AS contribution_overrides,
        MAX(occurred_at) AS latest_override
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
    `),

    // Held distributions
    db.execute(sql`
      SELECT
        COUNT(*) AS held_count,
        COUNT(*) FILTER (WHERE status = 'held') AS active_held,
        COUNT(*) FILTER (WHERE status = 'released') AS released_count,
        COALESCE(SUM(held_amount::numeric) FILTER (WHERE status = 'held'), 0) AS active_held_amount,
        COALESCE(SUM(held_amount::numeric), 0) AS total_held_ever,
        COALESCE(SUM(released_amount::numeric) FILTER (WHERE status = 'released'), 0) AS total_released
      FROM held_distribution_ledger
      WHERE project_id = ${pid}::uuid
    `),

    // Pending payable breakdown by status
    db.execute(sql`
      SELECT
        status,
        COUNT(*) AS cnt,
        COALESCE(SUM(pending_payable::numeric), 0) AS pending_total,
        COALESCE(SUM(carry_forward_balance::numeric), 0) AS carry_total,
        COUNT(DISTINCT partner_id) AS partner_count
      FROM distribution_records
      WHERE project_id = ${pid}::uuid AND is_active = true AND status IN ('pending','partial','carried_forward')
      GROUP BY status
    `),

    // Landowner ledger summary
    db.execute(sql`
      SELECT
        direction,
        entry_type,
        COALESCE(SUM(amount), 0) AS total_amount,
        COUNT(*) AS cnt,
        COUNT(DISTINCT partner_id) AS partner_count
      FROM landowner_ledger_entries
      WHERE project_id = ${pid}::uuid AND status NOT IN ('voided')
      GROUP BY direction, entry_type
    `),
  ]);

  const ds = distSummary.rows[0] as Record<string, unknown>;
  const fps = fiftyPctSummary.rows[0] as Record<string, unknown>;
  const ss = settlementSummary.rows[0] as Record<string, unknown>;
  const os = overrideSummary.rows[0] as Record<string, unknown>;
  const hs = heldSummary.rows[0] as Record<string, unknown>;

  // Pending by status
  const pendingByStatus: Record<string, { count: number; pendingTotal: number; carryTotal: number; partnerCount: number }> = {};
  for (const r of pendingSummary.rows as Record<string, unknown>[]) {
    pendingByStatus[String(r.status)] = {
      count: Number(r.cnt),
      pendingTotal: toF2(toNum(r.pending_total)),
      carryTotal: toF2(toNum(r.carry_total)),
      partnerCount: Number(r.partner_count),
    };
  }

  // Landowner ledger totals
  let totalCredits = 0, totalDebits = 0;
  const ledgerByType: Record<string, { credit: number; debit: number }> = {};
  for (const r of landownerLedgerSummary.rows as Record<string, unknown>[]) {
    const type = String(r.entry_type);
    const dir = String(r.direction);
    const amt = toNum(r.total_amount);
    if (!ledgerByType[type]) ledgerByType[type] = { credit: 0, debit: 0 };
    if (dir === "credit") { ledgerByType[type].credit += amt; totalCredits += amt; }
    else { ledgerByType[type].debit += amt; totalDebits += amt; }
  }

  return res.json({
    project: {
      id: project.id, name: project.name, projectCode: project.projectCode,
      commercialModel: project.commercialModel, lifecycleStatus: project.lifecycleStatus,
      activationStatus: project.activationStatus,
    },
    ownershipModel: {
      totalRecords: Number(ds?.total_records ?? 0),
      paidCount: Number(ds?.paid_count ?? 0),
      pendingCount: Number(ds?.pending_count ?? 0),
      carriedCount: Number(ds?.carried_count ?? 0),
      partnerCount: Number(ds?.partner_count ?? 0),
      totalGross: toF2(toNum(ds?.total_gross)),
      totalRecommended: toF2(toNum(ds?.total_recommended)),
      totalPaid: toF2(toNum(ds?.total_paid)),
      totalPending: toF2(toNum(ds?.total_pending)),
      totalCarryForward: toF2(toNum(ds?.total_carry_forward)),
      paymentRate: ds?.total_recommended && toNum(ds.total_recommended) > 0
        ? toF2((toNum(ds.total_paid) / toNum(ds.total_recommended)) * 100) : 0,
    },
    fiftyPctModel: {
      sessionCount: Number(fps?.session_count ?? 0),
      finalizedCount: Number(fps?.finalized_count ?? 0),
      draftCount: Number(fps?.draft_count ?? 0),
      totalGross: toF2(toNum(fps?.total_gross)),
      totalLandownerSplit: toF2(toNum(fps?.total_landowner_split)),
      totalParticipantSplit: toF2(toNum(fps?.total_participant_split)),
      totalLca: toF2(toNum(fps?.total_lca)),
      totalLandownerNet: toF2(toNum(fps?.total_landowner_net)),
      totalEppAllocated: toF2(toNum(fps?.total_epp_allocated)),
      totalEppRemainder: toF2(toNum(fps?.total_epp_remainder)),
    },
    settlements: {
      totalRecords: Number(ss?.total_records ?? 0),
      finalizedCount: Number(ss?.finalized_count ?? 0),
      overriddenCount: Number(ss?.overridden_count ?? 0),
      disputedCount: Number(ss?.disputed_count ?? 0),
      hasOverrideCount: Number(ss?.has_override_count ?? 0),
      totalRecommended: toF2(toNum(ss?.total_recommended)),
      totalActual: toF2(toNum(ss?.total_actual)),
      totalDeviation: toF2(toNum(ss?.total_deviation)),
      totalOverrideEvents: Number(ss?.total_override_events ?? 0),
    },
    overrides: {
      totalOverrides: Number(os?.total_overrides ?? 0),
      settlementOverrides: Number(os?.settlement_overrides ?? 0),
      lcaOverrides: Number(os?.lca_overrides ?? 0),
      contributionOverrides: Number(os?.contribution_overrides ?? 0),
      latestOverride: os?.latest_override ?? null,
    },
    held: {
      heldCount: Number(hs?.held_count ?? 0),
      activeHeld: Number(hs?.active_held ?? 0),
      releasedCount: Number(hs?.released_count ?? 0),
      activeHeldAmount: toF2(toNum(hs?.active_held_amount)),
      totalHeldEver: toF2(toNum(hs?.total_held_ever)),
      totalReleased: toF2(toNum(hs?.total_released)),
    },
    pendingByStatus,
    landownerLedger: {
      totalCredits: toF2(totalCredits),
      totalDebits: toF2(totalDebits),
      netPosition: toF2(totalCredits - totalDebits),
      byType: Object.entries(ledgerByType).map(([type, v]) => ({
        type, creditTotal: toF2(v.credit), debitTotal: toF2(v.debit), net: toF2(v.credit - v.debit),
      })),
    },
  });
});

// ── GET /settlement-analytics/distributions?projectId=&year= ─────────────

router.get("/distributions", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId, year } = req.query as { projectId?: string; year?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const yearInt = year && year !== "all" ? parseInt(year, 10) : null;
  const pid = projectId;

  const [
    ownershipRecords,
    ownershipMonthly,
    ownershipByPartner,
    fiftyPctSessions,
    fiftyPctMonthly,
  ] = await Promise.all([
    // Ownership model — recent distribution records
    db.execute(sql`
      SELECT
        dr.id, dr.accounting_period_label AS period, dr.period_start, dr.period_end,
        dr.settlement_type, dr.status,
        dr.gross_revenue::numeric AS gross, dr.settlement_recommendation::numeric AS recommended,
        dr.total_paid::numeric AS paid, dr.pending_payable::numeric AS pending,
        dr.prior_carry_forward::numeric AS carry_in, dr.carry_forward_balance::numeric AS carry_out,
        dr.last_payment_date, dr.notes,
        dr.created_at,
        p.name AS partner_name, p.role AS partner_role
      FROM distribution_records dr
      LEFT JOIN partners p ON p.id = dr.partner_id
      WHERE dr.project_id = ${pid}::uuid AND dr.is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM dr.created_at) = ${yearInt}` : sql``}
      ORDER BY dr.created_at DESC
      LIMIT 200
    `),

    // Monthly trend — ownership model
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(gross_revenue::numeric), 0) AS gross,
        COALESCE(SUM(settlement_recommendation::numeric), 0) AS recommended,
        COALESCE(SUM(total_paid::numeric), 0) AS paid,
        COALESCE(SUM(pending_payable::numeric), 0) AS pending,
        COUNT(*) AS record_count,
        COUNT(*) FILTER (WHERE status = 'paid') AS paid_count
      FROM distribution_records
      WHERE project_id = ${pid}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `),

    // Per-partner totals — ownership model
    db.execute(sql`
      SELECT
        p.id AS partner_id, p.name AS partner_name, p.role AS partner_role,
        COUNT(dr.id) AS record_count,
        COALESCE(SUM(dr.gross_revenue::numeric), 0) AS total_gross,
        COALESCE(SUM(dr.settlement_recommendation::numeric), 0) AS total_recommended,
        COALESCE(SUM(dr.total_paid::numeric), 0) AS total_paid,
        COALESCE(SUM(dr.pending_payable::numeric), 0) AS total_pending,
        COALESCE(SUM(dr.carry_forward_balance::numeric), 0) AS total_carry_forward,
        COUNT(*) FILTER (WHERE dr.status = 'paid') AS paid_count,
        COUNT(*) FILTER (WHERE dr.status IN ('pending','partial')) AS pending_count,
        MAX(dr.last_payment_date) AS last_payment_date
      FROM distribution_records dr
      JOIN partners p ON p.id = dr.partner_id
      WHERE dr.project_id = ${pid}::uuid AND dr.is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM dr.created_at) = ${yearInt}` : sql``}
      GROUP BY p.id, p.name, p.role
      ORDER BY SUM(dr.settlement_recommendation::numeric) DESC NULLS LAST
    `),

    // 50% revenue sessions
    db.execute(sql`
      SELECT
        fs.id, fs.period_label AS period, fs.period_start, fs.period_end,
        fs.period_year, fs.status, fs.revenue_source,
        fs.gross_revenue::numeric AS gross,
        fs.landowner_split::numeric AS landowner_split,
        fs.participant_pool_split::numeric AS participant_split,
        fs.lca_amount::numeric AS lca,
        fs.landowner_net::numeric AS landowner_net,
        fs.epp_total_allocated::numeric AS epp_allocated,
        fs.epp_remainder::numeric AS epp_remainder,
        fs.notes, fs.created_at
      FROM fifty_pct_sessions fs
      WHERE fs.project_id = ${pid}::uuid
        ${yearInt ? sql`AND fs.period_year = ${yearInt}` : sql``}
      ORDER BY fs.created_at DESC
      LIMIT 200
    `),

    // 50% monthly trend
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(gross_revenue::numeric), 0) AS gross,
        COALESCE(SUM(landowner_split::numeric), 0) AS landowner_split,
        COALESCE(SUM(participant_pool_split::numeric), 0) AS participant_split,
        COALESCE(SUM(lca_amount::numeric), 0) AS lca,
        COALESCE(SUM(landowner_net::numeric), 0) AS landowner_net,
        COALESCE(SUM(epp_total_allocated::numeric), 0) AS epp_allocated,
        COUNT(*) AS session_count,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized_count
      FROM fifty_pct_sessions
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `),
  ]);

  const mapRow = (r: Record<string, unknown>) => ({
    id: String(r.id),
    period: String(r.period),
    periodStart: r.period_start ? String(r.period_start) : null,
    periodEnd: r.period_end ? String(r.period_end) : null,
    settlementType: r.settlement_type ? String(r.settlement_type) : null,
    status: String(r.status),
    gross: toF2(toNum(r.gross)),
    recommended: toF2(toNum(r.recommended)),
    paid: toF2(toNum(r.paid)),
    pending: toF2(toNum(r.pending)),
    carryIn: toF2(toNum(r.carry_in)),
    carryOut: toF2(toNum(r.carry_out)),
    partnerName: r.partner_name ? String(r.partner_name) : null,
    partnerRole: r.partner_role ? String(r.partner_role) : null,
    lastPaymentDate: r.last_payment_date ? String(r.last_payment_date) : null,
    createdAt: r.created_at ?? null,
  });

  return res.json({
    ownershipModel: {
      records: (ownershipRecords.rows as Record<string, unknown>[]).map(mapRow),
      monthly: (ownershipMonthly.rows as Record<string, unknown>[]).map(r => ({
        month: String(r.month),
        gross: toF2(toNum(r.gross)),
        recommended: toF2(toNum(r.recommended)),
        paid: toF2(toNum(r.paid)),
        pending: toF2(toNum(r.pending)),
        recordCount: Number(r.record_count),
        paidCount: Number(r.paid_count),
      })),
      byPartner: (ownershipByPartner.rows as Record<string, unknown>[]).map(r => ({
        partnerId: String(r.partner_id),
        partnerName: String(r.partner_name),
        partnerRole: String(r.partner_role),
        recordCount: Number(r.record_count),
        totalGross: toF2(toNum(r.total_gross)),
        totalRecommended: toF2(toNum(r.total_recommended)),
        totalPaid: toF2(toNum(r.total_paid)),
        totalPending: toF2(toNum(r.total_pending)),
        totalCarryForward: toF2(toNum(r.total_carry_forward)),
        paidCount: Number(r.paid_count),
        pendingCount: Number(r.pending_count),
        lastPaymentDate: r.last_payment_date ? String(r.last_payment_date) : null,
        paymentRate: toNum(r.total_recommended) > 0
          ? toF2((toNum(r.total_paid) / toNum(r.total_recommended)) * 100) : 0,
      })),
    },
    fiftyPctModel: {
      sessions: (fiftyPctSessions.rows as Record<string, unknown>[]).map(r => ({
        id: String(r.id),
        period: String(r.period),
        periodStart: r.period_start ? String(r.period_start) : null,
        periodEnd: r.period_end ? String(r.period_end) : null,
        periodYear: r.period_year ? Number(r.period_year) : null,
        status: String(r.status),
        revenueSource: String(r.revenue_source),
        gross: toF2(toNum(r.gross)),
        landownerSplit: toF2(toNum(r.landowner_split)),
        participantSplit: toF2(toNum(r.participant_split)),
        lca: toF2(toNum(r.lca)),
        landownerNet: toF2(toNum(r.landowner_net)),
        eppAllocated: toF2(toNum(r.epp_allocated)),
        eppRemainder: toF2(toNum(r.epp_remainder)),
        createdAt: r.created_at ?? null,
      })),
      monthly: (fiftyPctMonthly.rows as Record<string, unknown>[]).map(r => ({
        month: String(r.month),
        gross: toF2(toNum(r.gross)),
        landownerSplit: toF2(toNum(r.landowner_split)),
        participantSplit: toF2(toNum(r.participant_split)),
        lca: toF2(toNum(r.lca)),
        landownerNet: toF2(toNum(r.landowner_net)),
        eppAllocated: toF2(toNum(r.epp_allocated)),
        sessionCount: Number(r.session_count),
        finalizedCount: Number(r.finalized_count),
      })),
    },
  });
});

// ── GET /settlement-analytics/settlements?projectId=&year= ───────────────

router.get("/settlements", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId, year } = req.query as { projectId?: string; year?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const yearInt = year && year !== "all" ? parseInt(year, 10) : null;
  const pid = projectId;

  const [records, byType, deviationSummary] = await Promise.all([
    db.execute(sql`
      SELECT
        sr.id, sr.settlement_type, sr.period_label AS period,
        sr.period_start, sr.period_end, sr.status,
        sr.recommended_amount::numeric AS recommended,
        sr.actual_amount::numeric AS actual,
        sr.is_overridden, sr.override_count, sr.override_remarks,
        sr.last_overridden_at, sr.last_overridden_by_name, sr.last_overridden_by_role,
        sr.finalized_at, sr.finalized_by_name, sr.finalized_by_role,
        sr.notes, sr.created_at,
        p.name AS partner_name, p.role AS partner_role
      FROM settlement_records sr
      LEFT JOIN partners p ON p.id = sr.partner_id
      WHERE sr.project_id = ${pid}::uuid AND sr.is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM sr.created_at) = ${yearInt}` : sql``}
      ORDER BY sr.created_at DESC
      LIMIT 200
    `),

    // By settlement type
    db.execute(sql`
      SELECT
        settlement_type,
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE status = 'finalized') AS finalized,
        COUNT(*) FILTER (WHERE is_overridden = true) AS overridden,
        COALESCE(SUM(recommended_amount::numeric), 0) AS total_recommended,
        COALESCE(SUM(actual_amount::numeric), 0) AS total_actual,
        COALESCE(SUM(actual_amount::numeric - recommended_amount::numeric) FILTER (WHERE actual_amount IS NOT NULL AND recommended_amount IS NOT NULL), 0) AS total_deviation
      FROM settlement_records
      WHERE project_id = ${pid}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY settlement_type
    `),

    // Deviation analysis — overridden records
    db.execute(sql`
      SELECT
        ABS(actual_amount::numeric - recommended_amount::numeric) AS abs_deviation,
        (actual_amount::numeric - recommended_amount::numeric) AS raw_deviation,
        settlement_type, period_label, status
      FROM settlement_records
      WHERE project_id = ${pid}::uuid AND is_overridden = true AND is_active = true
        AND actual_amount IS NOT NULL AND recommended_amount IS NOT NULL
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      ORDER BY ABS(actual_amount::numeric - recommended_amount::numeric) DESC
      LIMIT 20
    `),
  ]);

  return res.json({
    records: (records.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      settlementType: String(r.settlement_type),
      period: String(r.period),
      periodStart: r.period_start ? String(r.period_start) : null,
      periodEnd: r.period_end ? String(r.period_end) : null,
      status: String(r.status),
      recommended: r.recommended != null ? toF2(toNum(r.recommended)) : null,
      actual: r.actual != null ? toF2(toNum(r.actual)) : null,
      deviation: r.recommended != null && r.actual != null
        ? toF2(toNum(r.actual) - toNum(r.recommended)) : null,
      deviationPct: r.recommended != null && r.actual != null && toNum(r.recommended) !== 0
        ? toF2(((toNum(r.actual) - toNum(r.recommended)) / toNum(r.recommended)) * 100) : null,
      isOverridden: Boolean(r.is_overridden),
      overrideCount: Number(r.override_count),
      overrideRemarks: r.override_remarks ? String(r.override_remarks) : null,
      lastOverriddenAt: r.last_overridden_at ?? null,
      lastOverriddenByName: r.last_overridden_by_name ? String(r.last_overridden_by_name) : null,
      lastOverriddenByRole: r.last_overridden_by_role ? String(r.last_overridden_by_role) : null,
      finalizedAt: r.finalized_at ?? null,
      finalizedByName: r.finalized_by_name ? String(r.finalized_by_name) : null,
      partnerName: r.partner_name ? String(r.partner_name) : null,
      partnerRole: r.partner_role ? String(r.partner_role) : null,
      createdAt: r.created_at ?? null,
    })),
    byType: (byType.rows as Record<string, unknown>[]).map(r => ({
      settlementType: String(r.settlement_type),
      count: Number(r.cnt),
      finalized: Number(r.finalized),
      overridden: Number(r.overridden),
      totalRecommended: toF2(toNum(r.total_recommended)),
      totalActual: toF2(toNum(r.total_actual)),
      totalDeviation: toF2(toNum(r.total_deviation)),
      overrideRate: Number(r.cnt) > 0 ? toF2((Number(r.overridden) / Number(r.cnt)) * 100) : 0,
    })),
    topDeviations: (deviationSummary.rows as Record<string, unknown>[]).map(r => ({
      settlementType: String(r.settlement_type),
      period: String(r.period_label),
      absDeviation: toF2(toNum(r.abs_deviation)),
      rawDeviation: toF2(toNum(r.raw_deviation)),
      status: String(r.status),
    })),
  });
});

// ── GET /settlement-analytics/overrides?projectId= ───────────────────────

router.get("/overrides", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [governanceOverrides, settlementEvents, overridesByModule, overridesByActor, monthlyOverrides] = await Promise.all([
    // Governance overrides (all modules)
    db.execute(sql`
      SELECT
        go.id, go.override_type, go.module, go.title, go.description,
        go.override_reason, go.actor_name, go.actor_role,
        go.original_value, go.final_value,
        go.related_table, go.related_record_id,
        go.occurred_at, go.created_at
      FROM governance_overrides go
      WHERE go.project_id = ${pid}::uuid
      ORDER BY go.occurred_at DESC
      LIMIT 200
    `),

    // Settlement override events (immutable audit)
    db.execute(sql`
      SELECT
        soe.id, soe.event_type,
        soe.previous_amount::numeric AS prev_amount,
        soe.new_amount::numeric AS new_amount,
        soe.previous_status, soe.new_status,
        soe.performed_by_name, soe.performed_by_role,
        soe.remarks, soe.performed_at,
        sr.settlement_type, sr.period_label AS period,
        p.name AS partner_name
      FROM settlement_override_events soe
      JOIN settlement_records sr ON sr.id = soe.settlement_record_id
      LEFT JOIN partners p ON p.id = soe.partner_id
      WHERE soe.project_id = ${pid}::uuid
      ORDER BY soe.performed_at DESC
      LIMIT 200
    `),

    // By module
    db.execute(sql`
      SELECT
        module, override_type,
        COUNT(*) AS cnt,
        MAX(occurred_at) AS latest
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
      GROUP BY module, override_type
      ORDER BY COUNT(*) DESC
    `),

    // By actor
    db.execute(sql`
      SELECT
        actor_name, actor_role,
        COUNT(*) AS cnt,
        MAX(occurred_at) AS latest
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid AND actor_name IS NOT NULL
      GROUP BY actor_name, actor_role
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `),

    // Monthly override trend
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', occurred_at), 'YYYY-MM') AS month,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE module = 'settlement') AS settlement,
        COUNT(*) FILTER (WHERE module = 'lca') AS lca,
        COUNT(*) FILTER (WHERE module = 'contributions') AS contributions,
        COUNT(*) FILTER (WHERE module = 'ownership') AS ownership
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
      GROUP BY DATE_TRUNC('month', occurred_at)
      ORDER BY DATE_TRUNC('month', occurred_at)
    `),
  ]);

  return res.json({
    governanceOverrides: (governanceOverrides.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      overrideType: String(r.override_type),
      module: String(r.module),
      title: String(r.title),
      description: r.description ? String(r.description) : null,
      overrideReason: r.override_reason ? String(r.override_reason) : null,
      actorName: r.actor_name ? String(r.actor_name) : null,
      actorRole: r.actor_role ? String(r.actor_role) : null,
      relatedTable: r.related_table ? String(r.related_table) : null,
      occurredAt: r.occurred_at ?? null,
    })),
    settlementEvents: (settlementEvents.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      eventType: String(r.event_type),
      prevAmount: r.prev_amount != null ? toF2(toNum(r.prev_amount)) : null,
      newAmount: r.new_amount != null ? toF2(toNum(r.new_amount)) : null,
      prevStatus: r.previous_status ? String(r.previous_status) : null,
      newStatus: r.new_status ? String(r.new_status) : null,
      performedByName: r.performed_by_name ? String(r.performed_by_name) : null,
      performedByRole: r.performed_by_role ? String(r.performed_by_role) : null,
      remarks: r.remarks ? String(r.remarks) : null,
      settlementType: String(r.settlement_type),
      period: String(r.period),
      partnerName: r.partner_name ? String(r.partner_name) : null,
      performedAt: r.performed_at ?? null,
    })),
    byModule: (overridesByModule.rows as Record<string, unknown>[]).map(r => ({
      module: String(r.module),
      overrideType: String(r.override_type),
      count: Number(r.cnt),
      latest: r.latest ?? null,
    })),
    byActor: (overridesByActor.rows as Record<string, unknown>[]).map(r => ({
      actorName: String(r.actor_name),
      actorRole: r.actor_role ? String(r.actor_role) : null,
      count: Number(r.cnt),
      latest: r.latest ?? null,
    })),
    monthlyTrend: (monthlyOverrides.rows as Record<string, unknown>[]).map(r => ({
      month: String(r.month),
      total: Number(r.total),
      settlement: Number(r.settlement),
      lca: Number(r.lca),
      contributions: Number(r.contributions),
      ownership: Number(r.ownership),
    })),
  });
});

// ── GET /settlement-analytics/landowner?projectId= ───────────────────────

router.get("/landowner", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [entries, byPartner, byEntryType, monthlyTrend] = await Promise.all([
    // Recent ledger entries
    db.execute(sql`
      SELECT
        ll.id, ll.entry_type, ll.direction, ll.amount,
        ll.period_label, ll.revenue_model_type, ll.status,
        ll.recovered_amount, ll.recovery_status,
        ll.notes, ll.created_at,
        p.name AS partner_name, p.role AS partner_role
      FROM landowner_ledger_entries ll
      JOIN partners p ON p.id = ll.partner_id
      WHERE ll.project_id = ${pid}::uuid AND ll.status NOT IN ('voided')
      ORDER BY ll.created_at DESC
      LIMIT 300
    `),

    // Per-partner summary
    db.execute(sql`
      SELECT
        p.id AS partner_id, p.name AS partner_name, p.role AS partner_role,
        COALESCE(SUM(ll.amount) FILTER (WHERE ll.direction = 'credit'), 0) AS total_credits,
        COALESCE(SUM(ll.amount) FILTER (WHERE ll.direction = 'debit'), 0) AS total_debits,
        COALESCE(SUM(ll.amount) FILTER (WHERE ll.entry_type = 'revenue_entitlement' AND ll.direction = 'credit'), 0) AS revenue_entitlement,
        COALESCE(SUM(ll.amount) FILTER (WHERE ll.entry_type = 'operational_burden' AND ll.direction = 'debit'), 0) AS operational_burden,
        COALESCE(SUM(ll.amount) FILTER (WHERE ll.entry_type = 'recoverable_adjustment'), 0) AS recoverable_adj,
        COALESCE(SUM(ll.amount) FILTER (WHERE ll.entry_type = 'lca_credit'), 0) AS lca_credit,
        COALESCE(SUM(ll.recovered_amount), 0) AS total_recovered,
        COUNT(ll.id) AS entry_count
      FROM landowner_ledger_entries ll
      JOIN partners p ON p.id = ll.partner_id
      WHERE ll.project_id = ${pid}::uuid AND ll.status NOT IN ('voided')
      GROUP BY p.id, p.name, p.role
      ORDER BY SUM(ll.amount) FILTER (WHERE ll.direction = 'credit') DESC NULLS LAST
    `),

    // By entry type — totals
    db.execute(sql`
      SELECT
        entry_type, direction,
        COALESCE(SUM(amount), 0) AS total,
        COUNT(*) AS cnt,
        COUNT(DISTINCT partner_id) AS partner_count
      FROM landowner_ledger_entries
      WHERE project_id = ${pid}::uuid AND status NOT IN ('voided')
      GROUP BY entry_type, direction
      ORDER BY entry_type, direction
    `),

    // Monthly trend (credits vs debits)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0) AS credits,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0) AS debits,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'revenue_entitlement'), 0) AS revenue_entitlement,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'operational_burden'), 0) AS operational_burden,
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'lca_credit'), 0) AS lca_credit
      FROM landowner_ledger_entries
      WHERE project_id = ${pid}::uuid AND status NOT IN ('voided')
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `),
  ]);

  return res.json({
    entries: (entries.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      entryType: String(r.entry_type),
      direction: String(r.direction),
      amount: toF2(toNum(r.amount)),
      periodLabel: r.period_label ? String(r.period_label) : null,
      revenueModelType: r.revenue_model_type ? String(r.revenue_model_type) : null,
      status: String(r.status),
      recoveredAmount: toF2(toNum(r.recovered_amount)),
      recoveryStatus: r.recovery_status ? String(r.recovery_status) : null,
      notes: r.notes ? String(r.notes) : null,
      partnerName: String(r.partner_name),
      partnerRole: String(r.partner_role),
      createdAt: r.created_at ?? null,
    })),
    byPartner: (byPartner.rows as Record<string, unknown>[]).map(r => ({
      partnerId: String(r.partner_id),
      partnerName: String(r.partner_name),
      partnerRole: String(r.partner_role),
      totalCredits: toF2(toNum(r.total_credits)),
      totalDebits: toF2(toNum(r.total_debits)),
      netPosition: toF2(toNum(r.total_credits) - toNum(r.total_debits)),
      revenueEntitlement: toF2(toNum(r.revenue_entitlement)),
      operationalBurden: toF2(toNum(r.operational_burden)),
      recoverableAdj: toF2(toNum(r.recoverable_adj)),
      lcaCredit: toF2(toNum(r.lca_credit)),
      totalRecovered: toF2(toNum(r.total_recovered)),
      entryCount: Number(r.entry_count),
    })),
    byEntryType: (() => {
      const m: Record<string, { credit: number; debit: number; count: number; partnerCount: number }> = {};
      for (const r of byEntryType.rows as Record<string, unknown>[]) {
        const t = String(r.entry_type);
        const d = String(r.direction);
        if (!m[t]) m[t] = { credit: 0, debit: 0, count: 0, partnerCount: 0 };
        if (d === "credit") m[t].credit += toNum(r.total);
        else m[t].debit += toNum(r.total);
        m[t].count += Number(r.cnt);
        m[t].partnerCount = Math.max(m[t].partnerCount, Number(r.partner_count));
      }
      return Object.entries(m).map(([type, v]) => ({
        entryType: type,
        creditTotal: toF2(v.credit),
        debitTotal: toF2(v.debit),
        net: toF2(v.credit - v.debit),
        count: v.count,
        partnerCount: v.partnerCount,
      }));
    })(),
    monthlyTrend: (monthlyTrend.rows as Record<string, unknown>[]).map(r => ({
      month: String(r.month),
      credits: toF2(toNum(r.credits)),
      debits: toF2(toNum(r.debits)),
      net: toF2(toNum(r.credits) - toNum(r.debits)),
      revenueEntitlement: toF2(toNum(r.revenue_entitlement)),
      operationalBurden: toF2(toNum(r.operational_burden)),
      lcaCredit: toF2(toNum(r.lca_credit)),
    })),
  });
});

// ── GET /settlement-analytics/epp?projectId= ─────────────────────────────

router.get("/epp", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [sessions, entries, byPartner, monthlyEpp] = await Promise.all([
    // 50% sessions with EPP detail
    db.execute(sql`
      SELECT
        fs.id, fs.period_label AS period, fs.period_year, fs.status,
        fs.gross_revenue::numeric AS gross,
        fs.participant_pool_split::numeric AS pool_split,
        fs.epp_total_allocated::numeric AS epp_allocated,
        fs.epp_remainder::numeric AS epp_remainder,
        fs.landowner_split::numeric AS landowner_split,
        fs.lca_amount::numeric AS lca,
        fs.landowner_net::numeric AS landowner_net,
        fs.created_at
      FROM fifty_pct_sessions fs
      WHERE fs.project_id = ${pid}::uuid
      ORDER BY fs.created_at DESC
    `),

    // All EPP entries across sessions
    db.execute(sql`
      SELECT
        e.id, e.session_id, e.partner_id, e.contribution_type, e.is_landowner_additional,
        e.allocated_amount::numeric AS allocated,
        e.created_at,
        p.name AS partner_name, p.role AS partner_role,
        fs.period_label AS period
      FROM epp_entries e
      JOIN fifty_pct_sessions fs ON fs.id = e.session_id
      LEFT JOIN partners p ON p.id = e.partner_id
      WHERE e.project_id = ${pid}::uuid
      ORDER BY e.created_at DESC
      LIMIT 300
    `),

    // Per-partner EPP totals
    db.execute(sql`
      SELECT
        e.partner_id,
        p.name AS partner_name, p.role AS partner_role,
        e.contribution_type,
        e.is_landowner_additional,
        COALESCE(SUM(e.allocated_amount::numeric), 0) AS total_allocated,
        COUNT(DISTINCT e.session_id) AS session_count
      FROM epp_entries e
      LEFT JOIN partners p ON p.id = e.partner_id
      WHERE e.project_id = ${pid}::uuid
      GROUP BY e.partner_id, p.name, p.role, e.contribution_type, e.is_landowner_additional
      ORDER BY SUM(e.allocated_amount::numeric) DESC NULLS LAST
    `),

    // Monthly EPP trend
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', fs.created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(fs.gross_revenue::numeric), 0) AS gross,
        COALESCE(SUM(fs.participant_pool_split::numeric), 0) AS pool_split,
        COALESCE(SUM(fs.epp_total_allocated::numeric), 0) AS epp_allocated,
        COALESCE(SUM(fs.epp_remainder::numeric), 0) AS epp_remainder,
        COUNT(fs.id) AS session_count
      FROM fifty_pct_sessions fs
      WHERE fs.project_id = ${pid}::uuid
      GROUP BY DATE_TRUNC('month', fs.created_at)
      ORDER BY DATE_TRUNC('month', fs.created_at)
    `),
  ]);

  // Group per-partner EPP data
  const partnerMap: Record<string, {
    partnerId: string; partnerName: string; partnerRole: string;
    totalAllocated: number; sessionCount: number; isLandownerAdditional: boolean; contributionType: string;
  }> = {};
  for (const r of byPartner.rows as Record<string, unknown>[]) {
    const key = `${r.partner_id}-${r.contribution_type}`;
    partnerMap[key] = {
      partnerId: String(r.partner_id),
      partnerName: r.partner_name ? String(r.partner_name) : "Unknown",
      partnerRole: r.partner_role ? String(r.partner_role) : "—",
      totalAllocated: toF2(toNum(r.total_allocated)),
      sessionCount: Number(r.session_count),
      isLandownerAdditional: Boolean(r.is_landowner_additional),
      contributionType: String(r.contribution_type),
    };
  }

  return res.json({
    sessions: (sessions.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      period: String(r.period),
      periodYear: r.period_year ? Number(r.period_year) : null,
      status: String(r.status),
      gross: toF2(toNum(r.gross)),
      poolSplit: toF2(toNum(r.pool_split)),
      eppAllocated: toF2(toNum(r.epp_allocated)),
      eppRemainder: toF2(toNum(r.epp_remainder)),
      landownerSplit: toF2(toNum(r.landowner_split)),
      lca: toF2(toNum(r.lca)),
      landownerNet: toF2(toNum(r.landowner_net)),
      utilizationPct: toNum(r.pool_split) > 0
        ? toF2((toNum(r.epp_allocated) / toNum(r.pool_split)) * 100) : 0,
      createdAt: r.created_at ?? null,
    })),
    entries: (entries.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      partnerId: r.partner_id ? String(r.partner_id) : null,
      partnerName: r.partner_name ? String(r.partner_name) : "Unknown",
      partnerRole: r.partner_role ? String(r.partner_role) : "—",
      contributionType: String(r.contribution_type),
      isLandownerAdditional: Boolean(r.is_landowner_additional),
      allocated: toF2(toNum(r.allocated)),
      period: String(r.period),
      createdAt: r.created_at ?? null,
    })),
    byPartner: Object.values(partnerMap),
    monthlyTrend: (monthlyEpp.rows as Record<string, unknown>[]).map(r => ({
      month: String(r.month),
      gross: toF2(toNum(r.gross)),
      poolSplit: toF2(toNum(r.pool_split)),
      eppAllocated: toF2(toNum(r.epp_allocated)),
      eppRemainder: toF2(toNum(r.epp_remainder)),
      sessionCount: Number(r.session_count),
    })),
    totalSessions: sessions.rows.length,
    totalAllocated: toF2(
      (sessions.rows as Record<string, unknown>[]).reduce((s, r) => s + toNum(r.epp_allocated), 0)
    ),
    totalRemainder: toF2(
      (sessions.rows as Record<string, unknown>[]).reduce((s, r) => s + toNum(r.epp_remainder), 0)
    ),
  });
});

// ── GET /settlement-analytics/pending?projectId= ─────────────────────────

router.get("/pending", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const pid = projectId;

  const [pendingRecords, heldRecords, paymentEvents, agingSummary] = await Promise.all([
    // Pending payable distribution records
    db.execute(sql`
      SELECT
        dr.id, dr.accounting_period_label AS period, dr.settlement_type, dr.status,
        dr.settlement_recommendation::numeric AS recommended,
        dr.total_paid::numeric AS paid,
        dr.pending_payable::numeric AS pending,
        dr.prior_carry_forward::numeric AS carry_in,
        dr.carry_forward_balance::numeric AS carry_out,
        dr.last_payment_date, dr.last_payment_ref,
        dr.notes, dr.created_at,
        p.name AS partner_name, p.role AS partner_role,
        EXTRACT(DAY FROM NOW() - dr.created_at)::integer AS age_days
      FROM distribution_records dr
      LEFT JOIN partners p ON p.id = dr.partner_id
      WHERE dr.project_id = ${pid}::uuid AND dr.is_active = true
        AND dr.status IN ('pending','partial','carried_forward')
        AND dr.pending_payable::numeric > 0
      ORDER BY dr.created_at ASC
    `),

    // Held distributions
    db.execute(sql`
      SELECT
        hdl.id, hdl.hold_reason, hdl.status,
        hdl.held_amount::numeric AS held_amount,
        hdl.ownership_pct_at_hold::numeric AS ownership_pct,
        hdl.released_at, hdl.released_amount::numeric AS released_amount,
        hdl.released_to, hdl.released_by_name,
        hdl.created_at,
        p.name AS partner_name, p.role AS partner_role
      FROM held_distribution_ledger hdl
      LEFT JOIN partners p ON p.id = hdl.partner_id
      WHERE hdl.project_id = ${pid}::uuid
      ORDER BY hdl.created_at DESC
    `),

    // Recent payment events
    db.execute(sql`
      SELECT
        dpe.id, dpe.event_type,
        dpe.payment_amount::numeric AS amount,
        dpe.cumulative_paid::numeric AS cumulative_paid,
        dpe.remaining_balance::numeric AS remaining,
        dpe.previous_status, dpe.new_status,
        dpe.payment_date, dpe.payment_ref, dpe.remarks,
        dpe.performed_by_name, dpe.performed_by_role,
        dpe.performed_at,
        p.name AS partner_name
      FROM distribution_payment_events dpe
      LEFT JOIN partners p ON p.id = dpe.partner_id
      WHERE dpe.project_id = ${pid}::uuid
        AND dpe.event_type IN ('payment_recorded','partial_payment','carried_forward')
      ORDER BY dpe.performed_at DESC
      LIMIT 100
    `),

    // Aging summary (0-30, 31-90, 91-180, 180+)
    db.execute(sql`
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM NOW() - created_at) <= 30 THEN '0-30 days'
          WHEN EXTRACT(DAY FROM NOW() - created_at) <= 90 THEN '31-90 days'
          WHEN EXTRACT(DAY FROM NOW() - created_at) <= 180 THEN '91-180 days'
          ELSE '180+ days'
        END AS aging_bucket,
        COUNT(*) AS cnt,
        COALESCE(SUM(pending_payable::numeric), 0) AS total_pending,
        COUNT(DISTINCT partner_id) AS partner_count
      FROM distribution_records
      WHERE project_id = ${pid}::uuid AND is_active = true
        AND status IN ('pending','partial','carried_forward') AND pending_payable::numeric > 0
      GROUP BY aging_bucket
      ORDER BY MIN(EXTRACT(DAY FROM NOW() - created_at))
    `),
  ]);

  return res.json({
    pendingRecords: (pendingRecords.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      period: String(r.period),
      settlementType: r.settlement_type ? String(r.settlement_type) : null,
      status: String(r.status),
      recommended: toF2(toNum(r.recommended)),
      paid: toF2(toNum(r.paid)),
      pending: toF2(toNum(r.pending)),
      carryIn: toF2(toNum(r.carry_in)),
      carryOut: toF2(toNum(r.carry_out)),
      lastPaymentDate: r.last_payment_date ? String(r.last_payment_date) : null,
      lastPaymentRef: r.last_payment_ref ? String(r.last_payment_ref) : null,
      partnerName: r.partner_name ? String(r.partner_name) : null,
      partnerRole: r.partner_role ? String(r.partner_role) : null,
      ageDays: Number(r.age_days),
      createdAt: r.created_at ?? null,
    })),
    heldRecords: (heldRecords.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      holdReason: String(r.hold_reason),
      status: String(r.status),
      heldAmount: toF2(toNum(r.held_amount)),
      ownershipPct: r.ownership_pct ? toF2(toNum(r.ownership_pct)) : null,
      releasedAt: r.released_at ?? null,
      releasedAmount: r.released_amount ? toF2(toNum(r.released_amount)) : null,
      releasedTo: r.released_to ? String(r.released_to) : null,
      releasedByName: r.released_by_name ? String(r.released_by_name) : null,
      partnerName: r.partner_name ? String(r.partner_name) : null,
      partnerRole: r.partner_role ? String(r.partner_role) : null,
      createdAt: r.created_at ?? null,
    })),
    paymentEvents: (paymentEvents.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      eventType: String(r.event_type),
      amount: r.amount != null ? toF2(toNum(r.amount)) : null,
      cumulativePaid: r.cumulative_paid != null ? toF2(toNum(r.cumulative_paid)) : null,
      remaining: r.remaining != null ? toF2(toNum(r.remaining)) : null,
      prevStatus: r.previous_status ? String(r.previous_status) : null,
      newStatus: r.new_status ? String(r.new_status) : null,
      paymentDate: r.payment_date ? String(r.payment_date) : null,
      paymentRef: r.payment_ref ? String(r.payment_ref) : null,
      remarks: r.remarks ? String(r.remarks) : null,
      performedByName: r.performed_by_name ? String(r.performed_by_name) : null,
      partnerName: r.partner_name ? String(r.partner_name) : null,
      performedAt: r.performed_at ?? null,
    })),
    agingSummary: (agingSummary.rows as Record<string, unknown>[]).map(r => ({
      bucket: String(r.aging_bucket),
      count: Number(r.cnt),
      totalPending: toF2(toNum(r.total_pending)),
      partnerCount: Number(r.partner_count),
    })),
    totals: {
      totalPending: toF2(
        (pendingRecords.rows as Record<string, unknown>[]).reduce((s, r) => s + toNum(r.pending), 0)
      ),
      totalHeldActive: toF2(
        (heldRecords.rows as Record<string, unknown>[])
          .filter(r => String(r.status) === "held")
          .reduce((s, r) => s + toNum(r.held_amount), 0)
      ),
      pendingRecordCount: pendingRecords.rows.length,
      activeHeldCount: (heldRecords.rows as Record<string, unknown>[]).filter(r => String(r.status) === "held").length,
    },
  });
});

export default router;

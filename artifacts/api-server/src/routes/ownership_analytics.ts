/**
 * ownership_analytics.ts
 *
 * Ownership & Economic Participation Analytics API.
 * Role-aware: admin/developer see all; others see assigned projects only.
 *
 * Endpoints:
 *   GET /ownership-analytics/projects                 — list accessible projects
 *   GET /ownership-analytics/overview?projectId=      — ownership states, freeze, contributions summary, snapshots, transfers, inheritance
 *   GET /ownership-analytics/contributions?projectId=&year= — contribution trends separated by type (land / economic / operational)
 *   GET /ownership-analytics/snapshots?projectId=     — ownership snapshot timeline (point-in-time history)
 *   GET /ownership-analytics/transfers?projectId=     — transfer history with ROFR / status tracking
 *   GET /ownership-analytics/inheritance?projectId=   — inheritance claims + ownership history
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  usersTable,
  projectsTable,
  userProjectAssignmentsTable,
  partnersTable,
  contributionsTable,
  ownershipSnapshotsTable,
  partnerOwnershipStatesTable,
  ownershipTransfersTable,
  projectOwnershipFreezesTable,
  inheritanceOwnershipHistoryTable,
  inheritanceClaimsTable,
} from "@workspace/db";
import { eq, and, inArray, isNull, sql, desc, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────
const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toF = (v: number) => parseFloat(v.toFixed(4));
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
  if (isPrivileged(actor.role)) return null; // null = all projects
  return getAssignedIds(actor.id);
}

async function checkProjectAccess(actor: { role: string; id: string }, projectId: string): Promise<boolean> {
  if (isPrivileged(actor.role)) return true;
  const ids = await getAssignedIds(actor.id);
  return ids.includes(projectId);
}

// ── GET /ownership-analytics/projects ────────────────────────────────────

router.get("/projects", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });
  const allowed = await resolveAllowedIds(actor);

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

// ── GET /ownership-analytics/overview?projectId= ─────────────────────────

router.get("/overview", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const pid = projectId;

  const [
    ownershipStates,
    freezeRecord,
    contributionSummary,
    snapshotSummary,
    latestSnapshot,
    transferSummary,
    inheritanceSummary,
    participantsSummary,
  ] = await Promise.all([
    // Current partner ownership states
    db.execute(sql`
      SELECT
        pos.id, pos.partner_id, pos.partner_name,
        pos.total_percentage::numeric AS total_pct,
        pos.transferable_percentage::numeric AS transferable_pct,
        pos.locked_percentage::numeric AS locked_pct,
        pos.disputed_percentage::numeric AS disputed_pct,
        pos.reserved_percentage::numeric AS reserved_pct,
        pos.dispute_reason, pos.disputed_since,
        p.role AS partner_role, p.email AS partner_email
      FROM partner_ownership_states pos
      JOIN partners p ON p.id = pos.partner_id
      WHERE pos.project_id = ${pid}::uuid
      ORDER BY pos.total_percentage DESC
    `),

    // Freeze status
    db.select().from(projectOwnershipFreezesTable)
      .where(eq(projectOwnershipFreezesTable.projectId, projectId)).limit(1),

    // Contribution summary by type
    db.execute(sql`
      SELECT
        contribution_type,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified' AND is_active = true), 0)::numeric AS verified_total,
        COALESCE(SUM(amount) FILTER (WHERE is_active = true), 0)::numeric AS gross_total,
        COUNT(*) FILTER (WHERE verification_status = 'verified' AND is_active = true) AS verified_count,
        COUNT(*) FILTER (WHERE is_active = true) AS total_count,
        COUNT(DISTINCT partner_id) FILTER (WHERE is_active = true) AS partner_count
      FROM contributions
      WHERE project_id = ${pid}::uuid
      GROUP BY contribution_type
    `),

    // Snapshot count and range
    db.execute(sql`
      SELECT
        COUNT(*) AS snap_count,
        MIN(snapshot_at) AS earliest,
        MAX(snapshot_at) AS latest,
        MAX(total_recognized_amount) AS max_total,
        MAX(land_total) AS max_land,
        MAX(economic_total) AS max_economic
      FROM ownership_snapshots
      WHERE project_id = ${pid}::uuid
    `),

    // Latest snapshot entries
    db.select().from(ownershipSnapshotsTable)
      .where(eq(ownershipSnapshotsTable.projectId, projectId))
      .orderBy(desc(ownershipSnapshotsTable.snapshotAt))
      .limit(1),

    // Transfer summary
    db.execute(sql`
      SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE status = 'executed') AS executed_count,
        COUNT(*) FILTER (WHERE status IN ('draft','pending_rofr','pending_approval','approved')) AS pending_count,
        COALESCE(SUM(offered_percentage::numeric) FILTER (WHERE status = 'executed'), 0) AS total_pct_transferred,
        COALESCE(SUM(payable_amount::numeric) FILTER (WHERE status = 'executed'), 0) AS total_value_transferred,
        COALESCE(SUM(paid_amount::numeric) FILTER (WHERE status = 'executed'), 0) AS total_paid
      FROM ownership_transfers
      WHERE project_id = ${pid}::uuid
    `),

    // Inheritance summary
    db.execute(sql`
      SELECT
        COUNT(DISTINCT c.id) AS claim_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'approved') AS approved_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'open') AS open_count,
        COUNT(h.id) AS history_count,
        COALESCE(SUM(h.share_percentage::numeric), 0) AS total_transferred_pct
      FROM inheritance_claims c
      FULL OUTER JOIN inheritance_ownership_history h ON h.claim_id = c.id
      WHERE COALESCE(c.project_id, h.project_id) = ${pid}::uuid
    `),

    // Total participants + contribution counts
    db.execute(sql`
      SELECT
        COUNT(DISTINCT partner_id) FILTER (WHERE contribution_type = 'land_notional' AND verification_status = 'verified' AND is_active = true) AS land_partners,
        COUNT(DISTINCT partner_id) FILTER (WHERE contribution_type = 'economic_investment' AND verification_status = 'verified' AND is_active = true) AS economic_partners,
        COUNT(DISTINCT partner_id) FILTER (WHERE contribution_type = 'operational_cost' AND is_active = true) AS operational_partners,
        COUNT(DISTINCT partner_id) FILTER (WHERE affects_ownership = true AND verification_status = 'verified' AND is_active = true) AS ownership_partners
      FROM contributions
      WHERE project_id = ${pid}::uuid
    `),
  ]);

  const freeze = freezeRecord[0] ?? null;
  const latestSnap = latestSnapshot[0] ?? null;
  const ss = snapshotSummary.rows[0] as Record<string, unknown>;
  const ts = transferSummary.rows[0] as Record<string, unknown>;
  const is = inheritanceSummary.rows[0] as Record<string, unknown>;
  const ps = participantsSummary.rows[0] as Record<string, unknown>;

  // Build contribution summary map
  const contribByType: Record<string, { verifiedTotal: number; grossTotal: number; verifiedCount: number; totalCount: number; partnerCount: number }> = {};
  for (const r of contributionSummary.rows as Record<string, unknown>[]) {
    contribByType[String(r.contribution_type)] = {
      verifiedTotal: toF2(toNum(r.verified_total)),
      grossTotal: toF2(toNum(r.gross_total)),
      verifiedCount: Number(r.verified_count),
      totalCount: Number(r.total_count),
      partnerCount: Number(r.partner_count),
    };
  }

  const states = (ownershipStates.rows as Record<string, unknown>[]).map(r => ({
    partnerId: String(r.partner_id),
    partnerName: String(r.partner_name),
    partnerRole: String(r.partner_role),
    partnerEmail: r.partner_email ? String(r.partner_email) : null,
    totalPct: toF(toNum(r.total_pct)),
    transferablePct: toF(toNum(r.transferable_pct)),
    lockedPct: toF(toNum(r.locked_pct)),
    disputedPct: toF(toNum(r.disputed_pct)),
    reservedPct: toF(toNum(r.reserved_pct)),
    hasDispute: toNum(r.disputed_pct) > 0,
    disputeReason: r.dispute_reason ? String(r.dispute_reason) : null,
  }));

  const totalOwnershipPct = states.reduce((s, p) => s + p.totalPct, 0);

  req.log.info({ endpoint: "ownership-analytics/overview", projectId: pid }, "Ownership overview fetched");

  return res.json({
    project: {
      id: project.id, name: project.name, projectCode: project.projectCode,
      commercialModel: project.commercialModel, lifecycleStatus: project.lifecycleStatus,
      activationStatus: project.activationStatus, startDate: project.startDate,
    },
    ownershipStates: states,
    totalOwnershipPct: toF(totalOwnershipPct),
    unallocatedPct: toF(Math.max(0, 100 - totalOwnershipPct)),
    freeze: freeze ? {
      id: freeze.id, status: freeze.status,
      frozenAt: freeze.frozenAt, frozenByName: freeze.frozenByName, notes: freeze.notes,
    } : null,
    contributions: {
      land: contribByType["land_notional"] ?? { verifiedTotal: 0, grossTotal: 0, verifiedCount: 0, totalCount: 0, partnerCount: 0 },
      economic: contribByType["economic_investment"] ?? { verifiedTotal: 0, grossTotal: 0, verifiedCount: 0, totalCount: 0, partnerCount: 0 },
      operational: contribByType["operational_cost"] ?? { verifiedTotal: 0, grossTotal: 0, verifiedCount: 0, totalCount: 0, partnerCount: 0 },
      totalVerified: toF2(
        toNum(contribByType["land_notional"]?.verifiedTotal) +
        toNum(contribByType["economic_investment"]?.verifiedTotal)
      ),
    },
    snapshots: {
      count: Number(ss?.snap_count ?? 0),
      earliest: ss?.earliest ?? null,
      latest: ss?.latest ?? null,
      maxTotal: toF2(toNum(ss?.max_total)),
      maxLand: toF2(toNum(ss?.max_land)),
      maxEconomic: toF2(toNum(ss?.max_economic)),
      latestEntries: latestSnap?.entries ?? [],
    },
    transfers: {
      total: Number(ts?.total_count ?? 0),
      executed: Number(ts?.executed_count ?? 0),
      pending: Number(ts?.pending_count ?? 0),
      totalPctTransferred: toF2(toNum(ts?.total_pct_transferred)),
      totalValueTransferred: toF2(toNum(ts?.total_value_transferred)),
      totalPaid: toF2(toNum(ts?.total_paid)),
    },
    inheritance: {
      claimCount: Number(is?.claim_count ?? 0),
      approvedCount: Number(is?.approved_count ?? 0),
      openCount: Number(is?.open_count ?? 0),
      historyCount: Number(is?.history_count ?? 0),
      totalTransferredPct: toF2(toNum(is?.total_transferred_pct)),
    },
    participation: {
      landPartners: Number(ps?.land_partners ?? 0),
      economicPartners: Number(ps?.economic_partners ?? 0),
      operationalPartners: Number(ps?.operational_partners ?? 0),
      ownershipPartners: Number(ps?.ownership_partners ?? 0),
    },
  });
});

// ── GET /ownership-analytics/contributions?projectId=&year= ───────────────

router.get("/contributions", requireAuth, async (req, res) => {
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
    byTypeByPartner,
    monthlyTrend,
    phaseBreakdown,
    verificationBreakdown,
    cumulativeTrend,
  ] = await Promise.all([
    // Per-partner breakdown by contribution type
    db.execute(sql`
      SELECT
        c.partner_id, p.name AS partner_name, p.role AS partner_role,
        c.contribution_type,
        COALESCE(SUM(c.amount) FILTER (WHERE c.verification_status = 'verified' AND c.is_active = true), 0)::numeric AS verified,
        COALESCE(SUM(c.amount) FILTER (WHERE c.is_active = true), 0)::numeric AS total,
        COUNT(*) FILTER (WHERE c.verification_status = 'verified' AND c.is_active = true) AS verified_count,
        COUNT(*) FILTER (WHERE c.is_active = true) AS total_count,
        MAX(c.ownership_pct_at_verification) AS ownership_pct
      FROM contributions c
      JOIN partners p ON p.id = c.partner_id
      WHERE c.project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM c.created_at) = ${yearInt}` : sql``}
      GROUP BY c.partner_id, p.name, p.role, c.contribution_type
      ORDER BY p.name, c.contribution_type
    `),

    // Monthly contribution trend by type
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        contribution_type,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified' AND is_active = true), 0)::numeric AS verified,
        COALESCE(SUM(amount) FILTER (WHERE is_active = true), 0)::numeric AS total,
        COUNT(*) FILTER (WHERE is_active = true) AS cnt
      FROM contributions
      WHERE project_id = ${pid}::uuid
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY DATE_TRUNC('month', created_at), contribution_type
      ORDER BY DATE_TRUNC('month', created_at), contribution_type
    `),

    // Phase breakdown (prematurity vs mature_production)
    db.execute(sql`
      SELECT
        lifecycle_phase_snapshot AS phase,
        contribution_type,
        COALESCE(SUM(amount) FILTER (WHERE verification_status = 'verified' AND is_active = true), 0)::numeric AS verified,
        COALESCE(SUM(amount) FILTER (WHERE is_active = true), 0)::numeric AS total,
        COUNT(*) FILTER (WHERE is_active = true) AS cnt
      FROM contributions
      WHERE project_id = ${pid}::uuid
      GROUP BY lifecycle_phase_snapshot, contribution_type
      ORDER BY lifecycle_phase_snapshot, contribution_type
    `),

    // Verification status breakdown
    db.execute(sql`
      SELECT
        contribution_type,
        verification_status,
        COALESCE(SUM(amount), 0)::numeric AS total,
        COUNT(*) AS cnt
      FROM contributions
      WHERE project_id = ${pid}::uuid AND is_active = true
        ${yearInt ? sql`AND EXTRACT(YEAR FROM created_at) = ${yearInt}` : sql``}
      GROUP BY contribution_type, verification_status
      ORDER BY contribution_type, verification_status
    `),

    // Cumulative running total by type (for timeline chart)
    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        contribution_type,
        SUM(SUM(amount) FILTER (WHERE verification_status = 'verified' AND is_active = true))
          OVER (PARTITION BY contribution_type ORDER BY DATE_TRUNC('month', created_at))::numeric AS cumulative
      FROM contributions
      WHERE project_id = ${pid}::uuid
      GROUP BY DATE_TRUNC('month', created_at), contribution_type
      ORDER BY DATE_TRUNC('month', created_at), contribution_type
    `),
  ]);

  // Pivot per-partner data by type
  const partnerMap: Record<string, {
    partnerId: string; partnerName: string; partnerRole: string;
    land: { verified: number; total: number; count: number };
    economic: { verified: number; total: number; count: number };
    operational: { verified: number; total: number; count: number };
    ownershipPct: number;
  }> = {};
  for (const r of byTypeByPartner.rows as Record<string, unknown>[]) {
    const pid2 = String(r.partner_id);
    if (!partnerMap[pid2]) {
      partnerMap[pid2] = {
        partnerId: pid2,
        partnerName: String(r.partner_name),
        partnerRole: String(r.partner_role),
        land: { verified: 0, total: 0, count: 0 },
        economic: { verified: 0, total: 0, count: 0 },
        operational: { verified: 0, total: 0, count: 0 },
        ownershipPct: 0,
      };
    }
    if (r.ownership_pct) partnerMap[pid2].ownershipPct = toNum(r.ownership_pct);
    const type = String(r.contribution_type);
    if (type === "land_notional") {
      partnerMap[pid2].land = { verified: toF2(toNum(r.verified)), total: toF2(toNum(r.total)), count: Number(r.verified_count) };
    } else if (type === "economic_investment") {
      partnerMap[pid2].economic = { verified: toF2(toNum(r.verified)), total: toF2(toNum(r.total)), count: Number(r.verified_count) };
    } else if (type === "operational_cost") {
      partnerMap[pid2].operational = { verified: toF2(toNum(r.verified)), total: toF2(toNum(r.total)), count: Number(r.total_count) };
    }
  }
  const byPartner = Object.values(partnerMap).sort((a, b) =>
    (b.land.verified + b.economic.verified) - (a.land.verified + a.economic.verified)
  );

  // Pivot monthly trend by type
  const monthSet = new Set((monthlyTrend.rows as Record<string, unknown>[]).map(r => String(r.month)));
  const monthlyByType: Record<string, { land: number; economic: number; operational: number; landVerified: number; economicVerified: number }> = {};
  for (const month of monthSet) monthlyByType[month] = { land: 0, economic: 0, operational: 0, landVerified: 0, economicVerified: 0 };
  for (const r of monthlyTrend.rows as Record<string, unknown>[]) {
    const m = String(r.month); const t = String(r.contribution_type);
    if (t === "land_notional") { monthlyByType[m].land = toF2(toNum(r.total)); monthlyByType[m].landVerified = toF2(toNum(r.verified)); }
    if (t === "economic_investment") { monthlyByType[m].economic = toF2(toNum(r.total)); monthlyByType[m].economicVerified = toF2(toNum(r.verified)); }
    if (t === "operational_cost") monthlyByType[m].operational = toF2(toNum(r.total));
  }
  const monthlyTrendPivot = Array.from(monthSet).sort().map(m => ({ month: m, ...monthlyByType[m] }));

  // Cumulative trend pivot
  const cumMonthSet = new Set((cumulativeTrend.rows as Record<string, unknown>[]).map(r => String(r.month)));
  const cumByMonth: Record<string, { land: number; economic: number; operational: number }> = {};
  for (const m of cumMonthSet) cumByMonth[m] = { land: 0, economic: 0, operational: 0 };
  for (const r of cumulativeTrend.rows as Record<string, unknown>[]) {
    const m = String(r.month); const t = String(r.contribution_type);
    if (t === "land_notional") cumByMonth[m].land = toF2(toNum(r.cumulative));
    if (t === "economic_investment") cumByMonth[m].economic = toF2(toNum(r.cumulative));
    if (t === "operational_cost") cumByMonth[m].operational = toF2(toNum(r.cumulative));
  }
  const cumulativePivot = Array.from(cumMonthSet).sort().map(m => ({ month: m, ...cumByMonth[m] }));

  // Phase breakdown pivot
  const phaseData: Record<string, { land: number; economic: number; operational: number }> = {};
  for (const r of phaseBreakdown.rows as Record<string, unknown>[]) {
    const ph = String(r.phase); const t = String(r.contribution_type);
    if (!phaseData[ph]) phaseData[ph] = { land: 0, economic: 0, operational: 0 };
    if (t === "land_notional") phaseData[ph].land = toF2(toNum(r.verified));
    if (t === "economic_investment") phaseData[ph].economic = toF2(toNum(r.verified));
    if (t === "operational_cost") phaseData[ph].operational = toF2(toNum(r.total));
  }
  const phaseBreakdownPivot = Object.entries(phaseData).map(([phase, data]) => ({
    phase: phase.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), ...data,
    total: toF2(data.land + data.economic),
  }));

  return res.json({ byPartner, monthlyTrend: monthlyTrendPivot, cumulativeTrend: cumulativePivot, phaseBreakdown: phaseBreakdownPivot });
});

// ── GET /ownership-analytics/snapshots?projectId= ─────────────────────────

router.get("/snapshots", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const snapshots = await db.select().from(ownershipSnapshotsTable)
    .where(eq(ownershipSnapshotsTable.projectId, projectId))
    .orderBy(asc(ownershipSnapshotsTable.snapshotAt));

  // Collect all unique partner names across all snapshots for timeline charting
  const partnerNames = new Set<string>();
  for (const s of snapshots) {
    for (const e of s.entries) partnerNames.add(e.partnerName);
  }

  // Build timeline data: each snapshot → flat object with partner % values
  const timeline = snapshots.map(s => {
    const point: Record<string, unknown> = {
      snapshotAt: s.snapshotAt,
      snapshotType: s.snapshotType,
      lifecycleStatus: s.lifecycleStatus,
      landTotal: toF2(s.landTotal),
      economicTotal: toF2(s.economicTotal),
      totalRecognizedAmount: toF2(s.totalRecognizedAmount),
      label: new Date(s.snapshotAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    };
    for (const e of s.entries) {
      point[e.partnerName] = e.percentage;
      point[`${e.partnerName}_land`] = e.landAmount;
      point[`${e.partnerName}_economic`] = e.economicAmount;
    }
    return point;
  });

  return res.json({
    snapshots: snapshots.map(s => ({
      id: s.id,
      snapshotType: s.snapshotType,
      lifecycleStatus: s.lifecycleStatus,
      landTotal: toF2(s.landTotal),
      economicTotal: toF2(s.economicTotal),
      totalRecognizedAmount: toF2(s.totalRecognizedAmount),
      entries: s.entries,
      notes: s.notes,
      triggeredByName: s.triggeredByName,
      snapshotAt: s.snapshotAt,
    })),
    timeline,
    partnerNames: Array.from(partnerNames),
    count: snapshots.length,
  });
});

// ── GET /ownership-analytics/transfers?projectId= ─────────────────────────

router.get("/transfers", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const [transfers, statusSummary, typeSummary] = await Promise.all([
    db.execute(sql`
      SELECT
        ot.id, ot.transferor_partner_id, ot.transferor_name,
        ot.offered_percentage::numeric AS offered_pct,
        ot.offered_value::numeric AS offered_value,
        ot.transfer_type, ot.transfer_mode, ot.status,
        ot.reason, ot.executed_at, ot.executed_by_name,
        ot.transfer_value::numeric AS transfer_value,
        ot.payable_amount::numeric AS payable_amount,
        ot.paid_amount::numeric AS paid_amount,
        ot.effective_date, ot.created_at,
        p.name AS transferor_full_name, p.role AS transferor_role
      FROM ownership_transfers ot
      LEFT JOIN partners p ON p.id = ot.transferor_partner_id
      WHERE ot.project_id = ${projectId}::uuid
      ORDER BY ot.created_at DESC
    `),

    db.execute(sql`
      SELECT
        status,
        COUNT(*) AS cnt,
        COALESCE(SUM(offered_percentage::numeric), 0) AS total_pct,
        COALESCE(SUM(payable_amount::numeric), 0) AS total_value
      FROM ownership_transfers
      WHERE project_id = ${projectId}::uuid
      GROUP BY status
    `),

    db.execute(sql`
      SELECT
        transfer_type,
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE status = 'executed') AS executed
      FROM ownership_transfers
      WHERE project_id = ${projectId}::uuid
      GROUP BY transfer_type
    `),
  ]);

  type StatusEntry = { count: number; totalPct: number; totalValue: number };
  const statusMap: Record<string, StatusEntry> = {};
  for (const r of statusSummary.rows as Record<string, unknown>[]) {
    statusMap[String(r.status)] = { count: Number(r.cnt), totalPct: toF2(toNum(r.total_pct)), totalValue: toF2(toNum(r.total_value)) };
  }

  return res.json({
    transfers: (transfers.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      transferorPartnerId: String(r.transferor_partner_id),
      transferorName: String(r.transferor_full_name ?? r.transferor_name),
      transferorRole: r.transferor_role ? String(r.transferor_role) : null,
      offeredPct: toF(toNum(r.offered_pct)),
      offeredValue: r.offered_value ? toF2(toNum(r.offered_value)) : null,
      transferType: String(r.transfer_type),
      transferMode: String(r.transfer_mode),
      status: String(r.status),
      reason: r.reason ? String(r.reason) : null,
      executedAt: r.executed_at ?? null,
      executedByName: r.executed_by_name ? String(r.executed_by_name) : null,
      transferValue: r.transfer_value ? toF2(toNum(r.transfer_value)) : null,
      payableAmount: r.payable_amount ? toF2(toNum(r.payable_amount)) : null,
      paidAmount: r.paid_amount ? toF2(toNum(r.paid_amount)) : null,
      effectiveDate: r.effective_date ?? null,
      createdAt: r.created_at ?? null,
    })),
    byStatus: statusMap,
    byType: (typeSummary.rows as Record<string, unknown>[]).map(r => ({
      type: String(r.transfer_type),
      count: Number(r.cnt),
      executed: Number(r.executed),
    })),
    summary: {
      total: transfers.rows.length,
      executed: (statusMap["executed"]?.count ?? 0),
      pending: (statusMap["pending_rofr"]?.count ?? 0) + (statusMap["pending_approval"]?.count ?? 0) + (statusMap["draft"]?.count ?? 0),
      totalPctTransferred: toF2(statusMap["executed"]?.totalPct ?? 0),
      totalValueTransferred: toF2(statusMap["executed"]?.totalValue ?? 0),
    },
  });
});

// ── GET /ownership-analytics/inheritance?projectId= ───────────────────────

router.get("/inheritance", requireAuth, async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  if (!(await checkProjectAccess(actor, projectId))) return res.status(403).json({ error: "Forbidden" });

  const [claims, history, claimSummary] = await Promise.all([
    db.execute(sql`
      SELECT
        ic.id, ic.claim_type, ic.status, ic.created_at, ic.updated_at,
        p.name AS partner_name, p.role AS partner_role
      FROM inheritance_claims ic
      LEFT JOIN partners p ON p.id = ic.partner_id
      WHERE ic.project_id = ${projectId}::uuid
      ORDER BY ic.created_at DESC
    `),

    db.execute(sql`
      SELECT
        h.id, h.claim_id, h.from_partner_id, h.from_partner_name,
        h.share_percentage::numeric AS share_pct,
        h.effective_date, h.created_at,
        c.name AS claimant_name
      FROM inheritance_ownership_history h
      LEFT JOIN partner_claimants c ON c.id = h.claimant_id
      WHERE h.project_id = ${projectId}::uuid
      ORDER BY h.effective_date DESC, h.created_at DESC
    `),

    db.execute(sql`
      SELECT
        status, claim_type,
        COUNT(*) AS cnt
      FROM inheritance_claims
      WHERE project_id = ${projectId}::uuid
      GROUP BY status, claim_type
    `),
  ]);

  const byStatus: Record<string, { count: number; types: string[] }> = {};
  for (const r of claimSummary.rows as Record<string, unknown>[]) {
    const s = String(r.status);
    if (!byStatus[s]) byStatus[s] = { count: 0, types: [] };
    byStatus[s].count += Number(r.cnt);
    byStatus[s].types.push(String(r.claim_type));
  }

  // Group history by decedent (from_partner)
  const byDecedent: Record<string, { fromPartnerId: string; fromPartnerName: string; totalPctTransferred: number; claimants: { claimantName: string; sharePct: number; effectiveDate: string | null; claimId: string }[] }> = {};
  for (const r of history.rows as Record<string, unknown>[]) {
    const fpid = String(r.from_partner_id);
    if (!byDecedent[fpid]) {
      byDecedent[fpid] = { fromPartnerId: fpid, fromPartnerName: String(r.from_partner_name), totalPctTransferred: 0, claimants: [] };
    }
    const pct = toF(toNum(r.share_pct));
    byDecedent[fpid].totalPctTransferred += pct;
    byDecedent[fpid].claimants.push({
      claimantName: r.claimant_name ? String(r.claimant_name) : "Unknown Claimant",
      sharePct: pct,
      effectiveDate: r.effective_date ? String(r.effective_date) : null,
      claimId: String(r.claim_id),
    });
  }

  return res.json({
    claims: (claims.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      claimType: String(r.claim_type),
      status: String(r.status),
      partnerName: r.partner_name ? String(r.partner_name) : null,
      partnerRole: r.partner_role ? String(r.partner_role) : null,
      createdAt: r.created_at ?? null,
      updatedAt: r.updated_at ?? null,
    })),
    history: (history.rows as Record<string, unknown>[]).map(r => ({
      id: String(r.id),
      claimId: String(r.claim_id),
      fromPartnerName: String(r.from_partner_name),
      claimantName: r.claimant_name ? String(r.claimant_name) : "Unknown Claimant",
      sharePct: toF(toNum(r.share_pct)),
      effectiveDate: r.effective_date ? String(r.effective_date) : null,
      createdAt: r.created_at ?? null,
    })),
    byDecedent: Object.values(byDecedent),
    byStatus,
    summary: {
      totalClaims: claims.rows.length,
      totalHistory: history.rows.length,
      totalPctTransferred: toF2(Object.values(byDecedent).reduce((s, d) => s + d.totalPctTransferred, 0)),
      approvedClaims: (byStatus["approved"]?.count ?? 0),
      openClaims: (byStatus["open"]?.count ?? 0),
    },
  });
});

export default router;

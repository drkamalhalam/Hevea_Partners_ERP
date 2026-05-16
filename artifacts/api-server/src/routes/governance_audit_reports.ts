/**
 * governance_audit_reports.ts
 *
 * Governance & Audit Reporting Engine.
 * Legal traceability review — admin/developer roles only.
 *
 * Tables used:
 *   auditLogsTable, governanceOverridesTable
 *   disputesTable, disputeResolutionEventsTable
 *   operationalAlertsTable
 *   projectNomineesTable, nomineeActivationWorkflowsTable
 *   inheritanceClaimsTable, inheritanceClaimantSharesTable,
 *   inheritanceDocumentsTable, partnerClaimantsTable
 *   legalEvidenceArchiveTable, evidenceAccessLogTable
 *   governanceMeetingsTable, governanceResolutionsTable
 *
 * Endpoints:
 *   GET /governance-reports/projects
 *   GET /governance-reports/overview?projectId=
 *   GET /governance-reports/alerts?projectId=
 *   GET /governance-reports/disputes?projectId=
 *   GET /governance-reports/overrides?projectId=
 *   GET /governance-reports/nominees?projectId=
 *   GET /governance-reports/claims?projectId=
 *   GET /governance-reports/evidence?projectId=
 *   GET /governance-reports/audit-log?projectId=&limit=
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, projectsTable } from "@workspace/db";
import { eq, sql, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditMiddleware } from "../middlewares/reportAccessControl";

const router = Router();

const toNum = (v: unknown) => parseFloat(String(v ?? "0")) || 0;
const toF2  = (v: number)  => parseFloat(v.toFixed(2));

async function resolveActor(clerkUserId: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  return u ?? null;
}
const isPrivileged = (r: string) => r === "admin" || r === "developer";

// ── GET /governance-reports/projects ─────────────────────────────────────

router.get("/projects", requireAuth, async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const projects = await db.select({
    id: projectsTable.id, name: projectsTable.name,
    projectCode: projectsTable.projectCode,
    commercialModel: projectsTable.commercialModel,
    lifecycleStatus: projectsTable.lifecycleStatus,
    activationStatus: projectsTable.activationStatus,
  }).from(projectsTable).where(eq(projectsTable.isActive, true)).orderBy(asc(projectsTable.name));

  return res.json({ projects });
});

// ── GET /governance-reports/overview?projectId= ───────────────────────────

router.get("/overview", requireAuth, requireRole("admin", "developer"), auditMiddleware("governance_reports", "overview"), async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const pid = projectId;

  const [alertsSummary, disputeSummary, overrideSummary, nomineeSummary,
         claimSummary, evidenceSummary, auditSummary, meetingSummary] = await Promise.all([

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'acknowledged') AS acknowledged,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'open') AS critical_open,
        COUNT(*) FILTER (WHERE severity = 'high' AND status = 'open') AS high_open,
        COUNT(*) FILTER (WHERE severity = 'medium' AND status = 'open') AS medium_open,
        COUNT(*) FILTER (WHERE severity = 'low' AND status = 'open') AS low_open,
        MAX(detected_at) AS last_detected
      FROM operational_alerts
      WHERE project_id = ${pid}::uuid AND is_active = true
    `),

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'under_review') AS under_review,
        COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
        COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
        COUNT(*) FILTER (WHERE severity = 'high') AS high_severity,
        MAX(created_at) AS last_raised
      FROM disputes
      WHERE project_id = ${pid}::uuid AND is_active = true
    `),

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT module) AS modules_affected,
        COUNT(DISTINCT actor_name) AS actors,
        MAX(occurred_at) AS last_override,
        COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '30 days') AS last_30_days
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
    `),

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE activation_status = 'pending' AND is_active = true) AS pending,
        COUNT(*) FILTER (WHERE activation_status = 'activated' AND is_active = true) AS activated,
        COUNT(*) FILTER (WHERE activation_status = 'revoked') AS revoked,
        COUNT(*) FILTER (WHERE is_active = true) AS current_nominees
      FROM project_nominees
      WHERE project_id = ${pid}::uuid
    `),

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'under_review') AS under_review,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'settled') AS settled
      FROM inheritance_claims
      WHERE project_id = ${pid}::uuid AND is_active = true
    `),

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE archive_status = 'active' AND is_latest_version = true) AS active_docs,
        COUNT(*) FILTER (WHERE archive_status = 'superseded') AS superseded,
        COUNT(DISTINCT document_type) AS doc_types,
        MAX(created_at) AS last_uploaded
      FROM legal_evidence_archive
      WHERE project_id = ${pid}::uuid
    `),

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT action_type) AS action_types,
        COUNT(DISTINCT user_name) AS actors,
        MAX(created_at) AS last_entry
      FROM audit_logs
      WHERE project_id = ${pid}::uuid
    `),

    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
      FROM governance_meetings
      WHERE project_id = ${pid}::uuid
    `),
  ]);

  const a = alertsSummary.rows[0] as Record<string,unknown>;
  const d = disputeSummary.rows[0] as Record<string,unknown>;
  const o = overrideSummary.rows[0] as Record<string,unknown>;
  const n = nomineeSummary.rows[0] as Record<string,unknown>;
  const c = claimSummary.rows[0] as Record<string,unknown>;
  const e = evidenceSummary.rows[0] as Record<string,unknown>;
  const al = auditSummary.rows[0] as Record<string,unknown>;
  const m = meetingSummary.rows[0] as Record<string,unknown>;

  // Compute a simple governance health score 0–100
  const openAlerts = Number(a?.open_count ?? 0);
  const criticalAlerts = Number(a?.critical_open ?? 0);
  const highAlerts = Number(a?.high_open ?? 0);
  const openDisputes = Number(d?.open_count ?? 0);
  const escalated = Number(d?.escalated ?? 0);
  const pendingNominees = Number(n?.pending ?? 0);
  const openClaims = Number(c?.open_count ?? 0);

  let penalty = 0;
  penalty += criticalAlerts * 15;
  penalty += highAlerts * 8;
  penalty += (openAlerts - criticalAlerts - highAlerts) * 3;
  penalty += escalated * 12;
  penalty += openDisputes * 5;
  penalty += pendingNominees * 4;
  penalty += openClaims * 3;
  const healthScore = Math.max(0, Math.min(100, 100 - penalty));

  return res.json({
    healthScore: Math.round(healthScore),
    healthLabel: healthScore >= 80 ? "healthy" : healthScore >= 60 ? "attention" : healthScore >= 40 ? "warning" : "critical",
    alerts: {
      total: Number(a?.total ?? 0), open: openAlerts,
      acknowledged: Number(a?.acknowledged ?? 0), resolved: Number(a?.resolved ?? 0),
      critical: criticalAlerts, high: highAlerts,
      medium: Number(a?.medium_open ?? 0), low: Number(a?.low_open ?? 0),
      lastDetected: a?.last_detected ?? null,
    },
    disputes: {
      total: Number(d?.total ?? 0), open: openDisputes,
      underReview: Number(d?.under_review ?? 0), escalated,
      resolved: Number(d?.resolved ?? 0),
      critical: Number(d?.critical ?? 0), high: Number(d?.high_severity ?? 0),
      lastRaised: d?.last_raised ?? null,
    },
    overrides: {
      total: Number(o?.total ?? 0), modulesAffected: Number(o?.modules_affected ?? 0),
      uniqueActors: Number(o?.actors ?? 0), last30Days: Number(o?.last_30_days ?? 0),
      lastOverride: o?.last_override ?? null,
    },
    nominees: {
      total: Number(n?.total ?? 0), current: Number(n?.current_nominees ?? 0),
      pending: pendingNominees, activated: Number(n?.activated ?? 0), revoked: Number(n?.revoked ?? 0),
    },
    claims: {
      total: Number(c?.total ?? 0), open: openClaims,
      underReview: Number(c?.under_review ?? 0), approved: Number(c?.approved ?? 0),
      rejected: Number(c?.rejected ?? 0), settled: Number(c?.settled ?? 0),
    },
    evidence: {
      total: Number(e?.total ?? 0), active: Number(e?.active_docs ?? 0),
      superseded: Number(e?.superseded ?? 0), docTypes: Number(e?.doc_types ?? 0),
      lastUploaded: e?.last_uploaded ?? null,
    },
    audit: {
      totalEntries: Number(al?.total ?? 0), actionTypes: Number(al?.action_types ?? 0),
      uniqueActors: Number(al?.actors ?? 0), lastEntry: al?.last_entry ?? null,
    },
    meetings: {
      total: Number(m?.total ?? 0), scheduled: Number(m?.scheduled ?? 0),
      completed: Number(m?.completed ?? 0), cancelled: Number(m?.cancelled ?? 0),
    },
  });
});

// ── GET /governance-reports/alerts?projectId= ─────────────────────────────

router.get("/alerts", requireAuth, requireRole("admin", "developer"), auditMiddleware("governance_reports", "alerts"), async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const pid = projectId;

  const [alerts, bySeverity, byType, monthlyTrend, resolvedRecent] = await Promise.all([
    db.execute(sql`
      SELECT id, alert_code, alert_type, severity, status, title, description,
             entity_type, entity_ref, detected_at,
             acknowledged_at, acknowledged_by_name,
             resolved_at, resolved_by_name, resolution_notes,
             created_at
      FROM operational_alerts
      WHERE project_id = ${pid}::uuid AND is_active = true
      ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        CASE status WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,
        detected_at DESC
      LIMIT 300
    `),

    db.execute(sql`
      SELECT severity,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
      FROM operational_alerts
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY severity
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `),

    db.execute(sql`
      SELECT alert_type,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        MAX(detected_at) AS last_detected
      FROM operational_alerts
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY alert_type
      ORDER BY COUNT(*) DESC
    `),

    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', detected_at), 'YYYY-MM') AS month,
        COUNT(*) AS detected,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
        COUNT(*) FILTER (WHERE severity IN ('critical','high')) AS high_severity
      FROM operational_alerts
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY DATE_TRUNC('month', detected_at)
      ORDER BY DATE_TRUNC('month', detected_at)
    `),

    db.execute(sql`
      SELECT id, title, alert_type, severity, resolved_at, resolved_by_name, resolution_notes
      FROM operational_alerts
      WHERE project_id = ${pid}::uuid AND status = 'resolved' AND is_active = true
      ORDER BY resolved_at DESC
      LIMIT 20
    `),
  ]);

  return res.json({
    alerts: (alerts.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), alertCode: String(r.alert_code), alertType: String(r.alert_type),
      severity: String(r.severity), status: String(r.status),
      title: String(r.title), description: String(r.description),
      entityType: r.entity_type ? String(r.entity_type) : null, entityRef: r.entity_ref ? String(r.entity_ref) : null,
      detectedAt: r.detected_at ?? null, acknowledgedAt: r.acknowledged_at ?? null,
      acknowledgedByName: r.acknowledged_by_name ? String(r.acknowledged_by_name) : null,
      resolvedAt: r.resolved_at ?? null, resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
      resolutionNotes: r.resolution_notes ? String(r.resolution_notes) : null,
      createdAt: r.created_at ?? null,
    })),
    bySeverity: (bySeverity.rows as Record<string,unknown>[]).map(r => ({
      severity: String(r.severity), total: Number(r.total), open: Number(r.open_count), resolved: Number(r.resolved),
    })),
    byType: (byType.rows as Record<string,unknown>[]).map(r => ({
      alertType: String(r.alert_type), total: Number(r.total), open: Number(r.open_count),
      lastDetected: r.last_detected ?? null,
    })),
    monthlyTrend: (monthlyTrend.rows as Record<string,unknown>[]).map(r => ({
      month: String(r.month), detected: Number(r.detected), resolved: Number(r.resolved),
      highSeverity: Number(r.high_severity),
    })),
    recentlyResolved: (resolvedRecent.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), title: String(r.title), alertType: String(r.alert_type),
      severity: String(r.severity), resolvedAt: r.resolved_at ?? null,
      resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
      resolutionNotes: r.resolution_notes ? String(r.resolution_notes) : null,
    })),
  });
});

// ── GET /governance-reports/disputes?projectId= ───────────────────────────

router.get("/disputes", requireAuth, requireRole("admin", "developer"), auditMiddleware("governance_reports", "disputes"), async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const pid = projectId;

  const [disputes, byType, bySeverity, monthlyTrend, events, aging] = await Promise.all([
    db.execute(sql`
      SELECT id, dispute_type, status, severity, title, description,
             raised_by_name, raised_by_role, raised_at,
             resolved_at, resolved_by_name, resolution_summary,
             related_table, related_record_id, created_at
      FROM disputes
      WHERE project_id = ${pid}::uuid AND is_active = true
      ORDER BY
        CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        CASE status WHEN 'escalated' THEN 1 WHEN 'open' THEN 2 WHEN 'under_review' THEN 3 ELSE 4 END,
        raised_at DESC
      LIMIT 200
    `),

    db.execute(sql`
      SELECT dispute_type,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
        AVG(EXTRACT(DAY FROM (COALESCE(resolved_at, NOW()) - raised_at)))::numeric AS avg_resolution_days
      FROM disputes
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY dispute_type
      ORDER BY COUNT(*) DESC
    `),

    db.execute(sql`
      SELECT severity,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved','withdrawn')) AS active_count
      FROM disputes
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY severity
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    `),

    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', raised_at), 'YYYY-MM') AS month,
        COUNT(*) AS raised,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
        COUNT(*) FILTER (WHERE severity IN ('critical','high')) AS high_severity
      FROM disputes
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY DATE_TRUNC('month', raised_at)
      ORDER BY DATE_TRUNC('month', raised_at)
    `),

    db.execute(sql`
      SELECT dre.id, dre.event_type, dre.previous_status, dre.new_status,
             dre.description, dre.actor_name, dre.actor_role, dre.performed_at,
             d.title AS dispute_title, d.dispute_type
      FROM dispute_resolution_events dre
      JOIN disputes d ON d.id = dre.dispute_id
      WHERE dre.project_id = ${pid}::uuid
      ORDER BY dre.performed_at DESC
      LIMIT 150
    `),

    db.execute(sql`
      SELECT
        status,
        AVG(EXTRACT(DAY FROM (COALESCE(resolved_at, NOW()) - raised_at)))::numeric AS avg_age_days,
        MAX(EXTRACT(DAY FROM (COALESCE(resolved_at, NOW()) - raised_at)))::integer AS max_age_days,
        MIN(EXTRACT(DAY FROM (COALESCE(resolved_at, NOW()) - raised_at)))::integer AS min_age_days,
        COUNT(*) AS count
      FROM disputes
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY status
    `),
  ]);

  return res.json({
    disputes: (disputes.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), disputeType: String(r.dispute_type), status: String(r.status),
      severity: String(r.severity), title: String(r.title),
      description: r.description ? String(r.description) : null,
      raisedByName: r.raised_by_name ? String(r.raised_by_name) : null,
      raisedByRole: r.raised_by_role ? String(r.raised_by_role) : null,
      raisedAt: r.raised_at ?? null, resolvedAt: r.resolved_at ?? null,
      resolvedByName: r.resolved_by_name ? String(r.resolved_by_name) : null,
      resolutionSummary: r.resolution_summary ? String(r.resolution_summary) : null,
      relatedTable: r.related_table ? String(r.related_table) : null,
      relatedRecordId: r.related_record_id ? String(r.related_record_id) : null,
      createdAt: r.created_at ?? null,
    })),
    byType: (byType.rows as Record<string,unknown>[]).map(r => ({
      disputeType: String(r.dispute_type), total: Number(r.total), open: Number(r.open_count),
      escalated: Number(r.escalated), resolved: Number(r.resolved),
      avgResolutionDays: toF2(toNum(r.avg_resolution_days)),
    })),
    bySeverity: (bySeverity.rows as Record<string,unknown>[]).map(r => ({
      severity: String(r.severity), total: Number(r.total), active: Number(r.active_count),
    })),
    monthlyTrend: (monthlyTrend.rows as Record<string,unknown>[]).map(r => ({
      month: String(r.month), raised: Number(r.raised), resolved: Number(r.resolved),
      highSeverity: Number(r.high_severity),
    })),
    events: (events.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), eventType: String(r.event_type),
      previousStatus: r.previous_status ? String(r.previous_status) : null,
      newStatus: r.new_status ? String(r.new_status) : null,
      description: r.description ? String(r.description) : null,
      actorName: r.actor_name ? String(r.actor_name) : null,
      actorRole: r.actor_role ? String(r.actor_role) : null,
      performedAt: r.performed_at ?? null,
      disputeTitle: String(r.dispute_title), disputeType: String(r.dispute_type),
    })),
    aging: (aging.rows as Record<string,unknown>[]).map(r => ({
      status: String(r.status), count: Number(r.count),
      avgAgeDays: toF2(toNum(r.avg_age_days)), maxAgeDays: Number(r.max_age_days ?? 0),
      minAgeDays: Number(r.min_age_days ?? 0),
    })),
  });
});

// ── GET /governance-reports/overrides?projectId= ─────────────────────────

router.get("/overrides", requireAuth, requireRole("admin", "developer"), auditMiddleware("governance_reports", "overrides"), async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const pid = projectId;

  const [overrides, byModule, byActor, monthlyTrend, byType] = await Promise.all([
    db.execute(sql`
      SELECT id, override_type, module, title, description, override_reason,
             original_value, final_value, actor_name, actor_role,
             related_table, related_record_id, occurred_at, created_at
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
      ORDER BY occurred_at DESC
      LIMIT 300
    `),

    db.execute(sql`
      SELECT module, COUNT(*) AS cnt,
             COUNT(DISTINCT override_type) AS override_types,
             COUNT(DISTINCT actor_name) AS actors,
             MAX(occurred_at) AS last_override
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
      GROUP BY module
      ORDER BY COUNT(*) DESC
    `),

    db.execute(sql`
      SELECT actor_name, actor_role,
             COUNT(*) AS total,
             COUNT(DISTINCT module) AS modules,
             MIN(occurred_at) AS first_override,
             MAX(occurred_at) AS last_override
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid AND actor_name IS NOT NULL
      GROUP BY actor_name, actor_role
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `),

    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', occurred_at), 'YYYY-MM') AS month,
        COUNT(*) AS total,
        COUNT(DISTINCT module) AS modules,
        COUNT(DISTINCT actor_name) AS actors
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
      GROUP BY DATE_TRUNC('month', occurred_at)
      ORDER BY DATE_TRUNC('month', occurred_at)
    `),

    db.execute(sql`
      SELECT override_type, COUNT(*) AS cnt, MAX(occurred_at) AS last_seen
      FROM governance_overrides
      WHERE project_id = ${pid}::uuid
      GROUP BY override_type
      ORDER BY COUNT(*) DESC
    `),
  ]);

  return res.json({
    overrides: (overrides.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), overrideType: String(r.override_type), module: String(r.module),
      title: String(r.title), description: r.description ? String(r.description) : null,
      overrideReason: r.override_reason ? String(r.override_reason) : null,
      originalValue: r.original_value ?? null, finalValue: r.final_value ?? null,
      actorName: r.actor_name ? String(r.actor_name) : null,
      actorRole: r.actor_role ? String(r.actor_role) : null,
      relatedTable: r.related_table ? String(r.related_table) : null,
      relatedRecordId: r.related_record_id ? String(r.related_record_id) : null,
      occurredAt: r.occurred_at ?? null, createdAt: r.created_at ?? null,
    })),
    byModule: (byModule.rows as Record<string,unknown>[]).map(r => ({
      module: String(r.module), count: Number(r.cnt), overrideTypes: Number(r.override_types),
      actors: Number(r.actors), lastOverride: r.last_override ?? null,
    })),
    byActor: (byActor.rows as Record<string,unknown>[]).map(r => ({
      actorName: String(r.actor_name), actorRole: r.actor_role ? String(r.actor_role) : null,
      total: Number(r.total), modules: Number(r.modules),
      firstOverride: r.first_override ?? null, lastOverride: r.last_override ?? null,
    })),
    monthlyTrend: (monthlyTrend.rows as Record<string,unknown>[]).map(r => ({
      month: String(r.month), total: Number(r.total), modules: Number(r.modules), actors: Number(r.actors),
    })),
    byType: (byType.rows as Record<string,unknown>[]).map(r => ({
      overrideType: String(r.override_type), count: Number(r.cnt), lastSeen: r.last_seen ?? null,
    })),
  });
});

// ── GET /governance-reports/nominees?projectId= ───────────────────────────

router.get("/nominees", requireAuth, async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const pid = projectId;

  const [nominees, workflows, statusSummary] = await Promise.all([
    db.execute(sql`
      SELECT id, nominee_name, relationship, phone, address,
             activation_status, activation_notes, activated_at,
             is_active, replaced_at, created_at, updated_at
      FROM project_nominees
      WHERE project_id = ${pid}::uuid
      ORDER BY is_active DESC, created_at DESC
    `),

    db.execute(sql`
      SELECT w.id, w.nominee_name, w.activation_type, w.status,
             w.death_certificate_url, w.declaration_deed_url,
             w.otp_verified_at, w.otp_verified_by_name,
             w.verified_at, w.verified_by_name, w.verification_notes,
             w.activated_at, w.activated_by_name,
             w.rejected_at, w.rejected_by_name, w.rejection_reason,
             w.governance_remarks, w.created_at
      FROM nominee_activation_workflows w
      WHERE w.project_id = ${pid}::uuid
      ORDER BY w.created_at DESC
      LIMIT 100
    `),

    db.execute(sql`
      SELECT
        activation_status,
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE is_active = true) AS current
      FROM project_nominees
      WHERE project_id = ${pid}::uuid
      GROUP BY activation_status
    `),
  ]);

  return res.json({
    nominees: (nominees.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), nomineeName: String(r.nominee_name), relationship: String(r.relationship),
      phone: String(r.phone), address: String(r.address),
      activationStatus: String(r.activation_status),
      activationNotes: r.activation_notes ? String(r.activation_notes) : null,
      activatedAt: r.activated_at ?? null, isActive: Boolean(r.is_active),
      replacedAt: r.replaced_at ?? null, createdAt: r.created_at ?? null,
    })),
    workflows: (workflows.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), nomineeName: String(r.nominee_name),
      activationType: String(r.activation_type), status: String(r.status),
      hasDeathCert: Boolean(r.death_certificate_url), hasDeed: Boolean(r.declaration_deed_url),
      otpVerifiedAt: r.otp_verified_at ?? null, otpVerifiedByName: r.otp_verified_by_name ? String(r.otp_verified_by_name) : null,
      verifiedAt: r.verified_at ?? null, verifiedByName: r.verified_by_name ? String(r.verified_by_name) : null,
      verificationNotes: r.verification_notes ? String(r.verification_notes) : null,
      activatedAt: r.activated_at ?? null, activatedByName: r.activated_by_name ? String(r.activated_by_name) : null,
      rejectedAt: r.rejected_at ?? null, rejectedByName: r.rejected_by_name ? String(r.rejected_by_name) : null,
      rejectionReason: r.rejection_reason ? String(r.rejection_reason) : null,
      governanceRemarks: r.governance_remarks ? String(r.governance_remarks) : null,
      createdAt: r.created_at ?? null,
    })),
    statusSummary: (statusSummary.rows as Record<string,unknown>[]).map(r => ({
      activationStatus: String(r.activation_status), count: Number(r.cnt), current: Number(r.current),
    })),
  });
});

// ── GET /governance-reports/claims?projectId= ────────────────────────────

router.get("/claims", requireAuth, async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const pid = projectId;

  const [claims, byStatus, byType, claimants, sharesWithDisputes, docChecklist] = await Promise.all([
    db.execute(sql`
      SELECT
        ic.id, ic.claim_type, ic.status, ic.description,
        ic.initiated_by_name, ic.developer_approved_by_name, ic.developer_approved_at,
        ic.approved_by_name, ic.approved_at,
        ic.rejected_by_name, ic.rejected_at, ic.rejection_reason,
        ic.settlement_notes, ic.review_notes,
        ic.created_at,
        p.name AS partner_name,
        COUNT(DISTINCT ics.id) AS share_count,
        COUNT(DISTINCT id2.id) AS doc_count,
        COUNT(DISTINCT id2.id) FILTER (WHERE id2.verification_status = 'verified') AS verified_docs
      FROM inheritance_claims ic
      JOIN partners p ON p.id = ic.partner_id
      LEFT JOIN inheritance_claimant_shares ics ON ics.claim_id = ic.id
      LEFT JOIN inheritance_documents id2 ON id2.claim_id = ic.id AND id2.is_active = true
      WHERE ic.project_id = ${pid}::uuid AND ic.is_active = true
      GROUP BY ic.id, p.name
      ORDER BY
        CASE ic.status WHEN 'open' THEN 1 WHEN 'under_review' THEN 2 ELSE 3 END,
        ic.created_at DESC
    `),

    db.execute(sql`
      SELECT status, COUNT(*) AS cnt
      FROM inheritance_claims
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY status
    `),

    db.execute(sql`
      SELECT claim_type, COUNT(*) AS cnt,
             COUNT(*) FILTER (WHERE status NOT IN ('rejected','settled')) AS active
      FROM inheritance_claims
      WHERE project_id = ${pid}::uuid AND is_active = true
      GROUP BY claim_type
    `),

    db.execute(sql`
      SELECT pc.id, pc.claimant_name, pc.relationship, pc.status,
             pc.is_active, pc.created_at,
             p.name AS partner_name
      FROM partner_claimants pc
      JOIN partners p ON p.id = pc.partner_id
      WHERE pc.project_id = ${pid}::uuid
      ORDER BY pc.is_active DESC, pc.created_at DESC
    `),

    db.execute(sql`
      SELECT ics.id, ics.proposed_share_pct::numeric, ics.share_notes,
             ics.status, ics.dispute_notes, ics.proposed_by_name,
             ics.approved_by_name, ics.approved_at,
             pc.claimant_name
      FROM inheritance_claimant_shares ics
      JOIN partner_claimants pc ON pc.id = ics.claimant_id
      JOIN inheritance_claims ic ON ic.id = ics.claim_id
      WHERE ic.project_id = ${pid}::uuid
      ORDER BY ics.status, ics.created_at DESC
    `),

    db.execute(sql`
      SELECT document_type,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE verification_status = 'verified') AS verified,
             COUNT(*) FILTER (WHERE verification_status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE verification_status = 'rejected') AS rejected,
             COUNT(*) FILTER (WHERE file_object_path IS NULL) AS missing_file
      FROM inheritance_documents id2
      JOIN inheritance_claims ic ON ic.id = id2.claim_id
      WHERE ic.project_id = ${pid}::uuid AND id2.is_active = true
      GROUP BY document_type
      ORDER BY document_type
    `),
  ]);

  return res.json({
    claims: (claims.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), claimType: String(r.claim_type), status: String(r.status),
      description: r.description ? String(r.description) : null,
      partnerName: String(r.partner_name),
      initiatedByName: r.initiated_by_name ? String(r.initiated_by_name) : null,
      developerApprovedByName: r.developer_approved_by_name ? String(r.developer_approved_by_name) : null,
      developerApprovedAt: r.developer_approved_at ?? null,
      approvedByName: r.approved_by_name ? String(r.approved_by_name) : null,
      approvedAt: r.approved_at ?? null,
      rejectedByName: r.rejected_by_name ? String(r.rejected_by_name) : null,
      rejectedAt: r.rejected_at ?? null,
      rejectionReason: r.rejection_reason ? String(r.rejection_reason) : null,
      settlementNotes: r.settlement_notes ? String(r.settlement_notes) : null,
      reviewNotes: r.review_notes ? String(r.review_notes) : null,
      shareCount: Number(r.share_count), docCount: Number(r.doc_count),
      verifiedDocs: Number(r.verified_docs), createdAt: r.created_at ?? null,
    })),
    byStatus: (byStatus.rows as Record<string,unknown>[]).map(r => ({ status: String(r.status), count: Number(r.cnt) })),
    byType: (byType.rows as Record<string,unknown>[]).map(r => ({ claimType: String(r.claim_type), count: Number(r.cnt), active: Number(r.active) })),
    claimants: (claimants.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), claimantName: String(r.claimant_name), relationship: String(r.relationship),
      status: String(r.status), isActive: Boolean(r.is_active),
      partnerName: String(r.partner_name), createdAt: r.created_at ?? null,
    })),
    shares: (sharesWithDisputes.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), proposedSharePct: parseFloat(String(r.proposed_share_pct ?? "0")),
      shareNotes: r.share_notes ? String(r.share_notes) : null, status: String(r.status),
      disputeNotes: r.dispute_notes ? String(r.dispute_notes) : null,
      proposedByName: r.proposed_by_name ? String(r.proposed_by_name) : null,
      approvedByName: r.approved_by_name ? String(r.approved_by_name) : null,
      approvedAt: r.approved_at ?? null, claimantName: String(r.claimant_name),
    })),
    docChecklist: (docChecklist.rows as Record<string,unknown>[]).map(r => ({
      documentType: String(r.document_type), total: Number(r.total),
      verified: Number(r.verified), pending: Number(r.pending), rejected: Number(r.rejected),
      missingFile: Number(r.missing_file),
    })),
  });
});

// ── GET /governance-reports/evidence?projectId= ───────────────────────────

router.get("/evidence", requireAuth, requireRole("admin", "developer"), auditMiddleware("governance_reports", "evidence"), async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId } = req.query as { projectId?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const pid = projectId;

  const [documents, byType, accessLog, versionChain] = await Promise.all([
    db.execute(sql`
      SELECT id, document_type, title, description, version_number,
             is_latest_version, archive_status, original_file_name,
             file_size_bytes, mime_type, related_table, related_record_id,
             reference_number, issuing_authority,
             document_date, uploaded_by_name, uploaded_by_role,
             archived_at, created_at
      FROM legal_evidence_archive
      WHERE project_id = ${pid}::uuid
      ORDER BY
        CASE archive_status WHEN 'active' THEN 1 WHEN 'archived' THEN 2 ELSE 3 END,
        is_latest_version DESC, created_at DESC
      LIMIT 300
    `),

    db.execute(sql`
      SELECT document_type,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE is_latest_version = true AND archive_status = 'active') AS current,
             COUNT(*) FILTER (WHERE archive_status = 'superseded') AS superseded,
             COUNT(*) FILTER (WHERE file_object_path IS NULL AND external_url IS NULL) AS missing_file,
             MAX(created_at) AS last_uploaded
      FROM legal_evidence_archive
      WHERE project_id = ${pid}::uuid
      GROUP BY document_type
      ORDER BY document_type
    `),

    db.execute(sql`
      SELECT al.id, al.access_type, al.actor_name, al.actor_role,
             al.accessed_at, al.ip_address,
             lea.document_type, lea.title AS document_title
      FROM evidence_access_log al
      JOIN legal_evidence_archive lea ON lea.id = al.evidence_id
      WHERE lea.project_id = ${pid}::uuid
      ORDER BY al.accessed_at DESC
      LIMIT 100
    `),

    db.execute(sql`
      SELECT document_type, title, version_number, archive_status,
             is_latest_version, parent_archive_id, created_at, uploaded_by_name
      FROM legal_evidence_archive
      WHERE project_id = ${pid}::uuid AND version_number > 1
      ORDER BY document_type, version_number DESC
    `),
  ]);

  // Missing docs checklist — expected critical document types
  const expectedDocTypes = [
    "agreement", "declaration_deed", "death_certificate", "gd_entry",
    "invoice", "payment_proof", "governance_document",
  ];
  const presentTypes = new Set((byType.rows as Record<string,unknown>[]).map(r => String(r.document_type)));
  const missingTypes = expectedDocTypes.filter(t => !presentTypes.has(t));

  return res.json({
    documents: (documents.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), documentType: String(r.document_type), title: String(r.title),
      description: r.description ? String(r.description) : null,
      versionNumber: Number(r.version_number), isLatestVersion: Boolean(r.is_latest_version),
      archiveStatus: String(r.archive_status), originalFileName: r.original_file_name ? String(r.original_file_name) : null,
      fileSizeBytes: r.file_size_bytes ? Number(r.file_size_bytes) : null,
      mimeType: r.mime_type ? String(r.mime_type) : null,
      relatedTable: r.related_table ? String(r.related_table) : null,
      relatedRecordId: r.related_record_id ? String(r.related_record_id) : null,
      referenceNumber: r.reference_number ? String(r.reference_number) : null,
      issuingAuthority: r.issuing_authority ? String(r.issuing_authority) : null,
      documentDate: r.document_date ?? null,
      uploadedByName: r.uploaded_by_name ? String(r.uploaded_by_name) : null,
      uploadedByRole: r.uploaded_by_role ? String(r.uploaded_by_role) : null,
      archivedAt: r.archived_at ?? null, createdAt: r.created_at ?? null,
      hasFile: Boolean(r.original_file_name),
    })),
    byType: (byType.rows as Record<string,unknown>[]).map(r => ({
      documentType: String(r.document_type), total: Number(r.total),
      current: Number(r.current), superseded: Number(r.superseded),
      missingFile: Number(r.missing_file), lastUploaded: r.last_uploaded ?? null,
    })),
    accessLog: (accessLog.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), accessType: String(r.access_type),
      actorName: r.actor_name ? String(r.actor_name) : null,
      actorRole: r.actor_role ? String(r.actor_role) : null,
      accessedAt: r.accessed_at ?? null,
      documentType: String(r.document_type), documentTitle: String(r.document_title),
      ipAddress: r.ip_address ? String(r.ip_address) : null,
    })),
    versionChain: (versionChain.rows as Record<string,unknown>[]).map(r => ({
      documentType: String(r.document_type), title: String(r.title),
      versionNumber: Number(r.version_number), archiveStatus: String(r.archive_status),
      isLatestVersion: Boolean(r.is_latest_version),
      createdAt: r.created_at ?? null, uploadedByName: r.uploaded_by_name ? String(r.uploaded_by_name) : null,
    })),
    missingDocTypes: missingTypes,
  });
});

// ── GET /governance-reports/audit-log?projectId=&limit= ──────────────────

router.get("/audit-log", requireAuth, requireRole("admin", "developer"), auditMiddleware("governance_reports", "audit_log"), async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor || !isPrivileged(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId, limit: limitStr } = req.query as { projectId?: string; limit?: string };
  if (!projectId) return res.status(400).json({ error: "projectId required" });
  const lim = Math.min(500, Math.max(10, parseInt(limitStr ?? "100", 10)));
  const pid = projectId;

  const [entries, byModule, byOperation, byActor, monthlyTrend] = await Promise.all([
    db.execute(sql`
      SELECT id, table_name, record_id, operation, module, action_type,
             user_name, user_role, ip_address, created_at
      FROM audit_logs
      WHERE project_id = ${pid}::uuid
      ORDER BY created_at DESC
      LIMIT ${lim}
    `),

    db.execute(sql`
      SELECT module, COUNT(*) AS cnt, COUNT(DISTINCT action_type) AS action_types,
             COUNT(DISTINCT user_name) AS actors, MAX(created_at) AS last_entry
      FROM audit_logs
      WHERE project_id = ${pid}::uuid AND module IS NOT NULL
      GROUP BY module
      ORDER BY COUNT(*) DESC
    `),

    db.execute(sql`
      SELECT operation, COUNT(*) AS cnt
      FROM audit_logs
      WHERE project_id = ${pid}::uuid
      GROUP BY operation
      ORDER BY COUNT(*) DESC
    `),

    db.execute(sql`
      SELECT user_name, user_role,
             COUNT(*) AS total, COUNT(DISTINCT table_name) AS tables,
             MIN(created_at) AS first, MAX(created_at) AS last
      FROM audit_logs
      WHERE project_id = ${pid}::uuid AND user_name IS NOT NULL
      GROUP BY user_name, user_role
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `),

    db.execute(sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE operation = 'INSERT') AS inserts,
        COUNT(*) FILTER (WHERE operation = 'UPDATE') AS updates,
        COUNT(*) FILTER (WHERE operation = 'DELETE') AS deletes,
        COUNT(DISTINCT user_name) AS actors
      FROM audit_logs
      WHERE project_id = ${pid}::uuid
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `),
  ]);

  return res.json({
    entries: (entries.rows as Record<string,unknown>[]).map(r => ({
      id: String(r.id), tableName: String(r.table_name), recordId: String(r.record_id),
      operation: String(r.operation), module: r.module ? String(r.module) : null,
      actionType: r.action_type ? String(r.action_type) : null,
      userName: r.user_name ? String(r.user_name) : null, userRole: r.user_role ? String(r.user_role) : null,
      ipAddress: r.ip_address ? String(r.ip_address) : null, createdAt: r.created_at ?? null,
    })),
    byModule: (byModule.rows as Record<string,unknown>[]).map(r => ({
      module: String(r.module), count: Number(r.cnt), actionTypes: Number(r.action_types),
      actors: Number(r.actors), lastEntry: r.last_entry ?? null,
    })),
    byOperation: (byOperation.rows as Record<string,unknown>[]).map(r => ({ operation: String(r.operation), count: Number(r.cnt) })),
    byActor: (byActor.rows as Record<string,unknown>[]).map(r => ({
      userName: String(r.user_name), userRole: r.user_role ? String(r.user_role) : null,
      total: Number(r.total), tables: Number(r.tables),
      first: r.first ?? null, last: r.last ?? null,
    })),
    monthlyTrend: (monthlyTrend.rows as Record<string,unknown>[]).map(r => ({
      month: String(r.month), total: Number(r.total), inserts: Number(r.inserts),
      updates: Number(r.updates), deletes: Number(r.deletes), actors: Number(r.actors),
    })),
    limit: lim,
  });
});

export default router;

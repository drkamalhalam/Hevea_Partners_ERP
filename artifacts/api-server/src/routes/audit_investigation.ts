/**
 * audit_investigation.ts
 *
 * Enterprise audit investigation and advanced search API.
 *
 * Unified search across six audit data sources:
 *   audit_log      — auditLogsTable (all INSERT/UPDATE/DELETE ops)
 *   governance     — governanceOverridesTable (manual overrides)
 *   dispute        — disputesTable (disputes and conflicts)
 *   session        — userSessionsTable (login sessions)
 *   financial      — financialAccessLogsTable (financial module access)
 *   snapshot       — recordSnapshotsTable (point-in-time snapshots)
 *
 * Endpoints:
 *   GET /api/audit-investigation/search          — unified paginated search
 *   GET /api/audit-investigation/analytics       — aggregated analytics
 *   GET /api/audit-investigation/detail/:source/:id — full event detail
 *   GET /api/audit-investigation/export          — export placeholder metadata
 *   GET /api/audit-investigation/filters/options — distinct values for filter dropdowns
 */

import { Router } from "express";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  count,
} from "drizzle-orm";
import {
  db,
  auditLogsTable,
  governanceOverridesTable,
  disputesTable,
  userSessionsTable,
  financialAccessLogsTable,
  recordSnapshotsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Types ────────────────────────────────────────────────────────────────────

type AuditSource =
  | "audit_log"
  | "governance"
  | "dispute"
  | "session"
  | "financial"
  | "snapshot";

interface AuditEvent {
  id: string;
  source: AuditSource;
  timestamp: string;
  projectId: string | null;
  projectName: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  title: string;
  detail: string | null;
  module: string | null;
  actionType: string | null;
  status: string | null;
  severity: string | null;
  ipAddress: string | null;
  tags: string[];
  raw: Record<string, unknown>;
}

// ── Helper: build date filter for a column ───────────────────────────────────

function dateRange(col: Parameters<typeof gte>[0], from?: string, to?: string) {
  const conds = [];
  if (from) conds.push(gte(col, new Date(from)));
  if (to) conds.push(lte(col, new Date(to)));
  return conds;
}

// ── Helper: project name lookup ───────────────────────────────────────────────

async function projectNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(inArray(projectsTable.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── GET /search ───────────────────────────────────────────────────────────────
// Query params:
//   sources       comma-separated: audit_log,governance,dispute,session,financial,snapshot
//   projectId     UUID filter
//   userId        UUID filter (audit_log, session, financial)
//   dateFrom      ISO string
//   dateTo        ISO string
//   module        text (audit_log.module, governance.module)
//   actionType    text (audit_log.actionType, audit_log.operation)
//   disputeType   text (dispute.disputeType)
//   disputeStatus text (dispute.status)
//   severity      text (dispute.severity)
//   q             free text search
//   limit         default 50
//   offset        default 0

router.get("/search", requireRole("admin", "developer"), async (req, res) => {
  const {
    sources,
    projectId,
    userId,
    dateFrom,
    dateTo,
    module: mod,
    actionType,
    disputeType,
    disputeStatus,
    severity,
    q,
    limit: limitStr = "50",
    offset: offsetStr = "0",
  } = req.query as Record<string, string | undefined>;

  const limit = Math.min(parseInt(limitStr ?? "50", 10), 200);
  const offset = parseInt(offsetStr ?? "0", 10);

  const activeSources = sources
    ? (sources.split(",") as AuditSource[])
    : (["audit_log", "governance", "dispute", "session", "financial", "snapshot"] as AuditSource[]);

  const allEvents: AuditEvent[] = [];

  // ── 1. Audit Logs ────────────────────────────────────────────────────────
  if (activeSources.includes("audit_log")) {
    const conditions = [
      projectId ? eq(auditLogsTable.projectId, projectId) : undefined,
      userId ? eq(auditLogsTable.userId, userId) : undefined,
      mod ? eq(auditLogsTable.module, mod) : undefined,
      actionType ? or(
        eq(auditLogsTable.actionType, actionType),
        eq(sql`${auditLogsTable.operation}::text`, actionType),
      ) : undefined,
      ...dateRange(auditLogsTable.createdAt, dateFrom, dateTo),
      q
        ? or(
            ilike(auditLogsTable.tableName, `%${q}%`),
            ilike(auditLogsTable.module ?? auditLogsTable.tableName, `%${q}%`),
            ilike(auditLogsTable.actionType ?? auditLogsTable.tableName, `%${q}%`),
            ilike(auditLogsTable.userName ?? auditLogsTable.tableName, `%${q}%`),
          )
        : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit + offset);

    for (const r of rows) {
      allEvents.push({
        id: r.id,
        source: "audit_log",
        timestamp: r.createdAt.toISOString(),
        projectId: r.projectId ?? null,
        projectName: null,
        actorId: r.userId ?? null,
        actorName: r.userName ?? null,
        actorRole: r.userRole ?? null,
        title: `${r.operation} on ${r.tableName}${r.actionType ? ` (${r.actionType})` : ""}`,
        detail: r.module ? `Module: ${r.module}` : null,
        module: r.module ?? null,
        actionType: r.actionType ?? (r.operation as string),
        status: null,
        severity: null,
        ipAddress: r.ipAddress ?? null,
        tags: [r.operation, r.tableName, ...(r.module ? [r.module] : []), ...(r.actionType ? [r.actionType] : [])],
        raw: r as unknown as Record<string, unknown>,
      });
    }
  }

  // ── 2. Governance Overrides ──────────────────────────────────────────────
  if (activeSources.includes("governance")) {
    const conditions = [
      projectId ? eq(governanceOverridesTable.projectId, projectId) : undefined,
      userId ? eq(governanceOverridesTable.actorId, userId) : undefined,
      mod ? eq(governanceOverridesTable.module, mod) : undefined,
      actionType ? eq(governanceOverridesTable.overrideType, actionType) : undefined,
      ...dateRange(governanceOverridesTable.createdAt, dateFrom, dateTo),
      q
        ? or(
            ilike(governanceOverridesTable.title, `%${q}%`),
            ilike(governanceOverridesTable.overrideType, `%${q}%`),
            ilike(governanceOverridesTable.actorName ?? governanceOverridesTable.title, `%${q}%`),
          )
        : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(governanceOverridesTable)
      .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
      .orderBy(desc(governanceOverridesTable.createdAt))
      .limit(limit + offset);

    for (const r of rows) {
      allEvents.push({
        id: r.id,
        source: "governance",
        timestamp: r.createdAt.toISOString(),
        projectId: r.projectId ?? null,
        projectName: null,
        actorId: r.actorId ?? null,
        actorName: r.actorName ?? null,
        actorRole: r.actorRole ?? null,
        title: r.title,
        detail: r.description ?? r.overrideReason ?? null,
        module: r.module,
        actionType: r.overrideType,
        status: null,
        severity: null,
        ipAddress: null,
        tags: [r.overrideType, r.module, "governance_override"],
        raw: r as unknown as Record<string, unknown>,
      });
    }
  }

  // ── 3. Disputes ──────────────────────────────────────────────────────────
  if (activeSources.includes("dispute")) {
    const conditions = [
      projectId ? eq(disputesTable.projectId, projectId) : undefined,
      disputeType ? eq(disputesTable.disputeType, disputeType) : undefined,
      disputeStatus ? eq(disputesTable.status, disputeStatus) : undefined,
      severity ? eq(disputesTable.severity, severity) : undefined,
      ...dateRange(disputesTable.createdAt, dateFrom, dateTo),
      q
        ? or(
            ilike(disputesTable.title, `%${q}%`),
            ilike(disputesTable.disputeType, `%${q}%`),
            ilike(disputesTable.description ?? disputesTable.title, `%${q}%`),
          )
        : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(disputesTable)
      .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
      .orderBy(desc(disputesTable.createdAt))
      .limit(limit + offset);

    for (const r of rows) {
      allEvents.push({
        id: r.id,
        source: "dispute",
        timestamp: r.createdAt.toISOString(),
        projectId: r.projectId,
        projectName: null,
        actorId: null,
        actorName: null,
        actorRole: null,
        title: r.title,
        detail: r.description ?? null,
        module: "disputes",
        actionType: r.disputeType,
        status: r.status,
        severity: r.severity,
        ipAddress: null,
        tags: [r.disputeType, r.status, r.severity, "dispute"],
        raw: r as unknown as Record<string, unknown>,
      });
    }
  }

  // ── 4. User Sessions ─────────────────────────────────────────────────────
  if (activeSources.includes("session")) {
    const conditions = [
      userId ? eq(userSessionsTable.userId, userId) : undefined,
      ...dateRange(userSessionsTable.createdAt, dateFrom, dateTo),
      q
        ? or(
            ilike(userSessionsTable.displayName, `%${q}%`),
            ilike(userSessionsTable.clerkUserId, `%${q}%`),
            ilike(userSessionsTable.userRole, `%${q}%`),
            ilike(userSessionsTable.ipAddress, `%${q}%`),
          )
        : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(userSessionsTable)
      .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
      .orderBy(desc(userSessionsTable.createdAt))
      .limit(limit + offset);

    for (const r of rows) {
      allEvents.push({
        id: r.id,
        source: "session",
        timestamp: r.createdAt.toISOString(),
        projectId: null,
        projectName: null,
        actorId: r.userId ?? null,
        actorName: r.displayName ?? null,
        actorRole: r.userRole ?? null,
        title: `Login session — ${r.displayName ?? r.clerkUserId ?? "unknown"}`,
        detail: r.ipAddress ? `IP: ${r.ipAddress}` : null,
        module: "authentication",
        actionType: "login",
        status: null,
        severity: null,
        ipAddress: r.ipAddress ?? null,
        tags: ["session", "login", r.userRole ?? "unknown"],
        raw: r as unknown as Record<string, unknown>,
      });
    }
  }

  // ── 5. Financial Access Logs ─────────────────────────────────────────────
  if (activeSources.includes("financial")) {
    const conditions = [
      projectId ? eq(financialAccessLogsTable.projectId, projectId) : undefined,
      userId ? eq(financialAccessLogsTable.userId, userId) : undefined,
      ...dateRange(financialAccessLogsTable.accessedAt, dateFrom, dateTo),
      q
        ? or(
            ilike(financialAccessLogsTable.resource, `%${q}%`),
            ilike(financialAccessLogsTable.action, `%${q}%`),
          )
        : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(financialAccessLogsTable)
      .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
      .orderBy(desc(financialAccessLogsTable.accessedAt))
      .limit(limit + offset);

    for (const r of rows) {
      allEvents.push({
        id: r.id,
        source: "financial",
        timestamp: r.accessedAt.toISOString(),
        projectId: r.projectId ?? null,
        projectName: null,
        actorId: r.userId ?? null,
        actorName: null,
        actorRole: r.userRole,
        title: `Financial access: ${r.action} on ${r.resource}`,
        detail: r.resourceId ? `Record: ${r.resourceId}` : null,
        module: r.resource,
        actionType: r.action,
        status: null,
        severity: null,
        ipAddress: r.ipAddress ?? null,
        tags: ["financial_access", r.resource, r.action],
        raw: r as unknown as Record<string, unknown>,
      });
    }
  }

  // ── 6. Snapshots ─────────────────────────────────────────────────────────
  if (activeSources.includes("snapshot")) {
    const conditions = [
      projectId ? eq(recordSnapshotsTable.projectId, projectId) : undefined,
      ...dateRange(recordSnapshotsTable.createdAt, dateFrom, dateTo),
      q
        ? or(
            ilike(recordSnapshotsTable.label, `%${q}%`),
            ilike(recordSnapshotsTable.snapshotType, `%${q}%`),
            ilike(recordSnapshotsTable.capturedByName, `%${q}%`),
          )
        : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(recordSnapshotsTable)
      .where(conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined)
      .orderBy(desc(recordSnapshotsTable.createdAt))
      .limit(limit + offset);

    for (const r of rows) {
      allEvents.push({
        id: r.id,
        source: "snapshot",
        timestamp: r.createdAt.toISOString(),
        projectId: r.projectId ?? null,
        projectName: r.projectName ?? null,
        actorId: r.capturedById ?? null,
        actorName: r.capturedByName ?? null,
        actorRole: r.capturedByRole ?? null,
        title: `Snapshot: ${r.snapshotType}${r.label ? ` — ${r.label}` : ""}`,
        detail: r.notes ?? null,
        module: "snapshots",
        actionType: r.snapshotType,
        status: null,
        severity: null,
        ipAddress: null,
        tags: [r.snapshotType, r.triggerType, "snapshot"],
        raw: { ...r, snapshotData: "[omitted]" } as unknown as Record<string, unknown>,
      });
    }
  }

  // ── Sort all events by timestamp desc, paginate ──────────────────────────
  allEvents.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const paginated = allEvents.slice(offset, offset + limit);

  // ── Enrich project names ──────────────────────────────────────────────────
  const pmap = await projectNames(paginated.map((e) => e.projectId));
  for (const e of paginated) {
    if (e.projectId && !e.projectName) {
      e.projectName = pmap.get(e.projectId) ?? null;
    }
  }

  return res.json({
    events: paginated,
    total: allEvents.length,
    limit,
    offset,
  });
});

// ── GET /analytics ────────────────────────────────────────────────────────────
// Returns aggregated stats for governance analytics charts.
// Query params: projectId, dateFrom, dateTo

router.get("/analytics", requireRole("admin", "developer"), async (req, res) => {
  const { projectId, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

  const [
    auditByModule,
    auditByOp,
    disputesByType,
    disputesByStatus,
    disputesBySeverity,
    overridesByType,
    overridesByModule,
    sessionsByRole,
    recentActivity,
  ] = await Promise.all([
    // Audit logs by module
    db
      .select({ module: auditLogsTable.module, cnt: count() })
      .from(auditLogsTable)
      .where(
        and(
          ...[
            projectId ? eq(auditLogsTable.projectId, projectId) : undefined,
            ...dateRange(auditLogsTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(auditLogsTable.module),

    // Audit logs by operation
    db
      .select({ operation: auditLogsTable.operation, cnt: count() })
      .from(auditLogsTable)
      .where(
        and(
          ...[
            projectId ? eq(auditLogsTable.projectId, projectId) : undefined,
            ...dateRange(auditLogsTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(auditLogsTable.operation),

    // Disputes by type
    db
      .select({ type: disputesTable.disputeType, cnt: count() })
      .from(disputesTable)
      .where(
        and(
          ...[
            projectId ? eq(disputesTable.projectId, projectId) : undefined,
            ...dateRange(disputesTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(disputesTable.disputeType),

    // Disputes by status
    db
      .select({ status: disputesTable.status, cnt: count() })
      .from(disputesTable)
      .where(
        and(
          ...[
            projectId ? eq(disputesTable.projectId, projectId) : undefined,
            ...dateRange(disputesTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(disputesTable.status),

    // Disputes by severity
    db
      .select({ severity: disputesTable.severity, cnt: count() })
      .from(disputesTable)
      .where(
        and(
          ...[
            projectId ? eq(disputesTable.projectId, projectId) : undefined,
            ...dateRange(disputesTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(disputesTable.severity),

    // Governance overrides by type
    db
      .select({ type: governanceOverridesTable.overrideType, cnt: count() })
      .from(governanceOverridesTable)
      .where(
        and(
          ...[
            projectId ? eq(governanceOverridesTable.projectId, projectId) : undefined,
            ...dateRange(governanceOverridesTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(governanceOverridesTable.overrideType),

    // Governance overrides by module
    db
      .select({ module: governanceOverridesTable.module, cnt: count() })
      .from(governanceOverridesTable)
      .where(
        and(
          ...[
            projectId ? eq(governanceOverridesTable.projectId, projectId) : undefined,
            ...dateRange(governanceOverridesTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(governanceOverridesTable.module),

    // Sessions by role
    db
      .select({ role: userSessionsTable.userRole, cnt: count() })
      .from(userSessionsTable)
      .where(
        and(
          ...[
            ...dateRange(userSessionsTable.createdAt, dateFrom, dateTo),
          ].filter(Boolean) as Parameters<typeof and>,
        ),
      )
      .groupBy(userSessionsTable.userRole),

    // Events per day (last 30 days) — audit_logs
    db.execute(sql`
      SELECT
        date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
        COUNT(*) AS cnt
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      ${projectId ? sql`AND project_id = ${projectId}` : sql``}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
  ]);

  // Source totals (from live counts)
  const [
    { cnt: totalAuditLogs } = { cnt: 0 },
    { cnt: totalDisputes } = { cnt: 0 },
    { cnt: totalOverrides } = { cnt: 0 },
    { cnt: totalSessions } = { cnt: 0 },
    { cnt: totalFinancial } = { cnt: 0 },
    { cnt: totalSnapshots } = { cnt: 0 },
  ] = await Promise.all([
    db.select({ cnt: count() }).from(auditLogsTable).where(projectId ? eq(auditLogsTable.projectId, projectId) : undefined).then((r) => r[0] ?? { cnt: 0 }),
    db.select({ cnt: count() }).from(disputesTable).where(projectId ? eq(disputesTable.projectId, projectId) : undefined).then((r) => r[0] ?? { cnt: 0 }),
    db.select({ cnt: count() }).from(governanceOverridesTable).where(projectId ? eq(governanceOverridesTable.projectId, projectId) : undefined).then((r) => r[0] ?? { cnt: 0 }),
    db.select({ cnt: count() }).from(userSessionsTable).then((r) => r[0] ?? { cnt: 0 }),
    db.select({ cnt: count() }).from(financialAccessLogsTable).where(projectId ? eq(financialAccessLogsTable.projectId, projectId) : undefined).then((r) => r[0] ?? { cnt: 0 }),
    db.select({ cnt: count() }).from(recordSnapshotsTable).where(projectId ? eq(recordSnapshotsTable.projectId, projectId) : undefined).then((r) => r[0] ?? { cnt: 0 }),
  ]);

  return res.json({
    sourceTotals: [
      { source: "audit_log", label: "Audit Logs", count: Number(totalAuditLogs) },
      { source: "governance", label: "Gov. Overrides", count: Number(totalOverrides) },
      { source: "dispute", label: "Disputes", count: Number(totalDisputes) },
      { source: "session", label: "Sessions", count: Number(totalSessions) },
      { source: "financial", label: "Financial Access", count: Number(totalFinancial) },
      { source: "snapshot", label: "Snapshots", count: Number(totalSnapshots) },
    ],
    auditByModule: auditByModule.map((r) => ({ name: r.module ?? "unclassified", value: Number(r.cnt) })),
    auditByOperation: auditByOp.map((r) => ({ name: r.operation, value: Number(r.cnt) })),
    disputesByType: disputesByType.map((r) => ({ name: r.type, value: Number(r.cnt) })),
    disputesByStatus: disputesByStatus.map((r) => ({ name: r.status, value: Number(r.cnt) })),
    disputesBySeverity: disputesBySeverity.map((r) => ({ name: r.severity, value: Number(r.cnt) })),
    overridesByType: overridesByType.map((r) => ({ name: r.type, value: Number(r.cnt) })),
    overridesByModule: overridesByModule.map((r) => ({ name: r.module, value: Number(r.cnt) })),
    sessionsByRole: sessionsByRole.map((r) => ({ name: r.role ?? "unknown", value: Number(r.cnt) })),
    activityTimeline: (recentActivity.rows as { day: string; cnt: string }[]).map((r) => ({
      day: new Date(r.day).toISOString().split("T")[0],
      count: Number(r.cnt),
    })),
  });
});

// ── GET /detail/:source/:id ───────────────────────────────────────────────────

router.get("/detail/:source/:id", requireRole("admin", "developer"), async (req, res) => {
  const { source, id } = req.params;
  const idFilter = sql`id = ${id}::uuid`;

  let row: Record<string, unknown> | null = null;

  if (source === "audit_log") {
    const rows = await db.select().from(auditLogsTable).where(idFilter).limit(1);
    row = (rows[0] as Record<string, unknown>) ?? null;
  } else if (source === "governance") {
    const rows = await db.select().from(governanceOverridesTable).where(idFilter).limit(1);
    row = (rows[0] as Record<string, unknown>) ?? null;
  } else if (source === "dispute") {
    const rows = await db.select().from(disputesTable).where(idFilter).limit(1);
    row = (rows[0] as Record<string, unknown>) ?? null;
  } else if (source === "session") {
    const rows = await db.select().from(userSessionsTable).where(idFilter).limit(1);
    row = (rows[0] as Record<string, unknown>) ?? null;
  } else if (source === "financial") {
    const rows = await db.select().from(financialAccessLogsTable).where(idFilter).limit(1);
    row = (rows[0] as Record<string, unknown>) ?? null;
  } else if (source === "snapshot") {
    const rows = await db.select().from(recordSnapshotsTable).where(idFilter).limit(1);
    row = (rows[0] as Record<string, unknown>) ?? null;
  } else {
    return res.status(400).json({ error: "Unknown source" });
  }

  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(row);
});

// ── GET /export ───────────────────────────────────────────────────────────────
// Export placeholder — describes available export formats and what's needed.

router.get("/export", requireRole("admin", "developer"), (_req, res) => {
  return res.json({
    available: [
      {
        id: "csv_audit_logs",
        label: "Audit Logs — CSV",
        description: "All audit log entries with operation, module, actor, and timestamp.",
        format: "csv",
        estimatedRows: null,
        status: "available",
        note: "Use the /search endpoint with sources=audit_log and download the response as CSV.",
      },
      {
        id: "csv_governance_overrides",
        label: "Governance Overrides — CSV",
        description: "All governance override actions with actor, reason, and original/final values.",
        format: "csv",
        estimatedRows: null,
        status: "available",
        note: "Use the /search endpoint with sources=governance.",
      },
      {
        id: "csv_disputes",
        label: "Disputes & Conflicts — CSV",
        description: "All dispute records with type, status, severity, and timeline.",
        format: "csv",
        estimatedRows: null,
        status: "available",
        note: "Use the /search endpoint with sources=dispute.",
      },
      {
        id: "pdf_governance_report",
        label: "Governance Compliance Report — PDF",
        description: "Formal governance compliance report for a specified date range and project.",
        format: "pdf",
        estimatedRows: null,
        status: "planned",
        note: "Document generation pipeline not yet connected. Will use DOCX template engine.",
      },
      {
        id: "pdf_investigation_package",
        label: "Investigation Package — PDF",
        description: "Bundled audit trail, snapshots, and evidence for a dispute or override case.",
        format: "pdf",
        estimatedRows: null,
        status: "planned",
        note: "Requires Evidence Archive linkage. Planned for Q3.",
      },
      {
        id: "xlsx_financial_audit",
        label: "Financial Audit Trail — XLSX",
        description: "Full financial module access log with resource, actor, and timestamp.",
        format: "xlsx",
        estimatedRows: null,
        status: "planned",
        note: "XLSX export library not yet integrated.",
      },
    ],
  });
});

// ── GET /filters/options ──────────────────────────────────────────────────────
// Returns distinct values for all filterable dimensions.

router.get("/filters/options", requireRole("admin", "developer"), async (_req, res) => {
  const [modules, actionTypes, disputeTypes, disputeStatuses, severities, userRows, projectRows] =
    await Promise.all([
      db
        .selectDistinct({ module: auditLogsTable.module })
        .from(auditLogsTable)
        .where(sql`${auditLogsTable.module} IS NOT NULL`)
        .limit(50),
      db
        .selectDistinct({ actionType: auditLogsTable.actionType })
        .from(auditLogsTable)
        .where(sql`${auditLogsTable.actionType} IS NOT NULL`)
        .limit(100),
      db.selectDistinct({ type: disputesTable.disputeType }).from(disputesTable),
      db.selectDistinct({ status: disputesTable.status }).from(disputesTable),
      db.selectDistinct({ severity: disputesTable.severity }).from(disputesTable),
      db
        .select({ id: usersTable.id, name: usersTable.displayName, role: usersTable.role })
        .from(usersTable)
        .orderBy(usersTable.displayName)
        .limit(200),
      db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .orderBy(projectsTable.name),
    ]);

  return res.json({
    modules: modules.map((r) => r.module).filter(Boolean),
    actionTypes: actionTypes.map((r) => r.actionType).filter(Boolean),
    disputeTypes: disputeTypes.map((r) => r.type),
    disputeStatuses: disputeStatuses.map((r) => r.status),
    severities: severities.map((r) => r.severity),
    users: userRows,
    projects: projectRows,
  });
});

export default router;

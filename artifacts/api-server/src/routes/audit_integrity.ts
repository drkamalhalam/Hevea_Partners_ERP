/**
 * audit_integrity.ts
 *
 * Security and integrity verification API for the audit / evidence system.
 * All endpoints are restricted to admin and developer roles.
 *
 * Routes:
 *   GET /audit-integrity/anomalies          — high-frequency access patterns (last 24 h)
 *   GET /audit-integrity/coverage           — per-module audit log entry counts
 *   GET /audit-integrity/verify/:table/:id  — audit trail existence for a record
 *   GET /audit-integrity/protected-tables   — row counts + recency for write-once tables
 */

import { Router } from "express";
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  evidenceAccessLogTable,
  documentAccessLogsTable,
  governanceOverridesTable,
  userSessionsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// All routes require admin or developer.
router.use(requireRole("admin", "developer"));

// ── GET /anomalies ────────────────────────────────────────────────────────────
// Detect unusual access patterns in the last 24 hours across evidence and
// document access logs. Flags any actor with > 5 download events.

router.get("/anomalies", async (req, res) => {
  const windowHours = Number(req.query.windowHours) || 24;
  const downloadThreshold = Number(req.query.threshold) || 5;
  const since = new Date(Date.now() - windowHours * 3_600_000);

  const [evidenceAnomalies, documentAnomalies] = await Promise.all([
    db
      .select({
        actorId: evidenceAccessLogTable.actorId,
        actorName: evidenceAccessLogTable.actorName,
        actorRole: evidenceAccessLogTable.actorRole,
        eventCount: count(),
      })
      .from(evidenceAccessLogTable)
      .where(
        and(
          gte(evidenceAccessLogTable.accessedAt, since),
          isNotNull(evidenceAccessLogTable.actorId),
        ),
      )
      .groupBy(
        evidenceAccessLogTable.actorId,
        evidenceAccessLogTable.actorName,
        evidenceAccessLogTable.actorRole,
      )
      .having(sql`count(*) > ${downloadThreshold}`)
      .orderBy(desc(count())),

    db
      .select({
        userId: documentAccessLogsTable.userId,
        userDisplayName: documentAccessLogsTable.userDisplayName,
        userRole: documentAccessLogsTable.userRole,
        eventCount: count(),
      })
      .from(documentAccessLogsTable)
      .where(
        and(
          gte(documentAccessLogsTable.createdAt, since),
          isNotNull(documentAccessLogsTable.userId),
        ),
      )
      .groupBy(
        documentAccessLogsTable.userId,
        documentAccessLogsTable.userDisplayName,
        documentAccessLogsTable.userRole,
      )
      .having(sql`count(*) > ${downloadThreshold}`)
      .orderBy(desc(count())),
  ]);

  return res.json({
    windowHours,
    downloadThreshold,
    since: since.toISOString(),
    evidenceAnomalies: evidenceAnomalies.map((r) => ({
      source: "evidence",
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      actorRole: r.actorRole ?? null,
      eventCount: Number(r.eventCount),
      severity: Number(r.eventCount) > 20 ? "critical" : Number(r.eventCount) > 10 ? "high" : "medium",
    })),
    documentAnomalies: documentAnomalies.map((r) => ({
      source: "documents",
      actorId: r.userId,
      actorName: r.userDisplayName ?? null,
      actorRole: r.userRole ?? null,
      eventCount: Number(r.eventCount),
      severity: Number(r.eventCount) > 20 ? "critical" : Number(r.eventCount) > 10 ? "high" : "medium",
    })),
  });
});

// ── GET /coverage ──────────────────────────────────────────────────────────────
// Per-module audit log entry counts to show which modules are fully traced
// and which are under-covered.

router.get("/coverage", async (_req, res) => {
  const [bySrcModule, last7Days, total] = await Promise.all([
    db
      .select({
        module: auditLogsTable.module,
        operation: auditLogsTable.operation,
        entryCount: count(),
      })
      .from(auditLogsTable)
      .where(isNotNull(auditLogsTable.module))
      .groupBy(auditLogsTable.module, auditLogsTable.operation)
      .orderBy(desc(count())),

    db
      .select({ entryCount: count() })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, new Date(Date.now() - 7 * 86_400_000))),

    db.select({ entryCount: count() }).from(auditLogsTable),
  ]);

  // Roll up per module
  const byModule = new Map<
    string,
    { module: string; total: number; inserts: number; updates: number; deletes: number }
  >();
  for (const row of bySrcModule) {
    const mod = row.module ?? "unknown";
    if (!byModule.has(mod)) {
      byModule.set(mod, { module: mod, total: 0, inserts: 0, updates: 0, deletes: 0 });
    }
    const entry = byModule.get(mod)!;
    entry.total += Number(row.entryCount);
    if (row.operation === "INSERT") entry.inserts += Number(row.entryCount);
    if (row.operation === "UPDATE") entry.updates += Number(row.entryCount);
    if (row.operation === "DELETE") entry.deletes += Number(row.entryCount);
  }

  return res.json({
    totalAuditEntries: Number(total[0]?.entryCount ?? 0),
    entriesLast7Days: Number(last7Days[0]?.entryCount ?? 0),
    byModule: Array.from(byModule.values()).sort((a, b) => b.total - a.total),
  });
});

// ── GET /verify/:table/:recordId ───────────────────────────────────────────────
// Check whether a specific record has an audit trail. Returns the trail if
// present, or a clear "no entries" response if absent.

router.get("/verify/:table/:recordId", async (req, res) => {
  const { table, recordId } = req.params as { table: string; recordId: string };

  const entries = await db
    .select()
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.tableName, table),
        eq(auditLogsTable.recordId, recordId),
      ),
    )
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(50);

  return res.json({
    table,
    recordId,
    hasCoverage: entries.length > 0,
    entryCount: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      operation: e.operation,
      module: e.module ?? null,
      actionType: e.actionType ?? null,
      userId: e.userId ?? null,
      userName: e.userName ?? null,
      userRole: e.userRole ?? null,
      projectId: e.projectId ?? null,
      ipAddress: e.ipAddress ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

// ── GET /protected-tables ─────────────────────────────────────────────────────
// Row counts and recency stats for all write-once / append-only tables.
// Useful for confirming that no rows have been silently deleted.

router.get("/protected-tables", async (_req, res) => {
  const [
    auditLogStats,
    evidenceAccessStats,
    documentAccessStats,
    governanceOverrideStats,
    sessionStats,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        newest: sql<string>`max(created_at)::text`,
        oldest: sql<string>`min(created_at)::text`,
      })
      .from(auditLogsTable),

    db
      .select({
        total: count(),
        newest: sql<string>`max(accessed_at)::text`,
        oldest: sql<string>`min(accessed_at)::text`,
      })
      .from(evidenceAccessLogTable),

    db
      .select({
        total: count(),
        newest: sql<string>`max(created_at)::text`,
        oldest: sql<string>`min(created_at)::text`,
      })
      .from(documentAccessLogsTable),

    db
      .select({
        total: count(),
        newest: sql<string>`max(created_at)::text`,
        oldest: sql<string>`min(created_at)::text`,
      })
      .from(governanceOverridesTable),

    db
      .select({
        total: count(),
        newest: sql<string>`max(created_at)::text`,
        oldest: sql<string>`min(created_at)::text`,
      })
      .from(userSessionsTable),
  ]);

  const row = (
    label: string,
    dbTable: string,
    stats: { total: unknown; newest: unknown; oldest: unknown }[],
  ) => ({
    label,
    dbTable,
    totalRows: Number(stats[0]?.total ?? 0),
    newestEntry: (stats[0]?.newest as string) ?? null,
    oldestEntry: (stats[0]?.oldest as string) ?? null,
    status: Number(stats[0]?.total ?? 0) > 0 ? "healthy" : "empty",
  });

  return res.json({
    tables: [
      row("Audit Logs", "audit_logs", auditLogStats),
      row("Evidence Access Log", "evidence_access_log", evidenceAccessStats),
      row("Document Access Log", "document_access_logs", documentAccessStats),
      row("Governance Overrides", "governance_overrides", governanceOverrideStats),
      row("User Sessions", "user_sessions", sessionStats),
    ],
    generatedAt: new Date().toISOString(),
  });
});

export default router;

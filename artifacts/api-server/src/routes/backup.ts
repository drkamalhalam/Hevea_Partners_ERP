/**
 * backup.ts — ERP backup, export, and integrity verification API.
 *
 * Endpoints:
 *   GET  /backup/history          - List export/check history
 *   POST /backup/export/data      - Export all ERP data as JSON
 *   POST /backup/export/documents - Export document manifest
 *   GET  /backup/verify           - Run integrity checks
 *   GET  /backup/storage-stats    - Document storage statistics
 *
 * All endpoints require admin or developer role.
 * Export endpoints require admin only.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { desc, eq } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { usersTable, backupRunsTable } from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helper: resolve the DB user from a Clerk userId ───────────────────────

async function resolveActor(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return { id: undefined as string | undefined, name: undefined as string | undefined };
  const [row] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return { id: row?.id, name: row?.displayName ?? undefined };
}

// ── Helper: format bytes for logging ─────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── GET /backup/history ───────────────────────────────────────────────────

router.get("/history", requireRole("admin", "developer"), async (req, res) => {
  const limit = Math.min(
    parseInt(String(req.query.limit ?? "50"), 10) || 50,
    200,
  );

  const runs = await db
    .select()
    .from(backupRunsTable)
    .orderBy(desc(backupRunsTable.createdAt))
    .limit(limit);

  return res.json({ runs });
});

// ── POST /backup/export/data ──────────────────────────────────────────────
// Exports every table in the public schema as a structured JSON file.
// Uses dynamic SQL so new tables are captured automatically without code changes.

router.post("/export/data", requireRole("admin"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);
  const startedAt = new Date();
  const notes =
    typeof req.body?.notes === "string" ? req.body.notes : undefined;

  req.log.info({ actor: actor.name }, "ERP data export started");

  try {
    // 1. Discover all tables in the public schema
    const tablesResult = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tableNames = tablesResult.rows.map((r) => r.table_name);

    // 2. Export each table in order
    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const tableName of tableNames) {
      const data = await pool.query(`SELECT * FROM "${tableName}"`);
      tables[tableName] = data.rows;
      counts[tableName] = data.rows.length;
    }

    const totalRecords = Object.values(counts).reduce((s, n) => s + n, 0);
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const exportPayload = {
      meta: {
        schemaVersion: "1.0",
        application: "Hevea Partners ERP",
        exportedAt: completedAt.toISOString(),
        exportedBy: actor.name ?? "unknown",
        environment: process.env.NODE_ENV ?? "unknown",
        tableCount: tableNames.length,
        totalRecords,
        durationMs,
        restoreNote:
          "To restore: set up a PostgreSQL database, run `pnpm --filter @workspace/db run push` to create the schema, then use the companion restore script to import each table.",
      },
      counts,
      tables,
    };

    const jsonString = JSON.stringify(exportPayload);
    const fileSizeBytes = Buffer.byteLength(jsonString, "utf8");

    // 3. Log the run
    await db.insert(backupRunsTable).values({
      type: "data_export",
      status: "completed",
      triggeredBy: actor.id ?? null,
      triggeredByName: actor.name ?? null,
      startedAt,
      completedAt,
      durationMs,
      recordCounts: counts as Record<string, number>,
      totalRecords,
      fileSizeBytes,
      notes: notes ?? null,
    });

    req.log.info(
      { tables: tableNames.length, totalRecords, size: fmtBytes(fileSizeBytes), durationMs },
      "ERP data export completed",
    );

    const filename = `hevea-erp-export-${completedAt.toISOString().split("T")[0]}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return res.send(jsonString);
  } catch (err) {
    const completedAt = new Date();
    await db
      .insert(backupRunsTable)
      .values({
        type: "data_export",
        status: "failed",
        triggeredBy: actor.id ?? null,
        triggeredByName: actor.name ?? null,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorMessage: err instanceof Error ? err.message : String(err),
        notes: notes ?? null,
      })
      .catch(() => {});

    req.log.error({ err }, "ERP data export failed");
    return res.status(500).json({ error: "Data export failed" });
  }
});

// ── POST /backup/export/documents ─────────────────────────────────────────
// Exports a manifest of every document with its GCS storage path and metadata.

router.post("/export/documents", requireRole("admin"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);
  const startedAt = new Date();

  req.log.info({ actor: actor.name }, "Document manifest export started");

  try {
    const docs = await pool.query(`
      SELECT
        d.id,
        d.title,
        d.description,
        d.category,
        d.project_id,
        p.name AS project_name,
        d.agreement_id,
        d.file_object_path,
        d.mime_type,
        d.file_size_bytes,
        d.original_file_name,
        d.status,
        d.uploaded_by_name,
        d.notes,
        d.created_at,
        d.updated_at,
        d.deleted_at,
        d.archived_at
      FROM documents d
      LEFT JOIN projects p ON p.id = d.project_id
      ORDER BY d.created_at DESC
    `);

    const totalFileSizeBytes = docs.rows.reduce(
      (s: number, d: Record<string, unknown>) =>
        s + (typeof d.file_size_bytes === "number" ? d.file_size_bytes : 0),
      0,
    );

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const manifest = {
      meta: {
        schemaVersion: "1.0",
        application: "Hevea Partners ERP",
        exportedAt: completedAt.toISOString(),
        exportedBy: actor.name ?? "unknown",
        totalDocuments: docs.rows.length,
        totalFileSizeBytes,
        durationMs,
        storageNote:
          "file_object_path values are GCS object paths relative to the configured bucket. " +
          "Use gsutil cp or rclone to bulk-copy files when migrating storage providers. " +
          "The REPLIT_SIDECAR_ENDPOINT environment variable controls the storage sidecar URL.",
      },
      documents: docs.rows,
    };

    const jsonString = JSON.stringify(manifest, null, 2);
    const fileSizeBytes = Buffer.byteLength(jsonString, "utf8");

    await db.insert(backupRunsTable).values({
      type: "document_manifest",
      status: "completed",
      triggeredBy: actor.id ?? null,
      triggeredByName: actor.name ?? null,
      startedAt,
      completedAt,
      durationMs,
      totalRecords: docs.rows.length,
      fileSizeBytes,
      recordCounts: { documents: docs.rows.length } as Record<string, number>,
    });

    req.log.info(
      { totalDocuments: docs.rows.length, totalFileSizeBytes, durationMs },
      "Document manifest export completed",
    );

    const filename = `hevea-document-manifest-${completedAt.toISOString().split("T")[0]}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return res.send(jsonString);
  } catch (err) {
    const completedAt = new Date();
    await db
      .insert(backupRunsTable)
      .values({
        type: "document_manifest",
        status: "failed",
        triggeredBy: actor.id ?? null,
        triggeredByName: actor.name ?? null,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .catch(() => {});

    req.log.error({ err }, "Document manifest export failed");
    return res.status(500).json({ error: "Document manifest export failed" });
  }
});

// ── GET /backup/verify ────────────────────────────────────────────────────
// Runs a suite of referential integrity and consistency checks.

router.get("/verify", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);
  const startedAt = new Date();

  req.log.info({ actor: actor.name }, "Integrity check started");

  try {
    // Live row counts from pg_stat (fast — no table scans)
    const statResult = await pool.query<{
      relname: string;
      n_live_tup: string;
    }>(`
      SELECT relname, n_live_tup
      FROM pg_stat_user_tables
      ORDER BY relname
    `);

    const tableCounts: Record<string, number> = {};
    for (const row of statResult.rows) {
      tableCounts[row.relname] = parseInt(row.n_live_tup, 10) || 0;
    }

    type Issue = {
      severity: "error" | "warning" | "info";
      check: string;
      detail: string;
    };
    const issues: Issue[] = [];

    // Check 1: Documents with null/empty storage paths
    const nullPathDocs = await pool.query(
      `SELECT COUNT(*) AS cnt FROM documents WHERE file_object_path IS NULL OR file_object_path = ''`,
    );
    const nullPathCount = parseInt(nullPathDocs.rows[0]?.cnt ?? "0", 10);
    if (nullPathCount > 0) {
      issues.push({
        severity: "error",
        check: "documents.file_object_path",
        detail: `${nullPathCount} document(s) have no storage path — these files cannot be retrieved or migrated.`,
      });
    }

    // Check 2: Documents referencing non-existent projects
    const orphanedDocs = await pool.query(`
      SELECT COUNT(*) AS cnt FROM documents d
      WHERE d.project_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id)
    `);
    const orphanedDocsCount = parseInt(orphanedDocs.rows[0]?.cnt ?? "0", 10);
    if (orphanedDocsCount > 0) {
      issues.push({
        severity: "warning",
        check: "documents → projects FK",
        detail: `${orphanedDocsCount} document(s) reference project IDs that no longer exist.`,
      });
    }

    // Check 3: Non-admin users without project assignments
    const unassigned = await pool.query(`
      SELECT COUNT(*) AS cnt FROM users u
      WHERE u.role NOT IN ('admin', 'developer')
        AND NOT EXISTS (
          SELECT 1 FROM user_project_assignments a WHERE a.user_id = u.id
        )
    `);
    const unassignedCount = parseInt(unassigned.rows[0]?.cnt ?? "0", 10);
    if (unassignedCount > 0) {
      issues.push({
        severity: "warning",
        check: "user_project_assignments coverage",
        detail: `${unassignedCount} non-admin/developer user(s) have no project assignment — they cannot access any project data.`,
      });
    }

    // Check 4: EPP entries referencing missing settlement sessions
    const orphanedEpp = await pool.query(`
      SELECT COUNT(*) AS cnt FROM epp_entries e
      WHERE NOT EXISTS (SELECT 1 FROM fifty_pct_sessions s WHERE s.id = e.session_id)
    `);
    const orphanedEppCount = parseInt(orphanedEpp.rows[0]?.cnt ?? "0", 10);
    if (orphanedEppCount > 0) {
      issues.push({
        severity: "error",
        check: "epp_entries → fifty_pct_sessions FK",
        detail: `${orphanedEppCount} EPP entry/entries reference non-existent settlement sessions.`,
      });
    }

    // Check 5: Duplicate Clerk user IDs in users table
    const dupClerks = await pool.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT clerk_user_id FROM users
        GROUP BY clerk_user_id HAVING COUNT(*) > 1
      ) dups
    `);
    const dupCount = parseInt(dupClerks.rows[0]?.cnt ?? "0", 10);
    if (dupCount > 0) {
      issues.push({
        severity: "error",
        check: "users.clerk_user_id uniqueness",
        detail: `${dupCount} duplicate Clerk user ID(s) found — authentication integrity is compromised.`,
      });
    }

    // Check 6: Projects with lifecycle history gaps (no 'prematurity' entry)
    const projectsNoLifecycle = await pool.query(`
      SELECT COUNT(*) AS cnt FROM projects p
      WHERE NOT EXISTS (
        SELECT 1 FROM project_lifecycle_history h WHERE h.project_id = p.id
      )
    `);
    const noLifecycleCount = parseInt(projectsNoLifecycle.rows[0]?.cnt ?? "0", 10);
    if (noLifecycleCount > 0) {
      issues.push({
        severity: "warning",
        check: "project_lifecycle_history coverage",
        detail: `${noLifecycleCount} project(s) have no lifecycle history entries — audit trail may be incomplete.`,
      });
    }

    // Check 7: Partners without any project assignments
    const unassignedPartners = await pool.query(`
      SELECT COUNT(*) AS cnt FROM partners p
      WHERE NOT EXISTS (
        SELECT 1 FROM user_project_assignments a
        JOIN users u ON u.id = a.user_id
        WHERE u.partner_id = p.id
      )
    `);
    const unassignedPartnersCount = parseInt(unassignedPartners.rows[0]?.cnt ?? "0", 10);
    if (unassignedPartnersCount > 0) {
      issues.push({
        severity: "info",
        check: "partners → assignments coverage",
        detail: `${unassignedPartnersCount} partner(s) have no associated user with project assignments.`,
      });
    }

    if (issues.filter((i) => i.severity !== "info").length === 0) {
      issues.push({
        severity: "info",
        check: "all checks",
        detail: "All integrity checks passed — no errors or warnings detected.",
      });
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const issueCount = issues.filter(
      (i) => i.severity === "error" || i.severity === "warning",
    ).length;

    await db.insert(backupRunsTable).values({
      type: "integrity_check",
      status: "completed",
      triggeredBy: actor.id ?? null,
      triggeredByName: actor.name ?? null,
      startedAt,
      completedAt,
      durationMs,
      totalRecords: Object.values(tableCounts).reduce((s, n) => s + n, 0),
      recordCounts: tableCounts as Record<string, number>,
      metadata: { issueCount } as Record<string, unknown>,
    });

    req.log.info(
      { checksPerformed: 7, issueCount, durationMs },
      "Integrity check completed",
    );

    return res.json({
      tableCounts,
      issues,
      checksPerformed: 7,
      issueCount,
      checkedAt: completedAt.toISOString(),
      durationMs,
    });
  } catch (err) {
    req.log.error({ err }, "Integrity check failed");
    return res.status(500).json({ error: "Integrity check failed" });
  }
});

// ── GET /backup/storage-stats ─────────────────────────────────────────────

router.get("/storage-stats", requireRole("admin", "developer"), async (req, res) => {
  try {
    const byCategory = await pool.query(`
      SELECT
        category,
        COUNT(*) AS count,
        COALESCE(SUM(file_size_bytes), 0) AS total_bytes
      FROM documents
      WHERE deleted_at IS NULL
      GROUP BY category
      ORDER BY total_bytes DESC
    `);

    const byProject = await pool.query(`
      SELECT
        COALESCE(p.name, 'Global / Unassigned') AS project_name,
        COUNT(d.id) AS count,
        COALESCE(SUM(d.file_size_bytes), 0) AS total_bytes
      FROM documents d
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.deleted_at IS NULL
      GROUP BY p.name
      ORDER BY total_bytes DESC
      LIMIT 20
    `);

    const totals = await pool.query(`
      SELECT
        COUNT(*) AS total_documents,
        COUNT(*) FILTER (WHERE status = 'active' AND deleted_at IS NULL) AS active_documents,
        COUNT(*) FILTER (WHERE status = 'archived') AS archived_documents,
        COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted_documents,
        COUNT(*) FILTER (WHERE file_object_path IS NULL OR file_object_path = '') AS missing_path_documents,
        COALESCE(SUM(file_size_bytes), 0) AS total_bytes,
        COALESCE(SUM(file_size_bytes) FILTER (WHERE status = 'active' AND deleted_at IS NULL), 0) AS active_bytes
      FROM documents
    `);

    const t = totals.rows[0] as Record<string, string | null>;

    return res.json({
      totalDocuments: parseInt(t.total_documents ?? "0", 10),
      activeDocuments: parseInt(t.active_documents ?? "0", 10),
      archivedDocuments: parseInt(t.archived_documents ?? "0", 10),
      deletedDocuments: parseInt(t.deleted_documents ?? "0", 10),
      missingPathDocuments: parseInt(t.missing_path_documents ?? "0", 10),
      totalFileSizeBytes: parseInt(t.total_bytes ?? "0", 10),
      activeFileSizeBytes: parseInt(t.active_bytes ?? "0", 10),
      byCategory: byCategory.rows.map((r: Record<string, unknown>) => ({
        category: r.category as string,
        count: parseInt(String(r.count), 10),
        totalBytes: parseInt(String(r.total_bytes), 10),
      })),
      byProject: byProject.rows.map((r: Record<string, unknown>) => ({
        projectName: r.project_name as string,
        count: parseInt(String(r.count), 10),
        totalBytes: parseInt(String(r.total_bytes), 10),
      })),
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Storage stats query failed");
    return res.status(500).json({ error: "Storage stats query failed" });
  }
});

export default router;

/**
 * project_audit_trail.ts — unified read-only audit timeline for a project.
 *
 *   GET /:projectId/audit-trail
 *     ?limit=50&offset=0&eventType=…&entityType=…
 *
 * Merges three sources into a single chronologically-ordered list:
 *   - project_audit_trail        (structural / governance changes)
 *   - project_lifecycle_history  (prematurity → mature → closed transitions)
 *   - governance_overrides       (manual governance notes & override records)
 *
 * Write-once: no POST/PATCH/DELETE.
 */

import { Router } from "express";
import {
  db,
  projectAuditTrailTable,
  projectLifecycleHistoryTable,
  governanceOverridesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { canAccessProject } from "../middlewares/auth";
import { enforceWriteOnce } from "../lib/integrityMiddleware";

const router = Router();

router.get("/:projectId/audit-trail", async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

  const [auditRows, lifecycleRows, overrideRows] = await Promise.all([
    db
      .select()
      .from(projectAuditTrailTable)
      .where(eq(projectAuditTrailTable.projectId, projectId))
      .orderBy(desc(projectAuditTrailTable.occurredAt)),
    db
      .select()
      .from(projectLifecycleHistoryTable)
      .where(eq(projectLifecycleHistoryTable.projectId, projectId))
      .orderBy(desc(projectLifecycleHistoryTable.changedAt)),
    db
      .select()
      .from(governanceOverridesTable)
      .where(eq(governanceOverridesTable.projectId, projectId))
      .orderBy(desc(governanceOverridesTable.occurredAt)),
  ]);

  const unified = [
    ...auditRows.map((r) => ({
      id: r.id,
      source: "project_audit_trail" as const,
      occurredAt: r.occurredAt.toISOString(),
      eventType: r.eventType,
      entityType: r.entityType,
      entityId: r.entityId ?? null,
      title: r.title,
      description: r.description ?? null,
      beforeData: r.beforeData ?? null,
      afterData: r.afterData ?? null,
      reason: r.reason ?? null,
      governanceOverrideId: r.governanceOverrideId ?? null,
      actorId: r.actorId ?? null,
      actorName: r.actorName ?? null,
      actorRole: r.actorRole ?? null,
      metadata: r.metadata ?? null,
    })),
    ...lifecycleRows.map((r) => ({
      id: r.id,
      source: "project_lifecycle_history" as const,
      occurredAt: r.changedAt.toISOString(),
      eventType: "lifecycle_changed",
      entityType: "project_lifecycle",
      entityId: r.projectId,
      title: `Lifecycle: ${r.fromStatus ?? "—"} → ${r.toStatus}`,
      description: r.remarks ?? null,
      beforeData: r.fromStatus ? { lifecycleStatus: r.fromStatus } : null,
      afterData: { lifecycleStatus: r.toStatus },
      reason: r.remarks ?? null,
      governanceOverrideId: null,
      actorId: r.changedBy ?? null,
      actorName: r.changedByName ?? null,
      actorRole: null,
      metadata: null,
    })),
    ...overrideRows.map((r) => ({
      id: r.id,
      source: "governance_overrides" as const,
      occurredAt: r.occurredAt.toISOString(),
      eventType: `override:${r.overrideType}`,
      entityType: r.module,
      entityId: r.relatedRecordId ?? null,
      title: r.title,
      description: r.description ?? null,
      beforeData: r.originalValue ?? null,
      afterData: r.finalValue ?? null,
      reason: r.overrideReason,
      governanceOverrideId: r.id,
      actorId: r.actorId ?? null,
      actorName: r.actorName ?? null,
      actorRole: r.actorRole ?? null,
      metadata: r.metadata ?? null,
    })),
  ].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );

  const page = unified.slice(offset, offset + limit);
  res.json({ events: page, total: unified.length });
});

// Explicit write-once protection — unified audit timeline is read-only.
router.post(/.*\/audit-trail.*/, enforceWriteOnce("project audit trail"));
router.put(/.*\/audit-trail.*/, enforceWriteOnce("project audit trail"));
router.patch(/.*\/audit-trail.*/, enforceWriteOnce("project audit trail"));
router.delete(/.*\/audit-trail.*/, enforceWriteOnce("project audit trail"));

export default router;

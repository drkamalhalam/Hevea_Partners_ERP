/**
 * evidence.ts
 *
 * Secure legal document evidence archive API.
 *
 * Routes:
 *   POST /evidence                     — register a new archive record (admin/dev)
 *   GET  /evidence                     — search/list with filters
 *   GET  /evidence/stats               — aggregate counts (BEFORE /:id)
 *   GET  /evidence/:id                 — single record + access log
 *   GET  /evidence/:id/download        — stream file (logs access)
 *   POST /evidence/:id/versions        — register a new version (admin/dev)
 *   PATCH /evidence/:id/status         — archive/restore status (admin/dev)
 *
 * Write-once constraints:
 *   - evidenceAccessLogTable has no UPDATE/DELETE routes
 *   - legalEvidenceArchiveTable records are never deleted
 *   - fileObjectPath and core metadata fields are set on creation and not updated
 */

import { Readable } from "stream";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  SQL,
} from "drizzle-orm";
import {
  db,
  legalEvidenceArchiveTable,
  evidenceAccessLogTable,
  projectsTable,
  usersTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireRole } from "../middlewares/auth";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveUser(clerkUserId: string) {
  const [user] = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

async function getUserProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map((r) => r.projectId);
}

function fmt(
  e: typeof legalEvidenceArchiveTable.$inferSelect & { projectName?: string | null },
  accessCount?: number,
) {
  return {
    id: e.id,
    projectId: e.projectId ?? null,
    projectName: e.projectName ?? null,
    documentType: e.documentType,
    title: e.title,
    description: e.description ?? null,
    tags: (e.tags as string[] | null) ?? null,
    versionNumber: e.versionNumber,
    parentArchiveId: e.parentArchiveId ?? null,
    isLatestVersion: e.isLatestVersion,
    fileObjectPath: e.fileObjectPath ?? null,
    externalUrl: e.externalUrl ?? null,
    originalFileName: e.originalFileName ?? null,
    fileSizeBytes: e.fileSizeBytes ?? null,
    mimeType: e.mimeType ?? null,
    checksum: e.checksum ?? null,
    relatedTable: e.relatedTable ?? null,
    relatedRecordId: e.relatedRecordId ?? null,
    documentDate: e.documentDate?.toISOString() ?? null,
    issuingAuthority: e.issuingAuthority ?? null,
    referenceNumber: e.referenceNumber ?? null,
    uploadedById: e.uploadedById ?? null,
    uploadedByName: e.uploadedByName ?? null,
    uploadedByRole: e.uploadedByRole ?? null,
    archiveStatus: e.archiveStatus,
    metadata: e.metadata ?? null,
    accessCount: accessCount ?? null,
    archivedAt: e.archivedAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
  };
}

function fmtAccess(a: typeof evidenceAccessLogTable.$inferSelect) {
  return {
    id: a.id,
    evidenceId: a.evidenceId,
    projectId: a.projectId ?? null,
    documentType: a.documentType ?? null,
    documentTitle: a.documentTitle ?? null,
    accessType: a.accessType,
    actorId: a.actorId ?? null,
    actorName: a.actorName ?? null,
    actorRole: a.actorRole ?? null,
    ipAddress: a.ipAddress ?? null,
    userAgent: a.userAgent ?? null,
    accessedAt: a.accessedAt.toISOString(),
  };
}

async function writeAccessLog(
  evidenceId: string,
  ev: {
    projectId?: string | null;
    documentType?: string | null;
    documentTitle?: string | null;
    accessType: string;
    actorId?: string | null;
    actorName?: string | null;
    actorRole?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
) {
  await db.insert(evidenceAccessLogTable).values({
    evidenceId,
    projectId: ev.projectId ?? null,
    documentType: ev.documentType ?? null,
    documentTitle: ev.documentTitle ?? null,
    accessType: ev.accessType,
    actorId: ev.actorId ?? null,
    actorName: ev.actorName ?? null,
    actorRole: ev.actorRole ?? null,
    ipAddress: ev.ipAddress ?? null,
    userAgent: ev.userAgent ?? null,
  });
}

// Determine if the user can access a given archive record
async function canAccess(
  user: { id: string; role: string },
  row: typeof legalEvidenceArchiveTable.$inferSelect,
): Promise<boolean> {
  if (user.role === "admin" || user.role === "developer") return true;
  if (!row.projectId) return false; // global docs are admin/dev only
  const assigned = await getUserProjectIds(user.id);
  return assigned.includes(row.projectId);
}

// ── Validation schemas ────────────────────────────────────────────────────────

const DOCUMENT_TYPES = [
  "agreement",
  "declaration_deed",
  "death_certificate",
  "gd_entry",
  "invoice",
  "payment_proof",
  "governance_document",
  "supporting_evidence",
  "other",
] as const;

const createSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  documentType: z.enum(DOCUMENT_TYPES),
  title: z.string().min(3),
  description: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  // Storage
  fileObjectPath: z.string().optional().nullable(),
  externalUrl: z.string().url().optional().nullable(),
  originalFileName: z.string().optional().nullable(),
  fileSizeBytes: z.number().int().positive().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  checksum: z.string().optional().nullable(),
  // Linkage
  relatedTable: z.string().optional().nullable(),
  relatedRecordId: z.string().optional().nullable(),
  // Evidentiary metadata
  documentDate: z.string().datetime({ offset: true }).optional().nullable(),
  issuingAuthority: z.string().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

// ── POST /evidence ────────────────────────────────────────────────────────────

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkUserId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const b = parsed.data;

  if (!b.fileObjectPath && !b.externalUrl) {
    return res.status(400).json({ error: "Either fileObjectPath or externalUrl is required" });
  }

  // Verify project if given
  if (b.projectId) {
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, b.projectId))
      .limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });
  }

  const [record] = await db
    .insert(legalEvidenceArchiveTable)
    .values({
      projectId: b.projectId ?? null,
      documentType: b.documentType,
      title: b.title,
      description: b.description ?? null,
      tags: b.tags ?? null,
      versionNumber: 1,
      parentArchiveId: null,
      isLatestVersion: true,
      fileObjectPath: b.fileObjectPath ?? null,
      externalUrl: b.externalUrl ?? null,
      originalFileName: b.originalFileName ?? null,
      fileSizeBytes: b.fileSizeBytes ?? null,
      mimeType: b.mimeType ?? null,
      checksum: b.checksum ?? null,
      relatedTable: b.relatedTable ?? null,
      relatedRecordId: b.relatedRecordId ?? null,
      documentDate: b.documentDate ? new Date(b.documentDate) : null,
      issuingAuthority: b.issuingAuthority ?? null,
      referenceNumber: b.referenceNumber ?? null,
      uploadedById: user.id,
      uploadedByName: user.displayName ?? null,
      uploadedByRole: user.role,
      archiveStatus: "active",
      metadata: b.metadata ?? null,
    })
    .returning();

  // Log creation as first access event
  void writeAccessLog(record.id, {
    projectId: record.projectId,
    documentType: record.documentType,
    documentTitle: record.title,
    accessType: "upload",
    actorId: user.id,
    actorName: user.displayName ?? null,
    actorRole: user.role,
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  req.log.info({ evidenceId: record.id, documentType: b.documentType }, "Evidence archived");
  return res.status(201).json({ evidence: fmt(record) });
});

// ── GET /evidence ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkUserId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const q = req.query as Record<string, string>;
  const limit = Math.min(parseInt(q.limit ?? "30", 10), 100);
  const offset = parseInt(q.offset ?? "0", 10);
  const onlyLatest = q.onlyLatest !== "false"; // default: only show latest versions

  const conditions: SQL[] = [];

  // Project scoping
  const isAdminDev = user.role === "admin" || user.role === "developer";
  if (!isAdminDev) {
    const assigned = await getUserProjectIds(user.id);
    if (assigned.length === 0) {
      return res.json({ evidence: [], total: 0 });
    }
    conditions.push(inArray(legalEvidenceArchiveTable.projectId, assigned));
  }

  if (q.projectId) conditions.push(eq(legalEvidenceArchiveTable.projectId, q.projectId));
  if (q.documentType) conditions.push(eq(legalEvidenceArchiveTable.documentType, q.documentType));
  if (q.archiveStatus) conditions.push(eq(legalEvidenceArchiveTable.archiveStatus, q.archiveStatus));
  if (q.search) {
    conditions.push(
      or(
        ilike(legalEvidenceArchiveTable.title, `%${q.search}%`),
        ilike(legalEvidenceArchiveTable.referenceNumber, `%${q.search}%`),
        ilike(legalEvidenceArchiveTable.issuingAuthority, `%${q.search}%`),
      )!,
    );
  }
  if (onlyLatest) conditions.push(eq(legalEvidenceArchiveTable.isLatestVersion, true));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        evidence: legalEvidenceArchiveTable,
        projectName: projectsTable.name,
      })
      .from(legalEvidenceArchiveTable)
      .leftJoin(projectsTable, eq(legalEvidenceArchiveTable.projectId, projectsTable.id))
      .where(where)
      .orderBy(desc(legalEvidenceArchiveTable.archivedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(legalEvidenceArchiveTable).where(where),
  ]);

  return res.json({
    evidence: rows.map((r) => fmt({ ...r.evidence, projectName: r.projectName ?? null })),
    total: Number(total),
  });
});

// ── GET /evidence/stats ───────────────────────────────────────────────────────
// MUST be before /:id

router.get("/stats", requireRole("admin", "developer"), async (req, res) => {
  const q = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (q.projectId) conditions.push(eq(legalEvidenceArchiveTable.projectId, q.projectId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Total + by type
  const allRows = await db
    .select({
      evidence: legalEvidenceArchiveTable,
      projectName: projectsTable.name,
    })
    .from(legalEvidenceArchiveTable)
    .leftJoin(projectsTable, eq(legalEvidenceArchiveTable.projectId, projectsTable.id))
    .where(where)
    .orderBy(desc(legalEvidenceArchiveTable.archivedAt));

  const byType = new Map<string, number>();
  const byProject = new Map<string, { name: string; count: number }>();
  const byStatus = new Map<string, number>();

  for (const r of allRows) {
    byType.set(r.evidence.documentType, (byType.get(r.evidence.documentType) ?? 0) + 1);
    byStatus.set(r.evidence.archiveStatus, (byStatus.get(r.evidence.archiveStatus) ?? 0) + 1);
    if (r.evidence.projectId) {
      const k = r.evidence.projectId;
      if (!byProject.has(k)) byProject.set(k, { name: r.projectName ?? k, count: 0 });
      byProject.get(k)!.count++;
    }
  }

  // Recent 10 (latest versions only)
  const recent = allRows
    .filter((r) => r.evidence.isLatestVersion)
    .slice(0, 10)
    .map((r) => fmt({ ...r.evidence, projectName: r.projectName ?? null }));

  // Access stats: total access events in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const accessRows = await db
    .select({ accessType: evidenceAccessLogTable.accessType })
    .from(evidenceAccessLogTable)
    .where(
      where
        ? and(
            inArray(
              evidenceAccessLogTable.evidenceId,
              allRows.map((r) => r.evidence.id),
            ),
          )
        : undefined,
    );

  return res.json({
    total: allRows.length,
    latestVersionCount: allRows.filter((r) => r.evidence.isLatestVersion).length,
    byType: Array.from(byType.entries()).map(([documentType, count]) => ({ documentType, count })),
    byProject: Array.from(byProject.entries()).map(([projectId, v]) => ({
      projectId,
      projectName: v.name,
      count: v.count,
    })),
    byStatus: Array.from(byStatus.entries()).map(([archiveStatus, count]) => ({ archiveStatus, count })),
    recentlyArchived: recent,
    totalAccessEvents: accessRows.length,
  });
});

// ── GET /evidence/:id ─────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkUserId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const { id } = req.params as { id: string };

  const [row] = await db
    .select({ evidence: legalEvidenceArchiveTable, projectName: projectsTable.name })
    .from(legalEvidenceArchiveTable)
    .leftJoin(projectsTable, eq(legalEvidenceArchiveTable.projectId, projectsTable.id))
    .where(eq(legalEvidenceArchiveTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ error: "Evidence not found" });

  if (!(await canAccess(user, row.evidence))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Version history: all records sharing same root (parent chain)
  const rootId = row.evidence.parentArchiveId ?? row.evidence.id;
  const versionHistory = await db
    .select()
    .from(legalEvidenceArchiveTable)
    .where(
      or(
        eq(legalEvidenceArchiveTable.id, rootId),
        eq(legalEvidenceArchiveTable.parentArchiveId, rootId),
      )!,
    )
    .orderBy(asc(legalEvidenceArchiveTable.versionNumber));

  // Access log (last 50)
  const accessLog = await db
    .select()
    .from(evidenceAccessLogTable)
    .where(eq(evidenceAccessLogTable.evidenceId, id))
    .orderBy(desc(evidenceAccessLogTable.accessedAt))
    .limit(50);

  const [{ accessCount }] = await db
    .select({ accessCount: count() })
    .from(evidenceAccessLogTable)
    .where(eq(evidenceAccessLogTable.evidenceId, id));

  // Log view event (fire-and-forget)
  void writeAccessLog(id, {
    projectId: row.evidence.projectId,
    documentType: row.evidence.documentType,
    documentTitle: row.evidence.title,
    accessType: "view",
    actorId: user.id,
    actorName: user.displayName ?? null,
    actorRole: user.role,
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  return res.json({
    evidence: fmt({ ...row.evidence, projectName: row.projectName ?? null }, Number(accessCount)),
    versionHistory: versionHistory.map((v) => fmt(v)),
    accessLog: accessLog.map(fmtAccess),
  });
});

// ── GET /evidence/:id/download ────────────────────────────────────────────────

router.get("/:id/download", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkUserId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const { id } = req.params as { id: string };

  const [row] = await db
    .select()
    .from(legalEvidenceArchiveTable)
    .where(eq(legalEvidenceArchiveTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ error: "Evidence not found" });
  if (!(await canAccess(user, row))) return res.status(403).json({ error: "Forbidden" });
  if (!row.fileObjectPath) {
    return res.status(400).json({ error: "This record has no stored file — it uses an external URL" });
  }

  // ── Access anomaly detection ─────────────────────────────────────────────
  // Count downloads by this actor in the last 24 h. Log a warning and add a
  // response header if the threshold is exceeded — does NOT block the request.
  const anomalyWindowStart = new Date(Date.now() - 86_400_000);
  const [{ downloadCount }] = await db
    .select({ downloadCount: count() })
    .from(evidenceAccessLogTable)
    .where(
      and(
        eq(evidenceAccessLogTable.actorId, user.id),
        gte(evidenceAccessLogTable.accessedAt, anomalyWindowStart),
      ),
    );
  const isAnomaly = Number(downloadCount) > 5;
  if (isAnomaly) {
    req.log.warn(
      { actorId: user.id, actorRole: user.role, evidenceId: id, downloadCount },
      "evidence: high-frequency download anomaly detected",
    );
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(row.fileObjectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    if (row.mimeType) res.setHeader("Content-Type", row.mimeType);
    if (row.fileSizeBytes) res.setHeader("Content-Length", row.fileSizeBytes);
    // Integrity + audit traceability headers
    if (row.checksum) res.setHeader("X-Evidence-Checksum", row.checksum);
    res.setHeader("X-Access-Logged", "true");
    res.setHeader("X-Actor-Role", user.role ?? "unknown");
    if (isAnomaly) res.setHeader("X-Access-Anomaly", "high-frequency");
    if (row.originalFileName) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(row.originalFileName)}"`,
      );
    }

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }

    // Log download (fire-and-forget, after response starts)
    void writeAccessLog(id, {
      projectId: row.projectId,
      documentType: row.documentType,
      documentTitle: row.title,
      accessType: "download",
      actorId: user.id,
      actorName: user.displayName ?? null,
      actorRole: user.role,
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    return;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return res.status(404).json({ error: "File not found in storage" });
    }
    req.log.error({ err: error }, "Evidence download failed");
    return res.status(500).json({ error: "Download failed" });
  }
});

// ── POST /evidence/:id/versions ───────────────────────────────────────────────

router.post("/:id/versions", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkUserId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const { id } = req.params as { id: string };

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const b = parsed.data;

  const [existing] = await db
    .select()
    .from(legalEvidenceArchiveTable)
    .where(eq(legalEvidenceArchiveTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Evidence not found" });
  if (!existing.isLatestVersion) {
    return res.status(409).json({ error: "Can only add versions to the latest version of a record" });
  }

  // Mark previous version as superseded
  await db
    .update(legalEvidenceArchiveTable)
    .set({ isLatestVersion: false, archiveStatus: "superseded" })
    .where(eq(legalEvidenceArchiveTable.id, id));

  // Determine root for version chain
  const rootId = existing.parentArchiveId ?? existing.id;
  const newVersionNumber = existing.versionNumber + 1;

  const [newRecord] = await db
    .insert(legalEvidenceArchiveTable)
    .values({
      projectId: b.projectId ?? existing.projectId,
      documentType: b.documentType ?? existing.documentType,
      title: b.title ?? existing.title,
      description: b.description ?? existing.description,
      tags: b.tags ?? (existing.tags as string[] | null),
      versionNumber: newVersionNumber,
      parentArchiveId: rootId,
      isLatestVersion: true,
      fileObjectPath: b.fileObjectPath ?? null,
      externalUrl: b.externalUrl ?? null,
      originalFileName: b.originalFileName ?? null,
      fileSizeBytes: b.fileSizeBytes ?? null,
      mimeType: b.mimeType ?? null,
      checksum: b.checksum ?? null,
      relatedTable: b.relatedTable ?? existing.relatedTable,
      relatedRecordId: b.relatedRecordId ?? existing.relatedRecordId,
      documentDate: b.documentDate ? new Date(b.documentDate) : existing.documentDate,
      issuingAuthority: b.issuingAuthority ?? existing.issuingAuthority,
      referenceNumber: b.referenceNumber ?? existing.referenceNumber,
      uploadedById: user.id,
      uploadedByName: user.displayName ?? null,
      uploadedByRole: user.role,
      archiveStatus: "active",
      metadata: b.metadata ?? (existing.metadata as Record<string, unknown> | null),
    })
    .returning();

  void writeAccessLog(newRecord.id, {
    projectId: newRecord.projectId,
    documentType: newRecord.documentType,
    documentTitle: newRecord.title,
    accessType: "upload",
    actorId: user.id,
    actorName: user.displayName ?? null,
    actorRole: user.role,
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  req.log.info(
    { evidenceId: newRecord.id, parentId: id, version: newVersionNumber },
    "New evidence version archived",
  );
  return res.status(201).json({ evidence: fmt(newRecord), superseded: fmt(existing) });
});

// ── PATCH /evidence/:id/status ────────────────────────────────────────────────

router.patch("/:id/status", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params as { id: string };
  const { archiveStatus, reason } = req.body as { archiveStatus: string; reason?: string };

  const allowed = ["active", "archived"];
  if (!allowed.includes(archiveStatus)) {
    return res.status(400).json({ error: `archiveStatus must be one of: ${allowed.join(", ")}` });
  }

  const [existing] = await db
    .select()
    .from(legalEvidenceArchiveTable)
    .where(eq(legalEvidenceArchiveTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Evidence not found" });
  if (existing.archiveStatus === "superseded") {
    return res.status(409).json({ error: "Cannot change status of a superseded version" });
  }

  const [updated] = await db
    .update(legalEvidenceArchiveTable)
    .set({ archiveStatus })
    .where(eq(legalEvidenceArchiveTable.id, id))
    .returning();

  req.log.info({ evidenceId: id, archiveStatus, reason }, "Evidence status updated");
  return res.json({ evidence: fmt(updated) });
});

export default router;

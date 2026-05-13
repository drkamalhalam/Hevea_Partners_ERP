/**
 * Sales audit log, document archive, and governance alerts routes.
 * Mounted at /api/sales (same prefix as sales.ts — Express merges them).
 */
import { Router, type IRouter } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { eq, and, desc, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  salesTransactionsTable,
  saleAuditEventsTable,
  saleDocumentsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { writeSaleAudit } from "../lib/saleAuditHelper";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function canAccessAllProjects(role: string) {
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

function formatAuditEvent(row: typeof saleAuditEventsTable.$inferSelect) {
  return {
    id: row.id,
    transactionId: row.transactionId ?? undefined,
    saleNumber: row.saleNumber,
    projectId: row.projectId ?? undefined,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId ?? undefined,
    description: row.description,
    fieldChanges: (row.fieldChanges as unknown[] | null) ?? [],
    riskLevel: row.riskLevel,
    riskReason: row.riskReason ?? undefined,
    actorName: row.actorName,
    actorRole: row.actorRole,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatDocument(row: typeof saleDocumentsTable.$inferSelect) {
  return {
    id: row.id,
    transactionId: row.transactionId,
    saleNumber: row.saleNumber,
    projectId: row.projectId ?? undefined,
    documentType: row.documentType,
    title: row.title,
    description: row.description ?? undefined,
    fileObjectPath: row.fileObjectPath,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes ?? undefined,
    originalFileName: row.originalFileName,
    status: row.status,
    uploadedByName: row.uploadedByName,
    archivedAt: row.archivedAt?.toISOString() ?? undefined,
    archivedByName: row.archivedByName ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /sales/governance/alerts ───────────────────────────────────────────────
// Returns watch + flag level events for admin/developer governance review.

router.get(
  "/governance/alerts",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const { projectId, riskLevel, from, to } = req.query as Record<string, string>;

    let projectIds: string[];
    if (canAccessAllProjects(actor.role)) {
      if (projectId) {
        projectIds = [projectId];
      } else {
        const projects = await db.select({ id: projectsTable.id }).from(projectsTable);
        projectIds = projects.map((p) => p.id);
      }
    } else {
      const assigned = await getAssignedProjectIds(actor.id);
      projectIds = projectId && assigned.includes(projectId) ? [projectId] : assigned;
    }

    const rows = await db
      .select()
      .from(saleAuditEventsTable)
      .where(
        and(
          inArray(saleAuditEventsTable.riskLevel, riskLevel === "flag" ? ["flag"] : ["watch", "flag"]),
          projectIds.length > 0 ? inArray(saleAuditEventsTable.projectId as any, projectIds) : undefined,
          from ? (db.$count as any) : undefined,
        ),
      )
      .orderBy(desc(saleAuditEventsTable.createdAt))
      .limit(200);

    // Simple date filters without drizzle-orm gte/lte for brevity
    const filtered = rows.filter((r) => {
      const t = r.createdAt.toISOString();
      if (from && t < from) return false;
      if (to && t > to + "T23:59:59Z") return false;
      return true;
    });

    const flagCount = filtered.filter((r) => r.riskLevel === "flag").length;
    const watchCount = filtered.filter((r) => r.riskLevel === "watch").length;

    return res.json({
      flagCount,
      watchCount,
      totalCount: filtered.length,
      events: filtered.map(formatAuditEvent),
    });
  },
);

// ── GET /sales/:id/audit-log ───────────────────────────────────────────────────
// Returns full audit timeline for a sale (any authenticated user with project access).

router.get("/:id/audit-log", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const txId = req.params.id as string;
  const [tx] = await db
    .select()
    .from(salesTransactionsTable)
    .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
    .limit(1);

  if (!tx) return res.status(404).json({ error: "Sale not found" });
  if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });

  const events = await db
    .select()
    .from(saleAuditEventsTable)
    .where(eq(saleAuditEventsTable.transactionId, txId))
    .orderBy(desc(saleAuditEventsTable.createdAt));

  return res.json({
    transactionId: txId,
    saleNumber: tx.saleNumber,
    totalEvents: events.length,
    flagCount: events.filter((e) => e.riskLevel === "flag").length,
    watchCount: events.filter((e) => e.riskLevel === "watch").length,
    events: events.map(formatAuditEvent),
  });
});

// ── GET /sales/:id/documents ───────────────────────────────────────────────────

router.get("/:id/documents", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const txId = req.params.id as string;
  const [tx] = await db
    .select()
    .from(salesTransactionsTable)
    .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
    .limit(1);

  if (!tx) return res.status(404).json({ error: "Sale not found" });
  if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });

  const { status } = req.query as Record<string, string>;
  const docs = await db
    .select()
    .from(saleDocumentsTable)
    .where(
      and(
        eq(saleDocumentsTable.transactionId, txId),
        status ? eq(saleDocumentsTable.status, status) : undefined,
      ),
    )
    .orderBy(desc(saleDocumentsTable.createdAt));

  return res.json(docs.map(formatDocument));
});

// ── POST /sales/:id/documents ──────────────────────────────────────────────────
// Register a document after client has uploaded via presigned URL.

router.post(
  "/:id/documents",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const txId = req.params.id as string;
    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);

    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });

    type Body = {
      documentType?: string;
      title: string;
      description?: string;
      fileObjectPath: string;
      mimeType: string;
      fileSizeBytes?: number;
      originalFileName: string;
      notes?: string;
    };
    const { documentType, title, description, fileObjectPath, mimeType, fileSizeBytes, originalFileName, notes } =
      req.body as Body;

    if (!title?.trim() || !fileObjectPath || !mimeType || !originalFileName) {
      return res.status(400).json({ error: "title, fileObjectPath, mimeType, originalFileName are required" });
    }

    const actorName = actor.displayName ?? actor.email ?? "Unknown";

    const [doc] = await db
      .insert(saleDocumentsTable)
      .values({
        transactionId: txId,
        saleNumber: tx.saleNumber,
        projectId: tx.projectId,
        documentType: documentType ?? "other",
        title: title.trim(),
        description: description ?? null,
        fileObjectPath,
        mimeType,
        fileSizeBytes: fileSizeBytes ?? null,
        originalFileName,
        status: "active",
        isActive: true,
        uploadedById: actor.id,
        uploadedByName: actorName,
        notes: notes ?? null,
      })
      .returning();

    writeSaleAudit({
      transactionId: txId,
      saleNumber: tx.saleNumber,
      projectId: tx.projectId,
      eventType: "document_uploaded",
      entityType: "document",
      entityId: doc.id,
      description: `Document uploaded: "${doc.title}" (${doc.documentType}, ${doc.originalFileName})`,
      actorId: actor.id,
      actorName,
      actorRole: actor.role,
    });

    return res.status(201).json(formatDocument(doc));
  },
);

// ── GET /sales/:id/documents/:docId ───────────────────────────────────────────

router.get("/:id/documents/:docId", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const txId = req.params.id as string;
  const docId = req.params.docId as string;

  const [tx] = await db
    .select()
    .from(salesTransactionsTable)
    .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
    .limit(1);

  if (!tx) return res.status(404).json({ error: "Sale not found" });
  if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });

  const [doc] = await db
    .select()
    .from(saleDocumentsTable)
    .where(and(eq(saleDocumentsTable.id, docId), eq(saleDocumentsTable.transactionId, txId)))
    .limit(1);

  if (!doc) return res.status(404).json({ error: "Document not found" });

  return res.json(formatDocument(doc));
});

// ── GET /sales/:id/documents/:docId/download ───────────────────────────────────
// Streams the file from object storage.

router.get("/:id/documents/:docId/download", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const txId = req.params.id as string;
  const docId = req.params.docId as string;

  const [tx] = await db
    .select()
    .from(salesTransactionsTable)
    .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
    .limit(1);

  if (!tx) return res.status(404).json({ error: "Sale not found" });
  if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });

  const [doc] = await db
    .select()
    .from(saleDocumentsTable)
    .where(and(eq(saleDocumentsTable.id, docId), eq(saleDocumentsTable.transactionId, txId)))
    .limit(1);

  if (!doc) return res.status(404).json({ error: "Document not found" });

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(doc.fileObjectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.originalFileName)}"`);
    res.setHeader("Content-Type", doc.mimeType);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
      return;
    } else {
      res.end();
      return;
    }
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to download sale document");
    res.status(500).json({ error: "Failed to retrieve file" });
    return;
  }
});

// ── PATCH /sales/:id/documents/:docId ─────────────────────────────────────────

router.patch(
  "/:id/documents/:docId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const txId = req.params.id as string;
    const docId = req.params.docId as string;

    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);

    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });

    const [doc] = await db
      .select()
      .from(saleDocumentsTable)
      .where(and(eq(saleDocumentsTable.id, docId), eq(saleDocumentsTable.transactionId, txId)))
      .limit(1);

    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (doc.status === "archived") return res.status(400).json({ error: "Cannot edit an archived document" });

    type Body = { title?: string; description?: string; documentType?: string; notes?: string };
    const { title, description, documentType, notes } = req.body as Body;

    const [updated] = await db
      .update(saleDocumentsTable)
      .set({
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description || null }),
        ...(documentType !== undefined && { documentType }),
        ...(notes !== undefined && { notes: notes || null }),
        updatedAt: new Date(),
      })
      .where(eq(saleDocumentsTable.id, docId))
      .returning();

    return res.json(formatDocument(updated));
  },
);

// ── DELETE /sales/:id/documents/:docId ────────────────────────────────────────
// Soft-archive; admin only.

router.delete(
  "/:id/documents/:docId",
  requireRole("admin"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const txId = req.params.id as string;
    const docId = req.params.docId as string;

    const [tx] = await db
      .select()
      .from(salesTransactionsTable)
      .where(and(eq(salesTransactionsTable.id, txId), eq(salesTransactionsTable.isActive, true)))
      .limit(1);

    if (!tx) return res.status(404).json({ error: "Sale not found" });
    if (!canAccessProject(req, tx.projectId)) return res.status(403).json({ error: "Forbidden" });

    const [doc] = await db
      .select()
      .from(saleDocumentsTable)
      .where(and(eq(saleDocumentsTable.id, docId), eq(saleDocumentsTable.transactionId, txId)))
      .limit(1);

    if (!doc) return res.status(404).json({ error: "Document not found" });

    const actorName = actor.displayName ?? actor.email ?? "Unknown";

    const [archived] = await db
      .update(saleDocumentsTable)
      .set({
        status: "archived",
        isActive: false,
        archivedAt: new Date(),
        archivedById: actor.id,
        archivedByName: actorName,
        updatedAt: new Date(),
      })
      .where(eq(saleDocumentsTable.id, docId))
      .returning();

    writeSaleAudit({
      transactionId: txId,
      saleNumber: tx.saleNumber,
      projectId: tx.projectId,
      eventType: "document_archived",
      entityType: "document",
      entityId: docId,
      description: `Document archived: "${doc.title}" (${doc.originalFileName})`,
      actorId: actor.id,
      actorName,
      actorRole: actor.role,
    });

    return res.json(formatDocument(archived));
  },
);

export default router;

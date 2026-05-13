import { Router } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import { eq, and, isNull, inArray, desc, asc, or } from "drizzle-orm";
import {
  db,
  documentsTable,
  documentAccessLogsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
const router = Router();
const objectStorageService = new ObjectStorageService();

// ── Helpers ───────────────────────────────────────────────────────────────────

type DocCategoryType = "agreement" | "template" | "supporting" | "governance" | "operational";
const VALID_CATEGORIES: DocCategoryType[] = ["agreement", "template", "supporting", "governance", "operational"];

interface CreateDocumentInput {
  title: string;
  description?: string;
  category: DocCategoryType;
  projectId?: string;
  agreementId?: string;
  fileObjectPath: string;
  mimeType: string;
  fileSizeBytes?: number;
  originalFileName: string;
  notes?: string;
}

interface UpdateDocumentInput {
  title?: string;
  description?: string;
  category?: DocCategoryType;
  projectId?: string | null;
  agreementId?: string | null;
  notes?: string;
}

function parseCreateBody(body: unknown): { data: CreateDocumentInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  if (!b.title || typeof b.title !== "string") return { error: "title is required" };
  if (!b.category || !VALID_CATEGORIES.includes(b.category as DocCategoryType))
    return { error: "category must be one of: " + VALID_CATEGORIES.join(", ") };
  if (!b.fileObjectPath || typeof b.fileObjectPath !== "string") return { error: "fileObjectPath is required" };
  if (!b.mimeType || typeof b.mimeType !== "string") return { error: "mimeType is required" };
  if (!b.originalFileName || typeof b.originalFileName !== "string") return { error: "originalFileName is required" };
  return {
    data: {
      title: b.title,
      description: typeof b.description === "string" ? b.description : undefined,
      category: b.category as DocCategoryType,
      projectId: typeof b.projectId === "string" ? b.projectId : undefined,
      agreementId: typeof b.agreementId === "string" ? b.agreementId : undefined,
      fileObjectPath: b.fileObjectPath,
      mimeType: b.mimeType,
      fileSizeBytes: typeof b.fileSizeBytes === "number" ? b.fileSizeBytes : undefined,
      originalFileName: b.originalFileName,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    },
  };
}

function parseUpdateBody(body: unknown): { data: UpdateDocumentInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const data: UpdateDocumentInput = {};
  if ("title" in b) {
    if (typeof b.title !== "string" || !b.title) return { error: "title must be a non-empty string" };
    data.title = b.title;
  }
  if ("description" in b && typeof b.description === "string") data.description = b.description;
  if ("category" in b) {
    if (!VALID_CATEGORIES.includes(b.category as DocCategoryType)) return { error: "Invalid category" };
    data.category = b.category as DocCategoryType;
  }
  if ("projectId" in b) data.projectId = b.projectId === null ? null : (typeof b.projectId === "string" ? b.projectId : undefined);
  if ("agreementId" in b) data.agreementId = b.agreementId === null ? null : (typeof b.agreementId === "string" ? b.agreementId : undefined);
  if ("notes" in b && typeof b.notes === "string") data.notes = b.notes;
  return { data };
}

type DocumentCategory = "agreement" | "template" | "supporting" | "governance" | "operational";

/** Categories accessible by employees/operational_staff (project-scoped) */
const EMPLOYEE_CATEGORIES: DocumentCategory[] = ["operational", "supporting"];

/**
 * Resolve the acting user's DB UUID + display name from their Clerk userId.
 */
async function resolveActingUser(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return { id: undefined, name: undefined, role: undefined };
  const [row] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return { id: row?.id, name: row?.displayName ?? undefined, role: row?.role ?? undefined };
}

/**
 * Check whether the requesting user can access a given document.
 * Returns true if access is permitted.
 */
function canAccessDocument(
  doc: typeof documentsTable.$inferSelect,
  role: string | undefined,
  userProjectIds: string[] | undefined,
): boolean {
  // Admin and developer see everything
  if (role === "admin" || role === "developer") return true;

  // Null projectId = global/system document — restricted to admin/developer
  if (!doc.projectId) return false;

  const projectIds = userProjectIds ?? [];

  if (role === "landowner" || role === "investor") {
    return projectIds.includes(doc.projectId);
  }

  if (role === "employee" || role === "operational_staff") {
    return (
      projectIds.includes(doc.projectId) &&
      (EMPLOYEE_CATEGORIES as string[]).includes(doc.category)
    );
  }

  return false;
}

/**
 * Enrich a document row with projectName (via join).
 */
async function enrichDocument(doc: typeof documentsTable.$inferSelect) {
  let projectName: string | null = null;
  if (doc.projectId) {
    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, doc.projectId))
      .limit(1);
    projectName = proj?.name ?? null;
  }
  return {
    ...doc,
    projectName,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt?.toISOString() ?? null,
    archivedAt: doc.archivedAt?.toISOString() ?? null,
  };
}

/**
 * Write an access log entry — fire-and-forget (non-blocking).
 */
function writeAccessLog(opts: {
  documentId: string | null;
  documentTitle: string;
  documentCategory: string;
  userId: string | undefined;
  userDisplayName: string | undefined;
  userRole: string | undefined;
  action: "upload" | "view" | "download" | "archive" | "restore" | "delete" | "metadata_update";
  projectId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}) {
  db.insert(documentAccessLogsTable)
    .values({
      documentId: opts.documentId ?? null,
      documentTitle: opts.documentTitle,
      documentCategory: opts.documentCategory,
      userId: opts.userId ?? null,
      userDisplayName: opts.userDisplayName ?? null,
      userRole: opts.userRole ?? null,
      action: opts.action,
      projectId: opts.projectId ?? null,
      metadata: opts.metadata ?? null,
      ipAddress: opts.ipAddress ?? null,
    })
    .catch(() => { /* fire-and-forget */ });
}

// ── GET /documents ────────────────────────────────────────────────────────────
// Lists documents the requesting user is allowed to see.

router.get("/", async (req, res) => {
  const { category, projectId, status, agreementId } = req.query as Record<string, string | undefined>;
  const role = req.userRole;
  const userProjectIds = req.userProjectIds ?? [];
  const canAll = req.canAccessAllProjects;

  let rows = await db
    .select()
    .from(documentsTable)
    .where(isNull(documentsTable.deletedAt))
    .orderBy(desc(documentsTable.createdAt));

  // Apply role-based filter
  rows = rows.filter((doc) => canAccessDocument(doc, role, userProjectIds));

  // Optional query filters
  if (category) {
    rows = rows.filter((d) => d.category === category);
  }
  if (projectId) {
    rows = rows.filter((d) => d.projectId === projectId);
  }
  if (status) {
    rows = rows.filter((d) => d.status === status);
  } else {
    // Default: only active
    rows = rows.filter((d) => d.status === "active");
  }
  if (agreementId) {
    rows = rows.filter((d) => d.agreementId === agreementId);
  }

  const enriched = await Promise.all(rows.map(enrichDocument));
  res.json(enriched);
});

// ── GET /documents/access-log ─────────────────────────────────────────────────
// Audit log of all document access events. Admin/developer only.
// Must be registered BEFORE /:id to avoid path conflict.

router.get(
  "/access-log",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { documentId, projectId, limit } = req.query as Record<string, string | undefined>;
    const limitN = Math.min(parseInt(limit ?? "100", 10) || 100, 500);

    let query = db
      .select()
      .from(documentAccessLogsTable)
      .orderBy(desc(documentAccessLogsTable.createdAt))
      .limit(limitN);

    const logs = await query;
    const filtered = logs.filter((l) => {
      if (documentId && l.documentId !== documentId) return false;
      if (projectId && l.projectId !== projectId) return false;
      return true;
    });

    res.json(
      filtered.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        metadata: l.metadata ?? null,
      })),
    );
  },
);

// ── POST /documents ───────────────────────────────────────────────────────────
// Create a document record after the file has been uploaded to GCS.

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = parseCreateBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActingUser(clerkUserId);

  const [doc] = await db
    .insert(documentsTable)
    .values({
      ...parsed.data,
      projectId: parsed.data.projectId ?? null,
      agreementId: parsed.data.agreementId ?? null,
      description: parsed.data.description ?? null,
      notes: parsed.data.notes ?? null,
      fileSizeBytes: parsed.data.fileSizeBytes ?? null,
      uploadedBy: actor.id ?? null,
      uploadedByName: actor.name ?? null,
    })
    .returning();

  writeAccessLog({
    documentId: doc.id,
    documentTitle: doc.title,
    documentCategory: doc.category,
    userId: actor.id,
    userDisplayName: actor.name,
    userRole: actor.role ?? req.userRole,
    action: "upload",
    projectId: doc.projectId,
    metadata: { mimeType: doc.mimeType, fileSizeBytes: doc.fileSizeBytes },
    ipAddress: req.ip,
  });

  res.status(201).json(await enrichDocument(doc));
});

// ── GET /documents/:id ────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const id = String(req.params.id);

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)))
    .limit(1);

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!canAccessDocument(doc, req.userRole, req.userProjectIds)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActingUser(clerkUserId);

  writeAccessLog({
    documentId: doc.id,
    documentTitle: doc.title,
    documentCategory: doc.category,
    userId: actor.id,
    userDisplayName: actor.name,
    userRole: actor.role ?? req.userRole,
    action: "view",
    projectId: doc.projectId,
    ipAddress: req.ip,
  });

  res.json(await enrichDocument(doc));
});

// ── PATCH /documents/:id ──────────────────────────────────────────────────────

router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  const parsed = parseUpdateBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActingUser(clerkUserId);

  const [existing] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const [updated] = await db
    .update(documentsTable)
    .set({
      ...parsed.data,
      projectId: parsed.data.projectId === null ? null : (parsed.data.projectId ?? existing.projectId),
      agreementId: parsed.data.agreementId === null ? null : (parsed.data.agreementId ?? existing.agreementId),
    })
    .where(eq(documentsTable.id, id))
    .returning();

  writeAccessLog({
    documentId: id,
    documentTitle: updated.title,
    documentCategory: updated.category,
    userId: actor.id,
    userDisplayName: actor.name,
    userRole: actor.role ?? req.userRole,
    action: "metadata_update",
    projectId: updated.projectId,
    metadata: parsed.data as Record<string, unknown>,
    ipAddress: req.ip,
  });

  res.json(await enrichDocument(updated));
});

// ── POST /documents/:id/archive ───────────────────────────────────────────────

router.post("/:id/archive", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActingUser(clerkUserId);

  const [existing] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (existing.status === "archived") {
    res.status(409).json({ error: "Document is already archived" });
    return;
  }

  const [updated] = await db
    .update(documentsTable)
    .set({ status: "archived", isActive: false, archivedAt: new Date(), archivedBy: actor.id ?? null })
    .where(eq(documentsTable.id, id))
    .returning();

  writeAccessLog({
    documentId: id,
    documentTitle: updated.title,
    documentCategory: updated.category,
    userId: actor.id,
    userDisplayName: actor.name,
    userRole: actor.role ?? req.userRole,
    action: "archive",
    projectId: updated.projectId,
    ipAddress: req.ip,
  });

  res.json(await enrichDocument(updated));
});

// ── POST /documents/:id/restore ───────────────────────────────────────────────

router.post("/:id/restore", requireRole("admin"), async (req, res) => {
  const id = String(req.params.id);
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActingUser(clerkUserId);

  const [existing] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (existing.status === "active") {
    res.status(409).json({ error: "Document is already active" });
    return;
  }

  const [updated] = await db
    .update(documentsTable)
    .set({ status: "active", isActive: true, archivedAt: null, archivedBy: null })
    .where(eq(documentsTable.id, id))
    .returning();

  writeAccessLog({
    documentId: id,
    documentTitle: updated.title,
    documentCategory: updated.category,
    userId: actor.id,
    userDisplayName: actor.name,
    userRole: actor.role ?? req.userRole,
    action: "restore",
    projectId: updated.projectId,
    ipAddress: req.ip,
  });

  res.json(await enrichDocument(updated));
});

// ── GET /documents/:id/download ───────────────────────────────────────────────
// Secure download: checks access, logs, streams file from GCS.

router.get("/:id/download", async (req, res) => {
  const id = String(req.params.id);

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)))
    .limit(1);

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!canAccessDocument(doc, req.userRole, req.userProjectIds)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActingUser(clerkUserId);

  // Log the download before streaming
  writeAccessLog({
    documentId: doc.id,
    documentTitle: doc.title,
    documentCategory: doc.category,
    userId: actor.id,
    userDisplayName: actor.name,
    userRole: actor.role ?? req.userRole,
    action: "download",
    projectId: doc.projectId,
    metadata: { originalFileName: doc.originalFileName },
    ipAddress: req.ip,
  });

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(doc.fileObjectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    // Set download headers
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.originalFileName)}"`);
    res.setHeader("Content-Type", doc.mimeType);
    if (doc.fileSizeBytes) {
      res.setHeader("Content-Length", doc.fileSizeBytes);
    }

    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "content-disposition" && key.toLowerCase() !== "content-type") {
        res.setHeader(key, value);
      }
    });

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found in storage" });
      return;
    }
    req.log.error({ err }, "Document download failed");
    res.status(500).json({ error: "Failed to download document" });
  }
});

export default router;

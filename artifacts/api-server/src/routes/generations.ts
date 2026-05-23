/**
 * Agreement Generation History Routes
 *
 * POST /agreements/:id/generations          — generate DOCX, save snapshot + audit log
 * GET  /agreements/:id/generations          — list all snapshots (newest first)
 * GET  /agreements/:id/generations/:genId   — single snapshot for the viewer page
 * GET  /agreements/:id/generations/:genId/download  — re-stream stored DOCX
 * GET  /agreements/:id/audit-log            — immutable audit trail for this agreement
 */

import { Router } from "express";
import {
  db,
  agreementsTable,
  agreementGenerationsTable,
  agreementVariableValuesTable,
  agreementTemplatesTable,
  auditLogsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import { generateDocument, DocumentGenerationError } from "../lib/documentGenerator";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildSnapshot(agreementId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(agreementVariableValuesTable)
    .where(eq(agreementVariableValuesTable.agreementId, agreementId));
  const snapshot: Record<string, string> = {};
  for (const row of rows) {
    const effective = row.overrideValue ?? row.resolvedValue;
    if (effective != null) snapshot[row.variableName] = effective;
  }
  return snapshot;
}

async function resolveCurrentUser(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return null;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId));
  return user ?? null;
}

function buildAuditSummary(operation: string, tableName: string, newData: unknown): string {
  const d = newData as Record<string, unknown> | null;
  if (tableName === "agreement_generations") {
    if (operation === "INSERT") return `Document generated using "${d?.templateName ?? "unknown template"}"`;
  }
  if (tableName === "agreement_variable_values") {
    if (operation === "INSERT") return `Variable "${d?.variableName ?? "unknown"}" auto-resolved`;
    if (operation === "UPDATE") return `Variable "${d?.variableName ?? "unknown"}" override updated`;
  }
  return `${operation} on ${tableName}`;
}

// ─── POST /agreements/:id/generations ────────────────────────────────────────

router.post("/:id/generations", requireRole("admin", "developer"), async (req, res) => {
  const agreementId = String(req.params.id);
  const { templateId, notes } = req.body as { templateId?: string; notes?: string };

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(eq(agreementsTable.id, agreementId));
  if (!agreement) { res.status(404).json({ error: "Agreement not found" }); return; }

  const [template] = await db
    .select()
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.id, templateId));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!template.isActive) {
    res.status(422).json({ error: "Template is archived — restore it before generating." });
    return;
  }
  if (template.fileFormat !== "docx") {
    res.status(422).json({ error: "Only DOCX templates support variable substitution." });
    return;
  }
  if (template.category !== "agreement") {
    res.status(422).json({
      error:
        "Only templates in the 'agreement' category can be used to generate agreements.",
    });
    return;
  }

  // Capture point-in-time project lifecycle status
  const [project] = await db
    .select({ lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, agreement.projectId));

  const variableSnapshot = await buildSnapshot(agreementId);

  let docxBuffer: Buffer;
  let filename: string;
  try {
    const result = await generateDocument({ agreementId, templateId });
    docxBuffer = result.buffer;
    filename = result.filename;
  } catch (err) {
    if (err instanceof DocumentGenerationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "DOCX generation failed");
    res.status(500).json({ error: "Document generation failed" });
    return;
  }

  let fileObjectPath: string | null = null;
  try {
    fileObjectPath = await objectStorageService.saveBuffer(
      docxBuffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename,
    );
  } catch (err) {
    req.log.error({ err }, "Failed to save generation file to object storage");
  }

  const { userId: clerkUserId } = getAuth(req);
  const user = await resolveCurrentUser(clerkUserId);
  const generatedBy = user?.id ?? null;
  const generatedByName = user?.displayName ?? user?.email ?? null;

  const [generation] = await db
    .insert(agreementGenerationsTable)
    .values({
      agreementId,
      projectId: agreement.projectId,
      templateId,
      templateName: template.name,
      templateVersion: template.version ?? null,
      variableSnapshot,
      fileObjectPath,
      lifecycleStatusSnapshot: project?.lifecycleStatus ?? null,
      agreementStatusSnapshot: agreement.status,
      generatedBy,
      generatedByName,
      notes: notes ?? null,
    })
    .returning();

  // Write immutable audit log entry (non-fatal if it fails)
  db.insert(auditLogsTable)
    .values({
      userId: generatedBy ?? undefined,
      tableName: "agreement_generations",
      recordId: generation.id,
      operation: "INSERT",
      newData: generation as unknown as Record<string, unknown>,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    .catch((err: unknown) => req.log.error({ err }, "Failed to write audit log for generation"));

  res.status(201).json(generation);
});

// ─── GET /agreements/:id/generations ─────────────────────────────────────────

router.get("/:id/generations", async (req, res) => {
  const agreementId = String(req.params.id);
  const [agreement] = await db
    .select({ id: agreementsTable.id })
    .from(agreementsTable)
    .where(eq(agreementsTable.id, agreementId));
  if (!agreement) { res.status(404).json({ error: "Agreement not found" }); return; }

  const generations = await db
    .select()
    .from(agreementGenerationsTable)
    .where(eq(agreementGenerationsTable.agreementId, agreementId))
    .orderBy(desc(agreementGenerationsTable.generatedAt));

  res.json(generations);
});

// ─── GET /agreements/:id/generations/:genId — single snapshot viewer ──────────

router.get("/:id/generations/:genId", async (req, res) => {
  const agreementId = String(req.params.id);
  const genId = String(req.params.genId);

  const [generation] = await db
    .select()
    .from(agreementGenerationsTable)
    .where(eq(agreementGenerationsTable.id, genId));

  if (!generation || generation.agreementId !== agreementId) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  res.json(generation);
});

// ─── GET /agreements/:id/audit-log ───────────────────────────────────────────

router.get("/:id/audit-log", async (req, res) => {
  const agreementId = String(req.params.id);

  const [agreement] = await db
    .select({ id: agreementsTable.id })
    .from(agreementsTable)
    .where(eq(agreementsTable.id, agreementId));
  if (!agreement) { res.status(404).json({ error: "Agreement not found" }); return; }

  // Find all generation IDs for this agreement
  const generations = await db
    .select({
      id: agreementGenerationsTable.id,
      generatedByName: agreementGenerationsTable.generatedByName,
    })
    .from(agreementGenerationsTable)
    .where(eq(agreementGenerationsTable.agreementId, agreementId));

  const genIds = generations.map((g) => g.id);

  // Fetch all audit_logs whose recordId is one of the generation IDs
  const logs = genIds.length > 0
    ? await db
        .select()
        .from(auditLogsTable)
        .where(inArray(auditLogsTable.recordId, genIds))
        .orderBy(desc(auditLogsTable.createdAt))
    : [];

  const enriched = logs.map((log) => {
    const gen = generations.find((g) => g.id === log.recordId);
    return {
      id: log.id,
      operation: log.operation,
      tableName: log.tableName,
      recordId: log.recordId,
      performedByName: gen?.generatedByName ?? null,
      summary: buildAuditSummary(log.operation, log.tableName, log.newData),
      oldData: log.oldData as Record<string, unknown> | null,
      newData: log.newData as Record<string, unknown> | null,
      createdAt: log.createdAt,
    };
  });

  res.json(enriched);
});

// ─── GET /agreements/:id/generations/:genId/download ─────────────────────────

router.get("/:id/generations/:genId/download", async (req, res) => {
  const agreementId = String(req.params.id);
  const genId = String(req.params.genId);

  const [generation] = await db
    .select()
    .from(agreementGenerationsTable)
    .where(eq(agreementGenerationsTable.id, genId));

  if (!generation || generation.agreementId !== agreementId) {
    res.status(404).json({ error: "Generation not found" });
    return;
  }
  if (!generation.fileObjectPath) {
    res.status(404).json({ error: "File not stored for this generation" });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(
      generation.fileObjectPath,
    );
    const response = await objectStorageService.downloadObject(objectFile, 0);
    const safeFilename = `agreement_${agreementId.slice(0, 8)}_${generation.generatedAt
      .toISOString()
      .slice(0, 10)}.docx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    const reader = response.body?.getReader();
    if (!reader) { res.status(500).end(); return; }
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
      await pump();
    };
    await pump();
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Stored file not found" });
      return;
    }
    req.log.error({ err }, "Failed to stream generation file");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

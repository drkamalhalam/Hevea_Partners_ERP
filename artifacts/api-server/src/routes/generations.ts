/**
 * Agreement Generation History Routes
 *
 * POST /agreements/:id/generations
 *   - Generates a filled DOCX from the selected template
 *   - Stores the DOCX permanently in object storage
 *   - Saves an immutable snapshot of all variable effective-values to the DB
 *   - Returns the new AgreementGeneration record
 *
 * GET /agreements/:id/generations
 *   - Lists all generation records for an agreement, newest first
 *
 * GET /agreements/:id/generations/:genId/download
 *   - Streams the permanently stored DOCX for a historical generation
 */

import { Router } from "express";
import { db, agreementsTable, agreementGenerationsTable, agreementVariableValuesTable, agreementTemplatesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import { generateDocument, DocumentGenerationError } from "../lib/documentGenerator";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Build effectiveValue snapshot from stored variable rows. */
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

// ─── POST /agreements/:id/generations ────────────────────────────────────────

router.post("/:id/generations", requireRole("admin", "developer"), async (req, res) => {
  const agreementId = String(req.params.id);
  const { templateId, notes } = req.body as { templateId?: string; notes?: string };

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  // 1. Verify agreement exists.
  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(eq(agreementsTable.id, agreementId));
  if (!agreement) { res.status(404).json({ error: "Agreement not found" }); return; }

  // 2. Load template.
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

  // 3. Build variable snapshot (current effective values).
  const variableSnapshot = await buildSnapshot(agreementId);

  // 4. Generate DOCX.
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

  // 5. Persist DOCX to object storage.
  let fileObjectPath: string | null = null;
  try {
    fileObjectPath = await objectStorageService.saveBuffer(
      docxBuffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename,
    );
  } catch (err) {
    // Non-fatal: snapshot still saves even if GCS upload fails.
    req.log.error({ err }, "Failed to save generation file to object storage");
  }

  // 6. Identify the generating user.
  const { userId: clerkUserId } = getAuth(req);
  let generatedBy: string | null = null;
  let generatedByName: string | null = null;
  if (clerkUserId) {
    const { usersTable } = await import("@workspace/db");
    const { eq: eqAlias } = await import("drizzle-orm");
    const [user] = await db.select().from(usersTable).where(eqAlias(usersTable.clerkUserId, clerkUserId));
    if (user) {
      generatedBy = user.id;
      generatedByName = user.displayName ?? user.email ?? null;
    }
  }

  // 7. Insert immutable generation record.
  const [generation] = await db
    .insert(agreementGenerationsTable)
    .values({
      agreementId,
      templateId,
      templateName: template.name,
      templateVersion: template.version ?? null,
      variableSnapshot,
      fileObjectPath,
      generatedBy,
      generatedByName,
      notes: notes ?? null,
    })
    .returning();

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
    const safeFilename = `agreement_${agreementId.slice(0, 8)}_${generation.generatedAt.toISOString().slice(0, 10)}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
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

import { Router, type Request, type Response } from "express";
import {
  db,
  usersTable,
  agreementTemplatesTable,
  documentVariableRegistryTable,
  documentTemplateVariablesTable,
  documentTemplateAuditTable,
} from "@workspace/db";
import { eq, desc, and, ne } from "drizzle-orm";
import PizZip from "pizzip";
import {
  CreateTemplateBody,
  UpdateTemplateBody,
  ActivateTemplateBody,
  SupersedeTemplateBody,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { parsePlaceholders, flattenDocxXml } from "../lib/placeholderParser";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ── helpers ──────────────────────────────────────────────────────────────

async function resolveUser(clerkUserId: string) {
  const [u] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return u ?? null;
}

async function recordAudit(args: {
  templateId: string;
  eventType:
    | "uploaded"
    | "parsed"
    | "mapping_updated"
    | "metadata_updated"
    | "activated"
    | "superseded"
    | "archived"
    | "restored"
    | "downloaded"
    | "generated";
  performedById: string | null;
  performedByName: string | null;
  reason?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  await db.insert(documentTemplateAuditTable).values({
    templateId: args.templateId,
    eventType: args.eventType,
    performedById: args.performedById,
    performedByName: args.performedByName,
    reason: args.reason ?? null,
    payload: args.payload ?? null,
  });
}

async function fetchDocxText(fileObjectPath: string): Promise<string> {
  const file = await objectStorageService.getObjectEntityFile(fileObjectPath);
  const stream = file.createReadStream();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const buf = Buffer.concat(chunks);
  const zip = new PizZip(buf);
  // Concatenate all word XML parts where placeholders can live.
  const parts = [
    "word/document.xml",
    "word/header1.xml",
    "word/header2.xml",
    "word/header3.xml",
    "word/footer1.xml",
    "word/footer2.xml",
    "word/footer3.xml",
  ];
  let combined = "";
  for (const p of parts) {
    const f = zip.file(p);
    if (f) combined += f.asText() + "\n";
  }
  // Flatten XML so placeholders split across Word's <w:t> runs are recombined.
  return flattenDocxXml(combined);
}

function redactNotesForRole<T extends { notes?: string | null }>(
  rows: T[],
  canSeeNotes: boolean,
): T[] {
  if (canSeeNotes) return rows;
  return rows.map((r) => ({ ...r, notes: null }));
}

interface MappingSummary {
  total: number;
  mapped: number;
  missing: number;
  invalid: number;
  unused: number;
  canActivate: boolean;
  blockers: string[];
}

async function buildMappingResponse(templateId: string) {
  const rows = await db
    .select()
    .from(documentTemplateVariablesTable)
    .where(eq(documentTemplateVariablesTable.templateId, templateId));

  const registry = await db
    .select()
    .from(documentVariableRegistryTable);
  const byKey = new Map(registry.map((r) => [r.variableKey, r]));

  const items = rows.map((r) => ({
    ...r,
    registryEntry: byKey.get(r.variableKey) ?? null,
  }));

  const summary: MappingSummary = {
    total: items.length,
    mapped: items.filter((i) => i.status === "mapped").length,
    missing: items.filter((i) => i.status === "missing").length,
    invalid: items.filter((i) => i.status === "invalid").length,
    unused: items.filter((i) => i.status === "unused").length,
    canActivate: false,
    blockers: [],
  };

  if (summary.unused > 0)
    summary.blockers.push(
      `${summary.unused} placeholder(s) are not registered in the Variable Registry`,
    );
  if (summary.invalid > 0)
    summary.blockers.push(`${summary.invalid} placeholder(s) are invalid`);
  if (summary.missing > 0)
    summary.blockers.push(
      `${summary.missing} required variable(s) are missing from the template`,
    );
  summary.canActivate = summary.blockers.length === 0 && summary.total > 0;

  return { templateId, items, summary };
}

async function parseTemplateInternal(templateId: string, fileObjectPath: string) {
  const text = await fetchDocxText(fileObjectPath);
  const { all, unknown } = parsePlaceholders(text);

  const registry = await db
    .select()
    .from(documentVariableRegistryTable)
    .where(eq(documentVariableRegistryTable.isActive, true));
  const registryByKey = new Map(registry.map((r) => [r.variableKey, r]));
  const detectedSet = new Set(all);
  const unknownSet = new Set(unknown);

  // Compute missing: registry entries that are required but absent in the doc.
  const missing = registry
    .filter((r) => r.isRequired && !detectedSet.has(r.variableKey))
    .map((r) => r.variableKey);

  // Replace existing rows for this template.
  await db
    .delete(documentTemplateVariablesTable)
    .where(eq(documentTemplateVariablesTable.templateId, templateId));

  const values: Array<{
    templateId: string;
    variableKey: string;
    status: "mapped" | "missing" | "invalid" | "unused";
  }> = [];

  for (const key of all) {
    values.push({
      templateId,
      variableKey: key,
      status: registryByKey.has(key) ? "mapped" : "unused",
    });
  }
  for (const key of missing) {
    values.push({ templateId, variableKey: key, status: "missing" });
  }

  if (values.length > 0) {
    await db.insert(documentTemplateVariablesTable).values(values);
  }

  return {
    detected: all.length,
    unknown: unknownSet.size,
    missing: missing.length,
  };
}

// ── routes ───────────────────────────────────────────────────────────────

// GET /templates — list (filtered by category / status)
router.get("/", async (req: Request, res: Response) => {
  const { status, category } = req.query;
  const conds = [];
  if (
    status === "draft" ||
    status === "active" ||
    status === "superseded" ||
    status === "archived"
  ) {
    conds.push(eq(agreementTemplatesTable.status, status));
  }
  if (typeof category === "string" && category.length > 0) {
    conds.push(
      eq(
        agreementTemplatesTable.category,
        category as typeof agreementTemplatesTable.$inferSelect.category,
      ),
    );
  }
  const rows = await db
    .select()
    .from(agreementTemplatesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(agreementTemplatesTable.createdAt));
  const canSeeNotes = req.userRole === "admin" || req.userRole === "developer";
  res.json(redactNotesForRole(rows, canSeeNotes));
});

// GET /templates/:id
router.get("/:id", async (req: Request, res: Response) => {
  const [row] = await db
    .select()
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.id, String(req.params.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  const canSeeNotes = req.userRole === "admin" || req.userRole === "developer";
  res.json(redactNotesForRole([row], canSeeNotes)[0]);
});

// POST /templates
router.post(
  "/",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = CreateTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const {
      name,
      description,
      documentDescription,
      notes,
      version,
      category,
      fileObjectPath,
      fileFormat,
      mimeType,
      fileSizeBytes,
    } = parsed.data;

    const user = await resolveUser(req.userId!);
    const [newTemplate] = await db
      .insert(agreementTemplatesTable)
      .values({
        name,
        description,
        documentDescription,
        notes,
        version: version ?? "1.0",
        category: category ?? "agreement",
        fileObjectPath,
        fileFormat,
        mimeType,
        fileSizeBytes,
        // New uploads enter as DRAFT. Existing agreement flow continues to
        // work because old rows are already 'active' from prior state.
        status: "draft",
        isActive: false,
        uploadedBy: user?.id ?? null,
        uploadedByName: user?.displayName ?? null,
      })
      .returning();

    await recordAudit({
      templateId: newTemplate.id,
      eventType: "uploaded",
      performedById: user?.id ?? null,
      performedByName: user?.displayName ?? null,
      payload: { category: newTemplate.category, fileFormat: newTemplate.fileFormat },
    });

    // Auto-parse on upload if DOCX (best-effort; failures don't block create).
    if (newTemplate.fileFormat === "docx") {
      try {
        const parseRes = await parseTemplateInternal(
          newTemplate.id,
          newTemplate.fileObjectPath,
        );
        await recordAudit({
          templateId: newTemplate.id,
          eventType: "parsed",
          performedById: user?.id ?? null,
          performedByName: user?.displayName ?? null,
          payload: parseRes,
        });
      } catch (err) {
        req.log.warn({ err, templateId: newTemplate.id }, "auto-parse failed");
      }
    }

    res.status(201).json(newTemplate);
  },
);

// PATCH /templates/:id
router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = UpdateTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const [existing] = await db
      .select()
      .from(agreementTemplatesTable)
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const [updated] = await db
      .update(agreementTemplatesTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .returning();

    const user = await resolveUser(req.userId!);
    await recordAudit({
      templateId: updated.id,
      eventType: "metadata_updated",
      performedById: user?.id ?? null,
      performedByName: user?.displayName ?? null,
      payload: parsed.data as Record<string, unknown>,
    });

    res.json(updated);
  },
);

// POST /templates/:id/archive
router.post(
  "/:id/archive",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const [existing] = await db
      .select()
      .from(agreementTemplatesTable)
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (existing.status === "archived") {
      res.status(409).json({ error: "Template is already archived" });
      return;
    }
    const user = await resolveUser(req.userId!);
    const [updated] = await db
      .update(agreementTemplatesTable)
      .set({
        status: "archived",
        isActive: false,
        archivedAt: new Date(),
        archivedBy: user?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .returning();
    await recordAudit({
      templateId: updated.id,
      eventType: "archived",
      performedById: user?.id ?? null,
      performedByName: user?.displayName ?? null,
    });
    res.json(updated);
  },
);

// POST /templates/:id/restore
router.post(
  "/:id/restore",
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const [existing] = await db
      .select()
      .from(agreementTemplatesTable)
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (existing.status !== "archived") {
      res.status(409).json({ error: "Template is not archived" });
      return;
    }
    const user = await resolveUser(req.userId!);
    const [updated] = await db
      .update(agreementTemplatesTable)
      .set({
        status: "draft",
        isActive: false,
        archivedAt: null,
        archivedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .returning();
    await recordAudit({
      templateId: updated.id,
      eventType: "restored",
      performedById: user?.id ?? null,
      performedByName: user?.displayName ?? null,
    });
    res.json(updated);
  },
);

// POST /templates/:id/parse
router.post(
  "/:id/parse",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const [existing] = await db
      .select()
      .from(agreementTemplatesTable)
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (existing.fileFormat !== "docx") {
      res.status(409).json({ error: "Only DOCX templates can be parsed" });
      return;
    }
    let parseRes;
    try {
      parseRes = await parseTemplateInternal(existing.id, existing.fileObjectPath);
    } catch (err) {
      req.log.error({ err }, "template parse failed");
      res.status(500).json({ error: "Failed to parse template file" });
      return;
    }
    const user = await resolveUser(req.userId!);
    await recordAudit({
      templateId: existing.id,
      eventType: "parsed",
      performedById: user?.id ?? null,
      performedByName: user?.displayName ?? null,
      payload: parseRes,
    });
    const response = await buildMappingResponse(existing.id);
    res.json(response);
  },
);

// GET /templates/:id/variables
router.get("/:id/variables", async (req: Request, res: Response) => {
  const [existing] = await db
    .select({ id: agreementTemplatesTable.id })
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.id, String(req.params.id)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  const response = await buildMappingResponse(existing.id);
  res.json(response);
});

// POST /templates/:id/activate
router.post(
  "/:id/activate",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = ActivateTemplateBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(agreementTemplatesTable)
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (existing.status === "archived") {
      res
        .status(409)
        .json({ error: "Restore the template before activating" });
      return;
    }

    // Validate mapping for DOCX. PDF templates skip placeholder validation.
    if (existing.fileFormat === "docx") {
      const mapping = await buildMappingResponse(existing.id);
      if (mapping.items.length === 0) {
        res.status(409).json({
          error:
            "Template has not been parsed yet — run Parse before activation",
        });
        return;
      }
      if (!mapping.summary.canActivate) {
        res.status(409).json({
          error: "Variable mapping incomplete",
          blockers: mapping.summary.blockers,
        });
        return;
      }
    }

    const user = await resolveUser(req.userId!);
    const now = new Date();

    // Atomic supersede-prior + activate, plus all audit writes in one
    // transaction. Combined with the partial unique index on
    // (category) WHERE status='active', this makes concurrent activations
    // safe — the loser will rollback on unique violation.
    let updated: typeof existing;
    let supersededCount = 0;
    try {
      updated = await db.transaction(async (tx) => {
        const priorActive = await tx
          .select()
          .from(agreementTemplatesTable)
          .where(
            and(
              eq(agreementTemplatesTable.category, existing.category),
              eq(agreementTemplatesTable.status, "active"),
              ne(agreementTemplatesTable.id, existing.id),
            ),
          );

        for (const p of priorActive) {
          await tx
            .update(agreementTemplatesTable)
            .set({
              status: "superseded",
              isActive: false,
              supersededAt: now,
              supersededBy: user?.id ?? null,
              supersededTemplateId: existing.id,
              updatedAt: now,
            })
            .where(eq(agreementTemplatesTable.id, p.id));
          await tx.insert(documentTemplateAuditTable).values({
            templateId: p.id,
            eventType: "superseded",
            performedById: user?.id ?? null,
            performedByName: user?.displayName ?? null,
            reason: parsed.data.reason ?? null,
            payload: { replacedBy: existing.id },
          });
        }
        supersededCount = priorActive.length;

        const [row] = await tx
          .update(agreementTemplatesTable)
          .set({
            status: "active",
            isActive: true,
            activatedAt: now,
            activatedBy: user?.id ?? null,
            updatedAt: now,
          })
          .where(eq(agreementTemplatesTable.id, existing.id))
          .returning();

        await tx.insert(documentTemplateAuditTable).values({
          templateId: existing.id,
          eventType: "activated",
          performedById: user?.id ?? null,
          performedByName: user?.displayName ?? null,
          reason: parsed.data.reason ?? null,
          payload: { supersededCount: priorActive.length },
        });

        return row;
      });
    } catch (err) {
      req.log.error({ err }, "template activation transaction failed");
      res.status(409).json({
        error:
          "Activation failed — another template may have been activated for this category concurrently. Reload and try again.",
      });
      return;
    }

    res.json(updated);
    void supersededCount;
  },
);

// POST /templates/:id/supersede
router.post(
  "/:id/supersede",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = SupersedeTemplateBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [existing] = await db
      .select()
      .from(agreementTemplatesTable)
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (existing.status !== "active") {
      res
        .status(409)
        .json({ error: "Only active templates can be superseded" });
      return;
    }
    const user = await resolveUser(req.userId!);
    const now = new Date();
    const [updated] = await db
      .update(agreementTemplatesTable)
      .set({
        status: "superseded",
        isActive: false,
        supersededAt: now,
        supersededBy: user?.id ?? null,
        supersededTemplateId: parsed.data.replacementTemplateId ?? null,
        updatedAt: now,
      })
      .where(eq(agreementTemplatesTable.id, existing.id))
      .returning();
    await recordAudit({
      templateId: existing.id,
      eventType: "superseded",
      performedById: user?.id ?? null,
      performedByName: user?.displayName ?? null,
      reason: parsed.data.reason ?? null,
      payload: {
        replacementTemplateId: parsed.data.replacementTemplateId ?? null,
      },
    });
    res.json(updated);
  },
);

// GET /templates/:id/audit
router.get("/:id/audit", async (req: Request, res: Response) => {
  const events = await db
    .select()
    .from(documentTemplateAuditTable)
    .where(eq(documentTemplateAuditTable.templateId, String(req.params.id)))
    .orderBy(desc(documentTemplateAuditTable.createdAt));
  res.json(events);
});

export default router;

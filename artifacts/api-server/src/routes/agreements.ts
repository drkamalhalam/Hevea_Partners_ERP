import { Router } from "express";
import {
  db,
  agreementsTable,
  projectsTable,
  partnersTable,
  activityTable,
  agreementVariableValuesTable,
  auditLogsTable,
  usersTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  CreateAgreementBody,
  UpdateAgreementBody,
  GetAgreementParams,
  UpdateAgreementParams,
} from "@workspace/api-zod";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { VARIABLE_REGISTRY } from "../lib/variableRegistry";
import { resolveAgreementVariables } from "../lib/variableResolver";
import { generateDocument, DocumentGenerationError } from "../lib/documentGenerator";

const router = Router();

async function enrichAgreement(a: typeof agreementsTable.$inferSelect) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, a.projectId));
  const [landOwner] = await db.select().from(partnersTable).where(eq(partnersTable.id, a.landOwnerId));
  const [developer] = await db.select().from(partnersTable).where(eq(partnersTable.id, a.projectDeveloperId));
  return {
    ...a,
    projectName: project?.name ?? "Unknown",
    landOwnerName: landOwner?.name ?? "Unknown",
    projectDeveloperName: developer?.name ?? "Unknown",
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt?.toISOString() ?? null,
  };
}

// GET /agreements — filter by project access
router.get("/", async (req, res) => {
  try {
    const agreements = await db.select().from(agreementsTable).orderBy(agreementsTable.createdAt);
    const accessible = req.canAccessAllProjects
      ? agreements
      : agreements.filter((a) => canAccessProject(req, a.projectId));
    const enriched = await Promise.all(accessible.map(enrichAgreement));
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to list agreements");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /agreements — admin or developer only
router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = CreateAgreementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [agreement] = await db.insert(agreementsTable).values(parsed.data).returning();
    const enriched = await enrichAgreement(agreement);
    await db.insert(activityTable).values({
      type: "agreement_created",
      description: `New agreement created for project ${enriched.projectName}`,
      entityId: agreement.id,
      entityType: "agreement",
    });
    res.status(201).json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to create agreement");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /agreements/:id — check project access
router.get("/:id", async (req, res) => {
  const parsed = GetAgreementParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [agreement] = await db
      .select()
      .from(agreementsTable)
      .where(eq(agreementsTable.id, parsed.data.id));
    if (!agreement) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!canAccessProject(req, agreement.projectId)) {
      res.status(403).json({ error: "Forbidden: no access to this project" });
      return;
    }
    res.json(await enrichAgreement(agreement));
  } catch (err) {
    req.log.error({ err }, "Failed to get agreement");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /agreements/:id — admin or developer only
router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = UpdateAgreementParams.safeParse({ id: req.params.id });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const bodyParsed = UpdateAgreementBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  try {
    const [agreement] = await db
      .update(agreementsTable)
      .set(bodyParsed.data)
      .where(eq(agreementsTable.id, paramsParsed.data.id))
      .returning();
    if (!agreement) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(await enrichAgreement(agreement));
  } catch (err) {
    req.log.error({ err }, "Failed to update agreement");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Variable helpers ─────────────────────────────────────────────────────────

/** Build an AgreementVariablesResponse from stored rows + registry defaults. */
function buildVariablesResponse(
  agreementId: string,
  stored: (typeof agreementVariableValuesTable.$inferSelect)[],
) {
  const storedMap = new Map(stored.map((r) => [r.variableName, r]));

  const variables = Object.values(VARIABLE_REGISTRY).map((def) => {
    const row = storedMap.get(def.name);
    const resolvedValue = row?.resolvedValue ?? null;
    const overrideValue = row?.overrideValue ?? null;
    const effectiveValue = overrideValue ?? resolvedValue;
    return {
      name: def.name,
      label: def.label,
      description: def.description,
      dataSource: def.dataSource,
      group: def.group,
      example: def.example,
      resolvedValue,
      overrideValue,
      effectiveValue,
      isAutoResolved: row?.isAutoResolved ?? false,
    };
  });

  const resolvedCount = variables.filter((v) => v.effectiveValue !== null).length;
  const pendingCount = variables.length - resolvedCount;

  return { agreementId, variables, resolvedCount, pendingCount, totalCount: variables.length };
}

// GET /agreements/:id/variables
router.get("/:id/variables", async (req, res) => {
  const id = String(req.params.id);
  try {
    const [agreement] = await db
      .select()
      .from(agreementsTable)
      .where(eq(agreementsTable.id, id));
    if (!agreement) { res.status(404).json({ error: "Not found" }); return; }
    if (!canAccessProject(req, agreement.projectId)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const stored = await db
      .select()
      .from(agreementVariableValuesTable)
      .where(eq(agreementVariableValuesTable.agreementId, id));
    res.json(buildVariablesResponse(id, stored));
  } catch (err) {
    req.log.error({ err }, "Failed to list agreement variables");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /agreements/:id/variables — batch upsert manual overrides
router.put("/:id/variables", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  const { overrides } = req.body as { overrides: Array<{ name: string; value: string | null }> };
  if (!Array.isArray(overrides)) {
    res.status(400).json({ error: "overrides must be an array" }); return;
  }
  try {
    const [agreement] = await db
      .select()
      .from(agreementsTable)
      .where(eq(agreementsTable.id, id));
    if (!agreement) { res.status(404).json({ error: "Not found" }); return; }

    for (const { name, value } of overrides) {
      if (!(name in VARIABLE_REGISTRY)) continue;
      await db
        .insert(agreementVariableValuesTable)
        .values({
          agreementId: id,
          variableName: name,
          overrideValue: value ?? null,
          isAutoResolved: false,
        })
        .onConflictDoUpdate({
          target: [
            agreementVariableValuesTable.agreementId,
            agreementVariableValuesTable.variableName,
          ],
          set: { overrideValue: value ?? null },
        });
    }

    const stored = await db
      .select()
      .from(agreementVariableValuesTable)
      .where(eq(agreementVariableValuesTable.agreementId, id));

    // Write audit log for each override (non-fatal)
    const { userId: clerkUserId } = getAuth(req);
    const [actingUser] = clerkUserId
      ? await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId))
      : [null];
    for (const { name, value } of overrides) {
      const row = stored.find((s) => s.variableName === name);
      if (!row) continue;
      db.insert(auditLogsTable)
        .values({
          userId: actingUser?.id ?? undefined,
          tableName: "agreement_variable_values",
          recordId: row.id,
          operation: "UPDATE",
          newData: { agreementId: id, variableName: name, overrideValue: value } as Record<string, unknown>,
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        })
        .catch((err: unknown) => req.log.error({ err }, "Failed to write audit log for variable override"));
    }

    res.json(buildVariablesResponse(id, stored));
  } catch (err) {
    req.log.error({ err }, "Failed to update agreement variables");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /agreements/:id/variables/resolve — auto-resolve from project/partner data
router.post("/:id/variables/resolve", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  try {
    const [agreement] = await db
      .select()
      .from(agreementsTable)
      .where(eq(agreementsTable.id, id));
    if (!agreement) { res.status(404).json({ error: "Not found" }); return; }

    const resolved = await resolveAgreementVariables(agreement);

    for (const rv of resolved) {
      await db
        .insert(agreementVariableValuesTable)
        .values({
          agreementId: id,
          variableName: rv.name,
          resolvedValue: rv.value ?? null,
          dataSourceType: rv.dataSourceType,
          isAutoResolved: rv.isAutoResolved,
          resolvedAt: rv.isAutoResolved ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [
            agreementVariableValuesTable.agreementId,
            agreementVariableValuesTable.variableName,
          ],
          set: {
            resolvedValue: rv.value ?? null,
            dataSourceType: rv.dataSourceType,
            isAutoResolved: rv.isAutoResolved,
            resolvedAt: rv.isAutoResolved ? new Date() : null,
          },
        });
    }

    const stored = await db
      .select()
      .from(agreementVariableValuesTable)
      .where(eq(agreementVariableValuesTable.agreementId, id));
    res.json(buildVariablesResponse(id, stored));
  } catch (err) {
    req.log.error({ err }, "Failed to resolve agreement variables");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /agreements/:id/generate-document — fill a DOCX template with resolved variables
router.post("/:id/generate-document", requireRole("admin", "developer"), async (req, res) => {
  const id = String(req.params.id);
  // Architecture Correction Pass (May 2026):
  // `templateId` is now optional. When omitted, the generator auto-resolves
  // the unique active agreement template from the Document Template Registry.
  // Callers that already pass an explicit id continue to work unchanged.
  const { templateId } = (req.body ?? {}) as { templateId?: string };

  try {
    const result = await generateDocument({ agreementId: id, templateId });

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );
    res.setHeader("Content-Length", result.buffer.length);
    res.send(result.buffer);
  } catch (err) {
    if (err instanceof DocumentGenerationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to generate agreement document");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

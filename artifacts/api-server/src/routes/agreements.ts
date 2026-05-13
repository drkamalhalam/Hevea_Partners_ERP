import { Router } from "express";
import { db, agreementsTable, projectsTable, partnersTable, activityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateAgreementBody,
  UpdateAgreementBody,
  GetAgreementParams,
  UpdateAgreementParams,
} from "@workspace/api-zod";
import { requireRole, canAccessProject } from "../middlewares/auth";

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

export default router;

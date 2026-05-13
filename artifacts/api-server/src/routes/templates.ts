import { Router, type Request, type Response } from "express";
import { db, usersTable, agreementTemplatesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import {
  CreateTemplateBody,
  UpdateTemplateBody,
} from "@workspace/api-zod";

const router = Router();

// GET /templates — list all templates (filtered by status query param)
router.get("/", async (req: Request, res: Response) => {
  const { status } = req.query;
  const conditions = [];
  if (status === "active") {
    conditions.push(eq(agreementTemplatesTable.status, "active"));
  } else if (status === "archived") {
    conditions.push(eq(agreementTemplatesTable.status, "archived"));
  }

  const rows = await db
    .select()
    .from(agreementTemplatesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(agreementTemplatesTable.createdAt));

  res.json(rows);
});

// GET /templates/:id — get single template
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
  res.json(row);
});

// POST /templates — create template record after file upload (admin/developer)
router.post(
  "/",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = CreateTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }

    const { name, description, version, fileObjectPath, fileFormat, mimeType, fileSizeBytes } = parsed.data;

    // Resolve DB user ID from Clerk user ID
    const [userRow] = await db
      .select({ id: usersTable.id, displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, req.userId!))
      .limit(1);

    const [newTemplate] = await db
      .insert(agreementTemplatesTable)
      .values({
        name,
        description,
        version: version ?? "1.0",
        fileObjectPath,
        fileFormat,
        mimeType,
        fileSizeBytes,
        status: "active",
        isActive: true,
        uploadedBy: userRow?.id ?? null,
        uploadedByName: userRow?.displayName ?? null,
      })
      .returning();

    res.status(201).json(newTemplate);
  }
);

// PATCH /templates/:id — update name/description/version (admin/developer)
router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req: Request, res: Response) => {
    const parsed = UpdateTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
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

    res.json(updated);
  }
);

// POST /templates/:id/archive — archive a template (admin/developer)
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

    const [userRow] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, req.userId!))
      .limit(1);

    const [updated] = await db
      .update(agreementTemplatesTable)
      .set({
        status: "archived",
        isActive: false,
        archivedAt: new Date(),
        archivedBy: userRow?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .returning();

    res.json(updated);
  }
);

// POST /templates/:id/restore — restore archived template (admin only)
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

    const [updated] = await db
      .update(agreementTemplatesTable)
      .set({
        status: "active",
        isActive: true,
        archivedAt: null,
        archivedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(agreementTemplatesTable.id, String(req.params.id)))
      .returning();

    res.json(updated);
  }
);

export default router;

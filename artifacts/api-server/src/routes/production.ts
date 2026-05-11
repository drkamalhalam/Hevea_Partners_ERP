import { Router } from "express";
import { db, productionRecordsTable, projectsTable, activityTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  CreateProductionRecordBody,
  GetProductionRecordParams,
  DeleteProductionRecordParams,
} from "@workspace/api-zod";
import { z } from "zod/v4";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const projectIdRaw = req.query.projectId;
    const projectId = projectIdRaw ? Number(projectIdRaw) : undefined;

    const rows = await db
      .select({
        id: productionRecordsTable.id,
        projectId: productionRecordsTable.projectId,
        projectName: projectsTable.name,
        recordedAt: productionRecordsTable.recordedAt,
        productionKg: productionRecordsTable.productionKg,
        soldKg: productionRecordsTable.soldKg,
        sellingPricePerKg: productionRecordsTable.sellingPricePerKg,
        revenue: productionRecordsTable.revenue,
        notes: productionRecordsTable.notes,
        createdAt: productionRecordsTable.createdAt,
      })
      .from(productionRecordsTable)
      .innerJoin(projectsTable, eq(productionRecordsTable.projectId, projectsTable.id))
      .where(projectId ? eq(productionRecordsTable.projectId, projectId) : undefined)
      .orderBy(desc(productionRecordsTable.recordedAt));

    res.json(rows.map(r => ({
      ...r,
      recordedAt: r.recordedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list production records");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  const parsed = CreateProductionRecordBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { projectId, recordedAt, productionKg, soldKg, sellingPricePerKg, notes } = parsed.data;
  const revenue = soldKg * sellingPricePerKg;

  try {
    const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const [record] = await db
      .insert(productionRecordsTable)
      .values({
        projectId,
        recordedAt: new Date(recordedAt),
        productionKg,
        soldKg,
        sellingPricePerKg,
        revenue,
        notes: notes ?? null,
      })
      .returning();

    await db.insert(activityTable).values({
      type: "production_logged",
      description: `${soldKg} kg sold @ ₹${sellingPricePerKg}/kg for "${project.name}" — revenue ₹${revenue.toLocaleString("en-IN")}`,
      entityId: record.id,
      entityType: "production",
    });

    res.status(201).json({
      ...record,
      projectName: project.name,
      recordedAt: record.recordedAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create production record");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const parsed = GetProductionRecordParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    const [row] = await db
      .select({
        id: productionRecordsTable.id,
        projectId: productionRecordsTable.projectId,
        projectName: projectsTable.name,
        recordedAt: productionRecordsTable.recordedAt,
        productionKg: productionRecordsTable.productionKg,
        soldKg: productionRecordsTable.soldKg,
        sellingPricePerKg: productionRecordsTable.sellingPricePerKg,
        revenue: productionRecordsTable.revenue,
        notes: productionRecordsTable.notes,
        createdAt: productionRecordsTable.createdAt,
      })
      .from(productionRecordsTable)
      .innerJoin(projectsTable, eq(productionRecordsTable.projectId, projectsTable.id))
      .where(eq(productionRecordsTable.id, parsed.data.id));

    if (!row) return res.status(404).json({ error: "Not found" });

    res.json({
      ...row,
      recordedAt: row.recordedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get production record");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const parsed = DeleteProductionRecordParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(productionRecordsTable).where(eq(productionRecordsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete production record");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

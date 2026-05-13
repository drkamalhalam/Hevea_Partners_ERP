import { Router } from "express";
import { db, productionRecordsTable, projectsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { canAccessProject } from "../middlewares/auth";

const router = Router();

// GET /stock — aggregate production data, filtered by project access
router.get("/", async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable).orderBy(projectsTable.name);

    const agg = await db
      .select({
        projectId: productionRecordsTable.projectId,
        totalProducedKg: sql<number>`COALESCE(SUM(${productionRecordsTable.productionKg}), 0)`,
        totalSoldKg: sql<number>`COALESCE(SUM(${productionRecordsTable.soldKg}), 0)`,
        lastUpdatedAt: sql<string | null>`MAX(${productionRecordsTable.recordedAt})`,
      })
      .from(productionRecordsTable)
      .groupBy(productionRecordsTable.projectId);

    const aggMap = new Map(agg.map((r) => [r.projectId, r]));

    const accessible = req.canAccessAllProjects
      ? projects
      : projects.filter((p) => canAccessProject(req, p.id));

    const result = accessible.map((p) => {
      const data = aggMap.get(p.id);
      const totalProducedKg = data ? Number(data.totalProducedKg) : 0;
      const totalSoldKg = data ? Number(data.totalSoldKg) : 0;
      return {
        projectId: p.id,
        projectName: p.name,
        location: p.location,
        district: p.district,
        totalProducedKg,
        totalSoldKg,
        currentStockKg: totalProducedKg - totalSoldKg,
        lastUpdatedAt: data?.lastUpdatedAt
          ? new Date(data.lastUpdatedAt).toISOString()
          : null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get stock summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

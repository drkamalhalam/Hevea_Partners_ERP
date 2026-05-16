import { Router } from "express";
import { db, inventoryStockMovementsTable, projectsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { canAccessProject } from "../middlewares/auth";

const router = Router();

/**
 * GET /stock
 * Canonical rubber stock summary per project.
 * Source of truth: inventory_stock_movements (confirmed, active rows only).
 *
 * Balance = SUM(in) − SUM(out) for confirmed movements per (project × stockType).
 * Legacy fields (totalProduced, totalSold, currentStock) are kept for backward
 * compatibility and represent aggregated kg-denominated types only.
 */
router.get("/", async (req, res) => {
  try {
    const projects = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        location: projectsTable.location,
        district: projectsTable.district,
      })
      .from(projectsTable)
      .orderBy(projectsTable.name);

    // Aggregate confirmed, active movements per (project × stockType × direction × unit)
    const movRows = await db
      .select({
        projectId: inventoryStockMovementsTable.projectId,
        stockType: inventoryStockMovementsTable.stockType,
        direction: inventoryStockMovementsTable.direction,
        unit: inventoryStockMovementsTable.unit,
        total: sql<string>`COALESCE(SUM(${inventoryStockMovementsTable.quantity}::numeric), 0)`,
        lastAt: sql<string | null>`MAX(${inventoryStockMovementsTable.movementDate}::text)`,
      })
      .from(inventoryStockMovementsTable)
      .where(
        and(
          eq(inventoryStockMovementsTable.status, "confirmed"),
          eq(inventoryStockMovementsTable.isActive, true),
        ),
      )
      .groupBy(
        inventoryStockMovementsTable.projectId,
        inventoryStockMovementsTable.stockType,
        inventoryStockMovementsTable.direction,
        inventoryStockMovementsTable.unit,
      );

    // Build per-project → per-stockType balance map
    type TypeBucket = { totalIn: number; totalOut: number; balance: number; unit: string; lastAt: string | null };
    const projectMap = new Map<string, Map<string, TypeBucket>>();

    for (const row of movRows) {
      if (!projectMap.has(row.projectId)) projectMap.set(row.projectId, new Map());
      const typeMap = projectMap.get(row.projectId)!;
      if (!typeMap.has(row.stockType)) {
        typeMap.set(row.stockType, { totalIn: 0, totalOut: 0, balance: 0, unit: row.unit, lastAt: null });
      }
      const b = typeMap.get(row.stockType)!;
      const qty = Number(row.total);
      if (row.direction === "in") b.totalIn += qty;
      else b.totalOut += qty;
      b.balance = b.totalIn - b.totalOut;
      if (row.lastAt && (!b.lastAt || row.lastAt > b.lastAt)) b.lastAt = row.lastAt;
    }

    const accessible = req.canAccessAllProjects
      ? projects
      : projects.filter((p) => canAccessProject(req, p.id));

    const result = accessible.map((p) => {
      const typeMap = projectMap.get(p.id) ?? new Map<string, TypeBucket>();

      const stockByType = Array.from(typeMap.entries()).map(([stockType, b]) => ({
        stockType,
        totalIn: b.totalIn,
        totalOut: b.totalOut,
        balance: b.balance,
        unit: b.unit,
        lastMovementAt: b.lastAt,
      }));

      // Backward-compat aggregates: sum kg-denominated types (rubber_sheet, rubber_scrap)
      // Latex (litres) is excluded from kg totals to preserve unit integrity.
      const kgTypes = stockByType.filter((s) => s.unit === "kg");
      const totalProduced = kgTypes.reduce((s, t) => s + t.totalIn, 0);
      const totalSold = kgTypes.reduce((s, t) => s + t.totalOut, 0);
      const currentStock = kgTypes.reduce((s, t) => s + t.balance, 0);
      const lastMovementAt =
        stockByType
          .map((s) => s.lastMovementAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;

      return {
        projectId: p.id,
        projectName: p.name,
        location: p.location ?? null,
        district: p.district ?? null,
        stockByType,
        totalProduced,
        totalSold,
        currentStock,
        lastMovementAt,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get canonical stock summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

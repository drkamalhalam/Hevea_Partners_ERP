import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  inventoryStockMovementsTable,
  productionBatchesTable,
  projectsTable,
  userProjectAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { requireRole, canAccessProject } from "../middlewares/auth";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const STOCK_TYPES = ["latex", "rubber_sheet", "rubber_scrap"] as const;
type StockType = (typeof STOCK_TYPES)[number];

const MOVEMENT_TYPES = [
  "opening",
  "production_in",
  "purchase_in",
  "sale_out",
  "transfer_out",
  "wastage",
  "adjustment_in",
  "adjustment_out",
] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

const DIRECTION_MAP: Record<MovementType, "in" | "out"> = {
  opening: "in",
  production_in: "in",
  purchase_in: "in",
  sale_out: "out",
  transfer_out: "out",
  wastage: "out",
  adjustment_in: "in",
  adjustment_out: "out",
};

const ADJUSTMENT_TYPES: MovementType[] = ["adjustment_in", "adjustment_out"];

function defaultUnit(stockType: StockType): string {
  return stockType === "latex" ? "litres" : "kg";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function isAdmin(role: string) { return role === "admin"; }
function canManage(role: string) { return role === "admin" || role === "developer"; }
function canOperate(role: string) {
  return ["admin", "developer", "employee", "operational_staff"].includes(role);
}
function canViewAll(role: string) { return role === "admin" || role === "developer"; }

async function getVisibleProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(
      and(
        eq(userProjectAssignmentsTable.userId, userId),
        isNull(userProjectAssignmentsTable.revokedAt),
      ),
    );
  return rows.map((r) => r.projectId);
}

function formatMovement(
  row: typeof inventoryStockMovementsTable.$inferSelect & {
    projectName?: string | null;
    batchNumber?: string | null;
  },
) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    stockType: row.stockType,
    movementType: row.movementType,
    direction: row.direction,
    quantity: Number(row.quantity),
    unit: row.unit,
    movementDate: row.movementDate,
    batchId: row.batchId ?? undefined,
    batchNumber: row.batchNumber ?? undefined,
    referenceId: row.referenceId ?? undefined,
    referenceType: row.referenceType ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    confirmedAt: row.confirmedAt?.toISOString() ?? undefined,
    confirmedByName: row.confirmedByName ?? undefined,
    cancelledAt: row.cancelledAt?.toISOString() ?? undefined,
    cancelledByName: row.cancelledByName ?? undefined,
    createdByName: row.createdByName,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /inventory-stock/balance ──────────────────────────────────────────────
// Returns current confirmed balance per stock type, optionally per project.

router.get("/balance", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId } = req.query as Record<string, string>;

  let visibleIds: string[] | null = null;
  if (!canViewAll(actor.role)) {
    visibleIds = await getVisibleProjectIds(actor.id);
    if (projectId && !visibleIds.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const rows = await db
    .select({
      projectId: inventoryStockMovementsTable.projectId,
      projectName: projectsTable.name,
      stockType: inventoryStockMovementsTable.stockType,
      unit: inventoryStockMovementsTable.unit,
      totalIn: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      totalOut: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
    })
    .from(inventoryStockMovementsTable)
    .leftJoin(projectsTable, eq(inventoryStockMovementsTable.projectId, projectsTable.id))
    .where(
      and(
        eq(inventoryStockMovementsTable.status, "confirmed"),
        eq(inventoryStockMovementsTable.isActive, true),
        projectId ? eq(inventoryStockMovementsTable.projectId, projectId) : undefined,
        visibleIds
          ? inArray(inventoryStockMovementsTable.projectId, visibleIds.length > 0 ? visibleIds : ["__none__"])
          : undefined,
      ),
    )
    .groupBy(
      inventoryStockMovementsTable.projectId,
      projectsTable.name,
      inventoryStockMovementsTable.stockType,
      inventoryStockMovementsTable.unit,
    );

  // Pending counts per project+type
  const pendingRows = await db
    .select({
      projectId: inventoryStockMovementsTable.projectId,
      stockType: inventoryStockMovementsTable.stockType,
      pendingCount: sql<number>`count(*)::int`,
      pendingQty: sql<number>`SUM(${inventoryStockMovementsTable.quantity}::numeric)`,
    })
    .from(inventoryStockMovementsTable)
    .where(
      and(
        eq(inventoryStockMovementsTable.status, "pending"),
        eq(inventoryStockMovementsTable.isActive, true),
        projectId ? eq(inventoryStockMovementsTable.projectId, projectId) : undefined,
        visibleIds
          ? inArray(inventoryStockMovementsTable.projectId, visibleIds.length > 0 ? visibleIds : ["__none__"])
          : undefined,
      ),
    )
    .groupBy(inventoryStockMovementsTable.projectId, inventoryStockMovementsTable.stockType);

  const pendingMap: Record<string, { count: number; qty: number }> = {};
  for (const r of pendingRows) {
    pendingMap[`${r.projectId}:${r.stockType}`] = { count: r.pendingCount, qty: Number(r.pendingQty) };
  }

  return res.json(
    rows.map((r) => {
      const key = `${r.projectId}:${r.stockType}`;
      return {
        projectId: r.projectId,
        projectName: r.projectName ?? undefined,
        stockType: r.stockType,
        unit: r.unit,
        totalIn: Number(r.totalIn),
        totalOut: Number(r.totalOut),
        balance: Number(r.totalIn) - Number(r.totalOut),
        pendingCount: pendingMap[key]?.count ?? 0,
        pendingQty: pendingMap[key]?.qty ?? 0,
      };
    }),
  );
});

// ── GET /inventory-stock/summary ──────────────────────────────────────────────
// Aggregated dashboard summary with movement type breakdown.

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId } = req.query as Record<string, string>;

  let visibleIds: string[] | null = null;
  if (!canViewAll(actor.role)) {
    visibleIds = await getVisibleProjectIds(actor.id);
    if (projectId && !visibleIds.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const baseWhere = and(
    eq(inventoryStockMovementsTable.isActive, true),
    projectId ? eq(inventoryStockMovementsTable.projectId, projectId) : undefined,
    visibleIds
      ? inArray(inventoryStockMovementsTable.projectId, visibleIds.length > 0 ? visibleIds : ["__none__"])
      : undefined,
  );

  const [movementStats] = await db
    .select({
      totalMovements: sql<number>`count(*)::int`,
      confirmedCount: sql<number>`count(*) filter (where ${inventoryStockMovementsTable.status} = 'confirmed')::int`,
      pendingCount: sql<number>`count(*) filter (where ${inventoryStockMovementsTable.status} = 'pending')::int`,
      cancelledCount: sql<number>`count(*) filter (where ${inventoryStockMovementsTable.status} = 'cancelled')::int`,
    })
    .from(inventoryStockMovementsTable)
    .where(baseWhere);

  // Balance per stock type (confirmed only)
  const balanceRows = await db
    .select({
      stockType: inventoryStockMovementsTable.stockType,
      unit: inventoryStockMovementsTable.unit,
      totalIn: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      totalOut: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      productionIn: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.movementType} = 'production_in' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      saleOut: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.movementType} = 'sale_out' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      wastage: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.movementType} = 'wastage' AND ${inventoryStockMovementsTable.status} = 'confirmed' THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
    })
    .from(inventoryStockMovementsTable)
    .where(baseWhere)
    .groupBy(inventoryStockMovementsTable.stockType, inventoryStockMovementsTable.unit);

  const stockSummary = balanceRows.map((r) => ({
    stockType: r.stockType,
    unit: r.unit,
    totalIn: Number(r.totalIn),
    totalOut: Number(r.totalOut),
    balance: Number(r.totalIn) - Number(r.totalOut),
    productionIn: Number(r.productionIn),
    saleOut: Number(r.saleOut),
    wastage: Number(r.wastage),
  }));

  // Ensure all 3 types appear even with zero data
  const typeDefaults: { stockType: StockType; unit: string }[] = [
    { stockType: "latex", unit: "litres" },
    { stockType: "rubber_sheet", unit: "kg" },
    { stockType: "rubber_scrap", unit: "kg" },
  ];
  for (const t of typeDefaults) {
    if (!stockSummary.find((s) => s.stockType === t.stockType)) {
      stockSummary.push({ stockType: t.stockType, unit: t.unit, totalIn: 0, totalOut: 0, balance: 0, productionIn: 0, saleOut: 0, wastage: 0 });
    }
  }

  return res.json({
    totalMovements: movementStats?.totalMovements ?? 0,
    confirmedCount: movementStats?.confirmedCount ?? 0,
    pendingCount: movementStats?.pendingCount ?? 0,
    cancelledCount: movementStats?.cancelledCount ?? 0,
    stockSummary,
  });
});

// ── GET /inventory-stock/movements ────────────────────────────────────────────

router.get("/movements", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "User not found" });

  const { projectId, stockType, movementType, status } = req.query as Record<string, string>;

  let visibleIds: string[] | null = null;
  if (!canViewAll(actor.role)) {
    visibleIds = await getVisibleProjectIds(actor.id);
    if (projectId && !visibleIds.includes(projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const rows = await db
    .select({
      mov: inventoryStockMovementsTable,
      projectName: projectsTable.name,
      batchNumber: productionBatchesTable.batchNumber,
    })
    .from(inventoryStockMovementsTable)
    .leftJoin(projectsTable, eq(inventoryStockMovementsTable.projectId, projectsTable.id))
    .leftJoin(productionBatchesTable, eq(inventoryStockMovementsTable.batchId, productionBatchesTable.id))
    .where(
      and(
        eq(inventoryStockMovementsTable.isActive, true),
        projectId ? eq(inventoryStockMovementsTable.projectId, projectId) : undefined,
        stockType ? eq(inventoryStockMovementsTable.stockType, stockType) : undefined,
        movementType ? eq(inventoryStockMovementsTable.movementType, movementType) : undefined,
        status ? eq(inventoryStockMovementsTable.status, status) : undefined,
        visibleIds
          ? inArray(inventoryStockMovementsTable.projectId, visibleIds.length > 0 ? visibleIds : ["__none__"])
          : undefined,
      ),
    )
    .orderBy(desc(inventoryStockMovementsTable.movementDate), desc(inventoryStockMovementsTable.createdAt));

  return res.json(
    rows.map((r) =>
      formatMovement({ ...r.mov, projectName: r.projectName, batchNumber: r.batchNumber }),
    ),
  );
});

// ── POST /inventory-stock/movements ───────────────────────────────────────────

router.post(
  "/movements",
  requireRole("admin", "developer", "employee", "operational_staff"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    type Body = {
      projectId: string;
      stockType: string;
      movementType: string;
      quantity: number;
      unit?: string;
      movementDate: string;
      batchId?: string;
      referenceId?: string;
      referenceType?: string;
      notes?: string;
    };
    const {
      projectId, stockType, movementType, quantity, unit,
      movementDate, batchId, referenceId, referenceType, notes,
    } = req.body as Body;

    if (!projectId || !stockType || !movementType || !quantity || !movementDate) {
      return res.status(400).json({ error: "projectId, stockType, movementType, quantity, movementDate required" });
    }
    if (!STOCK_TYPES.includes(stockType as StockType)) {
      return res.status(400).json({ error: `stockType must be one of: ${STOCK_TYPES.join(", ")}` });
    }
    if (!MOVEMENT_TYPES.includes(movementType as MovementType)) {
      return res.status(400).json({ error: `movementType must be one of: ${MOVEMENT_TYPES.join(", ")}` });
    }
    if (!canAccessProject(req, projectId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Only admin/developer can create adjustments directly (they auto-confirm)
    // employees/operational_staff can create adjustments but they start pending
    const isAdjustment = ADJUSTMENT_TYPES.includes(movementType as MovementType);
    const direction = DIRECTION_MAP[movementType as MovementType];
    const effectiveUnit = unit ?? defaultUnit(stockType as StockType);
    const actorName = actor.displayName ?? actor.email ?? "Unknown";

    // Adjustments: pending by default (require separate confirm); others: confirmed
    const startStatus = isAdjustment && !canManage(actor.role) ? "pending" : "confirmed";
    const confirmedAt = startStatus === "confirmed" ? new Date() : null;
    const confirmedByName = startStatus === "confirmed" ? actorName : null;
    const confirmedById = startStatus === "confirmed" ? actor.id : null;

    const [created] = await db
      .insert(inventoryStockMovementsTable)
      .values({
        projectId,
        stockType,
        movementType,
        direction,
        quantity: quantity.toString(),
        unit: effectiveUnit,
        movementDate,
        batchId: batchId ?? null,
        referenceId: referenceId ?? null,
        referenceType: referenceType ?? null,
        notes: notes ?? null,
        status: startStatus,
        confirmedAt,
        confirmedById,
        confirmedByName,
        createdById: actor.id,
        createdByName: actorName,
        isActive: true,
      })
      .returning();

    return res.status(201).json(formatMovement(created));
  },
);

// ── POST /inventory-stock/movements/:id/confirm ───────────────────────────────

router.post(
  "/movements/:id/confirm",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const movId = req.params.id as string;
    const [mov] = await db
      .select()
      .from(inventoryStockMovementsTable)
      .where(eq(inventoryStockMovementsTable.id, movId))
      .limit(1);

    if (!mov || !mov.isActive) return res.status(404).json({ error: "Movement not found" });
    if (!canAccessProject(req, mov.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (mov.status !== "pending") return res.status(400).json({ error: `Movement is already ${mov.status}` });

    const actorName = actor.displayName ?? actor.email ?? "Unknown";
    const [updated] = await db
      .update(inventoryStockMovementsTable)
      .set({ status: "confirmed", confirmedAt: new Date(), confirmedById: actor.id, confirmedByName: actorName, updatedAt: new Date() })
      .where(eq(inventoryStockMovementsTable.id, movId))
      .returning();

    return res.json(formatMovement(updated));
  },
);

// ── POST /inventory-stock/movements/:id/cancel ────────────────────────────────

router.post(
  "/movements/:id/cancel",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const movId = req.params.id as string;
    const [mov] = await db
      .select()
      .from(inventoryStockMovementsTable)
      .where(eq(inventoryStockMovementsTable.id, movId))
      .limit(1);

    if (!mov || !mov.isActive) return res.status(404).json({ error: "Movement not found" });
    if (!canAccessProject(req, mov.projectId)) return res.status(403).json({ error: "Forbidden" });
    if (mov.status === "cancelled") return res.status(400).json({ error: "Already cancelled" });

    const actorName = actor.displayName ?? actor.email ?? "Unknown";
    const [updated] = await db
      .update(inventoryStockMovementsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledById: actor.id, cancelledByName: actorName, updatedAt: new Date() })
      .where(eq(inventoryStockMovementsTable.id, movId))
      .returning();

    return res.json(formatMovement(updated));
  },
);

// ── DELETE /inventory-stock/movements/:id ─────────────────────────────────────

router.delete(
  "/movements/:id",
  requireRole("admin"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
    const actor = await resolveActor(clerkUserId);
    if (!actor) return res.status(401).json({ error: "User not found" });

    const movId = req.params.id as string;
    const [mov] = await db
      .select()
      .from(inventoryStockMovementsTable)
      .where(eq(inventoryStockMovementsTable.id, movId))
      .limit(1);

    if (!mov || !mov.isActive) return res.status(404).json({ error: "Movement not found" });
    if (!canAccessProject(req, mov.projectId)) return res.status(403).json({ error: "Forbidden" });

    await db
      .update(inventoryStockMovementsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(inventoryStockMovementsTable.id, movId));

    return res.json({ success: true });
  },
);

export default router;

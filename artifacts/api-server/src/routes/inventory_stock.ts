import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  inventoryStockMovementsTable,
  productionBatchesTable,
  productionEntriesTable,
  projectsTable,
  salesTransactionsTable,
  salesLineItemsTable,
  userProjectAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { logOperationalAccess } from "../lib/accessLog";

const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const STOCK_TYPES = ["latex", "rubber_sheet", "rubber_scrap"] as const;
type StockType = (typeof STOCK_TYPES)[number];

const MOVEMENT_TYPES = [
  "opening",
  "production_in",
  "purchase_in",
  "stock_in",
  "sale_out",
  "stock_out",
  "transfer_out",
  "transfer_in",
  "wastage",
  "return",
  "correction",
  "adjustment_in",
  "adjustment_out",
] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

const DIRECTION_MAP: Record<MovementType, "in" | "out"> = {
  opening: "in",
  production_in: "in",
  purchase_in: "in",
  stock_in: "in",
  sale_out: "out",
  stock_out: "out",
  transfer_out: "out",
  transfer_in: "in",
  wastage: "out",
  return: "in",    // returned goods come back into stock
  correction: "in", // positive correction; use adjustment_out for negative
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

// ── GET /inventory-stock/analytics ────────────────────────────────────────────
// Comprehensive analytics: monthly trends, stock valuation, batch summary, low-stock alerts.

router.get("/analytics", async (req, res) => {
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

  const projectFilter = projectId
    ? sql`AND m.project_id = ${projectId}::uuid`
    : visibleIds && visibleIds.length > 0
      ? sql`AND m.project_id = ANY(ARRAY[${sql.join(visibleIds.map((id) => sql`${id}::uuid`), sql`, `)}])`
      : visibleIds && visibleIds.length === 0
        ? sql`AND FALSE`
        : sql``;

  const salesProjectFilter = projectId
    ? sql`AND st.project_id = ${projectId}::uuid`
    : visibleIds && visibleIds.length > 0
      ? sql`AND st.project_id = ANY(ARRAY[${sql.join(visibleIds.map((id) => sql`${id}::uuid`), sql`, `)}])`
      : visibleIds && visibleIds.length === 0
        ? sql`AND FALSE`
        : sql``;

  const batchProjectFilter = projectId
    ? sql`AND pb.project_id = ${projectId}::uuid`
    : visibleIds && visibleIds.length > 0
      ? sql`AND pb.project_id = ANY(ARRAY[${sql.join(visibleIds.map((id) => sql`${id}::uuid`), sql`, `)}])`
      : visibleIds && visibleIds.length === 0
        ? sql`AND FALSE`
        : sql``;

  // ── 1. Monthly stock movement time-series (last 13 months) ──────────────────
  const monthlyRaw = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', m.movement_date::timestamp), 'YYYY-MM') AS month,
      m.stock_type,
      m.movement_type,
      m.direction,
      COALESCE(SUM(m.quantity::numeric), 0)::float AS total_qty
    FROM inventory_stock_movements m
    WHERE
      m.status = 'confirmed'
      AND m.is_active = true
      AND m.movement_date >= (NOW() - INTERVAL '13 months')
      ${projectFilter}
    GROUP BY month, m.stock_type, m.movement_type, m.direction
    ORDER BY month
  `);

  // ── 2. Current balance per stock type ────────────────────────────────────────
  const balanceRaw = await db.execute(sql`
    SELECT
      m.stock_type,
      m.unit,
      COALESCE(SUM(CASE WHEN m.direction = 'in' THEN m.quantity::numeric ELSE 0 END), 0)::float AS total_in,
      COALESCE(SUM(CASE WHEN m.direction = 'out' THEN m.quantity::numeric ELSE 0 END), 0)::float AS total_out,
      COALESCE(SUM(CASE WHEN m.movement_type = 'wastage' THEN m.quantity::numeric ELSE 0 END), 0)::float AS total_wastage,
      COALESCE(SUM(CASE WHEN m.movement_type = 'production_in' THEN m.quantity::numeric ELSE 0 END), 0)::float AS total_production_in,
      COALESCE(SUM(CASE WHEN m.movement_type = 'sale_out' THEN m.quantity::numeric ELSE 0 END), 0)::float AS total_sale_out
    FROM inventory_stock_movements m
    WHERE
      m.status = 'confirmed'
      AND m.is_active = true
      ${projectFilter}
    GROUP BY m.stock_type, m.unit
  `);

  // ── 3. Latest sale rate per product type ─────────────────────────────────────
  const rateRaw = await db.execute(sql`
    SELECT DISTINCT ON (li.product_type)
      li.product_type,
      li.unit,
      li.sale_rate::float AS sale_rate,
      st.sale_date
    FROM sales_line_items li
    JOIN sales_transactions st ON st.id = li.transaction_id
    WHERE
      st.status = 'confirmed'
      AND st.is_active = true
      AND li.sale_rate IS NOT NULL
      ${salesProjectFilter}
    ORDER BY li.product_type, st.sale_date DESC
  `);

  // ── 4. Batch summary ─────────────────────────────────────────────────────────
  const batchCountRaw = await db.execute(sql`
    SELECT
      pb.status,
      COUNT(*)::int AS cnt
    FROM production_batches pb
    WHERE TRUE ${batchProjectFilter}
    GROUP BY pb.status
  `);

  const recentBatchesRaw = await db.execute(sql`
    SELECT
      pb.id,
      pb.batch_number,
      pb.batch_date,
      pb.project_id,
      p.name AS project_name,
      pb.status,
      pb.total_latex_litres::float AS total_latex_litres,
      pb.total_sheet_kg::float AS total_sheet_kg,
      pb.total_scrap_kg::float AS total_scrap_kg,
      pb.entry_count,
      pb.created_by_name,
      pb.created_at
    FROM production_batches pb
    LEFT JOIN projects p ON p.id = pb.project_id
    WHERE TRUE ${batchProjectFilter}
    ORDER BY pb.batch_date DESC, pb.created_at DESC
    LIMIT 10
  `);

  // ── 5. Monthly sales trends ──────────────────────────────────────────────────
  const salesTrendRaw = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', st.sale_date::timestamp), 'YYYY-MM') AS month,
      COALESCE(SUM(st.total_gross_revenue::numeric), 0)::float AS revenue,
      COALESCE(SUM(st.total_net_revenue::numeric), 0)::float AS net_revenue,
      COUNT(*)::int AS sales_count
    FROM sales_transactions st
    WHERE
      st.status = 'confirmed'
      AND st.is_active = true
      AND st.sale_date >= (NOW() - INTERVAL '13 months')
      ${salesProjectFilter}
    GROUP BY month
    ORDER BY month
  `);

  // ── Assemble stock valuation ─────────────────────────────────────────────────
  const rateMap: Record<string, { rate: number; date: string }> = {};
  for (const r of rateRaw.rows) {
    const row = r as { product_type: string; sale_rate: number; sale_date: string };
    rateMap[row.product_type] = { rate: row.sale_rate, date: row.sale_date };
  }

  const LOW_STOCK_THRESHOLDS: Record<string, number> = {
    latex: 500,
    rubber_sheet: 200,
    rubber_scrap: 100,
  };

  const allTypes = ["latex", "rubber_sheet", "rubber_scrap"];
  const balanceMap: Record<string, { unit: string; totalIn: number; totalOut: number; wastage: number; prodIn: number; saleOut: number }> = {};
  for (const r of balanceRaw.rows) {
    const row = r as { stock_type: string; unit: string; total_in: number; total_out: number; total_wastage: number; total_production_in: number; total_sale_out: number };
    balanceMap[row.stock_type] = {
      unit: row.unit,
      totalIn: row.total_in,
      totalOut: row.total_out,
      wastage: row.total_wastage,
      prodIn: row.total_production_in,
      saleOut: row.total_sale_out,
    };
  }

  const stockValuation = allTypes.map((st) => {
    const b = balanceMap[st];
    const balance = b ? b.totalIn - b.totalOut : 0;
    const unit = b?.unit ?? (st === "latex" ? "litres" : "kg");
    const rateInfo = rateMap[st];
    const lastSaleRate = rateInfo?.rate ?? 0;
    const estimatedValue = lastSaleRate > 0 ? balance * lastSaleRate : 0;
    const threshold = LOW_STOCK_THRESHOLDS[st] ?? 100;
    const alertLevel =
      balance <= 0 ? "empty" :
      balance < threshold * 0.5 ? "critical" :
      balance < threshold ? "low" : "ok";

    return {
      stockType: st,
      unit,
      balance,
      totalIn: b?.totalIn ?? 0,
      totalOut: b?.totalOut ?? 0,
      totalWastage: b?.wastage ?? 0,
      totalProductionIn: b?.prodIn ?? 0,
      totalSaleOut: b?.saleOut ?? 0,
      // Financial fields — set below after role check
      lastSaleRate,
      lastSaleDate: rateInfo?.date ?? null,
      estimatedValue,
      alertLevel,
      threshold,
    };
  });

  // ── Assemble monthly trends ───────────────────────────────────────────────────
  const monthMap: Record<string, Record<string, number>> = {};
  for (const r of monthlyRaw.rows) {
    const row = r as { month: string; stock_type: string; movement_type: string; direction: string; total_qty: number };
    if (!monthMap[row.month]) monthMap[row.month] = {};
    const prefix = row.stock_type === "latex" ? "l" : row.stock_type === "rubber_sheet" ? "s" : "sc";
    const mt = row.movement_type;
    if (mt === "production_in") monthMap[row.month][`${prefix}_prod_in`] = (monthMap[row.month][`${prefix}_prod_in`] ?? 0) + row.total_qty;
    else if (mt === "sale_out") monthMap[row.month][`${prefix}_sale_out`] = (monthMap[row.month][`${prefix}_sale_out`] ?? 0) + row.total_qty;
    else if (mt === "wastage") monthMap[row.month][`${prefix}_wastage`] = (monthMap[row.month][`${prefix}_wastage`] ?? 0) + row.total_qty;
    else if (row.direction === "in") monthMap[row.month][`${prefix}_other_in`] = (monthMap[row.month][`${prefix}_other_in`] ?? 0) + row.total_qty;
    else monthMap[row.month][`${prefix}_other_out`] = (monthMap[row.month][`${prefix}_other_out`] ?? 0) + row.total_qty;
  }

  const monthlyTrends = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      latexProdIn: d.l_prod_in ?? 0,
      latexSaleOut: d.l_sale_out ?? 0,
      latexWastage: d.l_wastage ?? 0,
      latexOtherIn: d.l_other_in ?? 0,
      latexOtherOut: d.l_other_out ?? 0,
      sheetProdIn: d.s_prod_in ?? 0,
      sheetSaleOut: d.s_sale_out ?? 0,
      sheetWastage: d.s_wastage ?? 0,
      sheetOtherIn: d.s_other_in ?? 0,
      sheetOtherOut: d.s_other_out ?? 0,
      scrapProdIn: d.sc_prod_in ?? 0,
      scrapSaleOut: d.sc_sale_out ?? 0,
      scrapWastage: d.sc_wastage ?? 0,
      scrapOtherIn: d.sc_other_in ?? 0,
      scrapOtherOut: d.sc_other_out ?? 0,
    }));

  // ── Assemble batch summary ───────────────────────────────────────────────────
  const batchCounts: Record<string, number> = {};
  for (const r of batchCountRaw.rows) {
    const row = r as { status: string; cnt: number };
    batchCounts[row.status] = row.cnt;
  }
  const totalBatches = Object.values(batchCounts).reduce((a, b) => a + b, 0);

  const recentBatches = recentBatchesRaw.rows.map((r) => {
    const row = r as {
      id: string; batch_number: string; batch_date: string; project_id: string; project_name: string | null;
      status: string; total_latex_litres: number; total_sheet_kg: number; total_scrap_kg: number;
      entry_count: number; created_by_name: string; created_at: string;
    };
    return {
      id: row.id,
      batchNumber: row.batch_number,
      batchDate: row.batch_date,
      projectId: row.project_id,
      projectName: row.project_name ?? undefined,
      status: row.status,
      totalLatexLitres: row.total_latex_litres,
      totalSheetKg: row.total_sheet_kg,
      totalScrapKg: row.total_scrap_kg,
      entryCount: row.entry_count,
      createdByName: row.created_by_name,
      createdAt: typeof row.created_at === "string" ? row.created_at : (row.created_at as Date).toISOString(),
    };
  });

  // ── Assemble sales trends ───────────────────────────────────────────────────
  const salesTrends = salesTrendRaw.rows.map((r) => {
    const row = r as { month: string; revenue: number; net_revenue: number; sales_count: number };
    return {
      month: row.month,
      revenue: row.revenue,
      netRevenue: row.net_revenue,
      salesCount: row.sales_count,
    };
  });

  // ── Low stock alerts ─────────────────────────────────────────────────────────
  const lowStockAlerts = stockValuation
    .filter((v) => v.alertLevel !== "ok")
    .map((v) => ({
      stockType: v.stockType,
      unit: v.unit,
      balance: v.balance,
      threshold: v.threshold,
      alertLevel: v.alertLevel,
    }));

  // Strip financial fields (pricing and revenue data) for non-manager roles.
  // Employees and operational staff handle physical inventory but must not
  // see per-unit sale rates, estimated stock value, or revenue trends.
  const showFinancials = canViewAll(actor.role);

  const safeValuation = stockValuation.map((v) => ({
    ...v,
    lastSaleRate: showFinancials ? v.lastSaleRate : undefined,
    estimatedValue: showFinancials ? v.estimatedValue : undefined,
  }));

  logOperationalAccess({
    req,
    resourceType: "inventory_analytics",
    action: "analytics",
    projectId: projectId ?? null,
  });

  return res.json({
    stockValuation: safeValuation,
    monthlyTrends,
    salesTrends: showFinancials ? salesTrends : undefined,
    batchSummary: {
      totalBatches,
      openBatches: batchCounts.open ?? 0,
      closedBatches: batchCounts.closed ?? 0,
      voidedBatches: batchCounts.voided ?? 0,
      recentBatches,
    },
    lowStockAlerts,
  });
});

export default router;

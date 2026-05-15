/**
 * multi_store.ts — Multi-Store Inventory & Stock Transfer API
 *
 * Endpoints:
 *   Stores:            GET/POST /stores · GET/PATCH /stores/:id · PATCH /stores/:id/toggle-active
 *   Locations:         GET/POST /inventory-locations · PATCH /inventory-locations/:id
 *   Transfers:         GET/POST /stock-transfers · GET/PATCH /stock-transfers/:id/[approve|complete|cancel]
 *   Dispatch Memos:    GET/POST /dispatch-memos · GET/PATCH /dispatch-memos/:id/[dispatch|cancel]
 *   Dashboard:         GET /dashboard/:projectId
 *
 * Stock transfers change ONLY physical location — never ownership, LCA, or financial rights.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  storesTable,
  inventoryLocationsTable,
  stockTransfersTable,
  stockMovementAuditTable,
  dispatchMemosTable,
  projectsTable,
  usersTable,
  inventoryStockMovementsTable,
} from "@workspace/db";
import { requireRole, canAccessProject } from "../middlewares/auth";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return { id: undefined as string | undefined, name: undefined as string | undefined };
  const [u] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return { id: u?.id, name: u?.displayName ?? undefined };
}

function genTransferCode(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TXF-${d}-${r}`;
}

function genMemoCode(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DMO-${d}-${r}`;
}

function fnum(v: string | null | undefined): number {
  return parseFloat(v ?? "0") || 0;
}

// Compute per-project ownership totals from existing inventory movements ledger
async function computeOwnership(projectId: string) {
  const rows = await pool.query<{
    stock_type: string;
    total_in: string;
    total_out: string;
    net: string;
  }>(`
    SELECT
      stock_type,
      COALESCE(SUM(quantity) FILTER (WHERE direction = 'in' AND status = 'confirmed' AND is_active), 0) AS total_in,
      COALESCE(SUM(quantity) FILTER (WHERE direction = 'out' AND status = 'confirmed' AND is_active), 0) AS total_out,
      COALESCE(SUM(quantity) FILTER (WHERE direction = 'in' AND status = 'confirmed' AND is_active), 0)
        - COALESCE(SUM(quantity) FILTER (WHERE direction = 'out' AND status = 'confirmed' AND is_active), 0) AS net
    FROM inventory_stock_movements
    WHERE project_id = $1
    GROUP BY stock_type
  `, [projectId]);

  return rows.rows.map((r) => ({
    stockType: r.stock_type,
    totalIn: fnum(r.total_in),
    totalOut: fnum(r.total_out),
    net: fnum(r.net),
  }));
}

// ── STORES ─────────────────────────────────────────────────────────────────

// GET /stores
router.get("/stores", requireRole("admin", "developer", "employee", "operational_staff"), async (req, res) => {
  const { storeType, isActive } = req.query;

  const rows = await pool.query(`
    SELECT s.*,
      u.display_name AS manager_display_name,
      p.name AS linked_project_name
    FROM stores s
    LEFT JOIN users u ON u.id = s.manager_user_id
    LEFT JOIN projects p ON p.id = s.project_id
    ${storeType ? `WHERE s.store_type = $1` : ""}
    ORDER BY s.store_name
  `, storeType ? [storeType] : []);

  let stores = rows.rows;
  if (isActive !== undefined) {
    const active = isActive === "true";
    stores = stores.filter((s: Record<string, unknown>) => s.is_active === active);
  }

  return res.json({ stores });
});

// POST /stores
router.post("/stores", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);

  const {
    storeName, storeCode, storeType, projectId, address,
    capacityKg, managerUserId, managerName, notes,
  } = req.body as Record<string, string | undefined>;

  if (!storeName?.trim()) return res.status(400).json({ error: "storeName is required" });
  if (!storeCode?.trim()) return res.status(400).json({ error: "storeCode is required" });
  if (!storeType || !["project_store", "central_store", "overflow_store"].includes(storeType)) {
    return res.status(400).json({ error: "storeType must be project_store, central_store, or overflow_store" });
  }

  const [existing] = await db
    .select({ id: storesTable.id })
    .from(storesTable)
    .where(eq(storesTable.storeCode, storeCode.trim().toUpperCase()))
    .limit(1);
  if (existing) return res.status(409).json({ error: "Store code already exists" });

  const [store] = await db.insert(storesTable).values({
    storeName: storeName.trim(),
    storeCode: storeCode.trim().toUpperCase(),
    storeType,
    projectId: projectId || null,
    address: address || null,
    capacityKg: capacityKg ? String(parseFloat(capacityKg)) : "0",
    managerUserId: managerUserId || null,
    managerName: managerName || null,
    notes: notes || null,
    createdById: actor.id ?? null,
    createdByName: actor.name ?? "",
  }).returning();

  req.log.info({ storeId: store.id, storeCode: store.storeCode }, "Store created");
  return res.status(201).json({ store });
});

// GET /stores/:id
router.get("/stores/:id", requireRole("admin", "developer", "employee", "operational_staff"), async (req, res) => {
  const [store] = await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.id, req.params.id as string))
    .limit(1);
  if (!store) return res.status(404).json({ error: "Store not found" });

  // Load inventory breakdown for this store
  const locations = await pool.query(`
    SELECT il.*, p.name AS project_name
    FROM inventory_locations il
    LEFT JOIN projects p ON p.id = il.project_id
    WHERE il.store_id = $1 AND il.quantity_kg > 0
    ORDER BY p.name, il.stock_type
  `, [req.params.id]);

  const cap = fnum(store.capacityKg);
  const occ = fnum(store.currentOccupancyKg);
  return res.json({
    store: {
      ...store,
      remainingCapacityKg: cap - occ,
      occupancyPct: cap > 0 ? Math.round((occ / cap) * 100) : null,
    },
    locations: locations.rows,
  });
});

// PATCH /stores/:id
router.patch("/stores/:id", requireRole("admin", "developer"), async (req, res) => {
  const {
    storeName, address, capacityKg,
    managerUserId, managerName, notes, projectId,
  } = req.body as Record<string, string | undefined>;

  const [store] = await db
    .select({ id: storesTable.id })
    .from(storesTable)
    .where(eq(storesTable.id, req.params.id as string))
    .limit(1);
  if (!store) return res.status(404).json({ error: "Store not found" });

  const updates: Partial<typeof storesTable.$inferInsert> = { updatedAt: new Date() };
  if (storeName !== undefined) updates.storeName = storeName;
  if (address !== undefined) updates.address = address || null;
  if (capacityKg !== undefined) updates.capacityKg = String(parseFloat(capacityKg));
  if (managerUserId !== undefined) updates.managerUserId = managerUserId || null;
  if (managerName !== undefined) updates.managerName = managerName || null;
  if (notes !== undefined) updates.notes = notes || null;
  if (projectId !== undefined) updates.projectId = projectId || null;

  const [updated] = await db
    .update(storesTable)
    .set(updates)
    .where(eq(storesTable.id, req.params.id as string))
    .returning();

  return res.json({ store: updated });
});

// PATCH /stores/:id/toggle-active
router.patch("/stores/:id/toggle-active", requireRole("admin"), async (req, res) => {
  const [store] = await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.id, req.params.id as string))
    .limit(1);
  if (!store) return res.status(404).json({ error: "Store not found" });

  const [updated] = await db
    .update(storesTable)
    .set({ isActive: !store.isActive, updatedAt: new Date() })
    .where(eq(storesTable.id, req.params.id as string))
    .returning();

  return res.json({ store: updated });
});

// ── INVENTORY LOCATIONS ────────────────────────────────────────────────────

// GET /inventory-locations
router.get("/inventory-locations", requireRole("admin", "developer", "employee", "operational_staff"), async (req, res) => {
  const { projectId, storeId } = req.query;

  if (projectId && !canAccessProject(req, projectId as string)) {
    return res.status(403).json({ error: "Access denied to this project" });
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (projectId) { params.push(projectId); conditions.push(`il.project_id = $${params.length}`); }
  if (storeId) { params.push(storeId); conditions.push(`il.store_id = $${params.length}`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await pool.query(`
    SELECT il.*,
      p.name AS project_name,
      s.store_name,
      s.store_type,
      s.store_code
    FROM inventory_locations il
    JOIN projects p ON p.id = il.project_id
    JOIN stores s ON s.id = il.store_id
    ${where}
    ORDER BY p.name, s.store_name, il.stock_type
  `, params);

  return res.json({ locations: rows.rows });
});

// POST /inventory-locations — Record a new store entry (places stock in a store)
router.post("/inventory-locations", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);

  const { projectId, storeId, stockType, quantityKg, zone, rack, remarks } =
    req.body as Record<string, string | undefined>;

  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  if (!storeId) return res.status(400).json({ error: "storeId is required" });
  if (!stockType) return res.status(400).json({ error: "stockType is required" });
  const qty = parseFloat(quantityKg ?? "0");
  if (!(qty > 0)) return res.status(400).json({ error: "quantityKg must be positive" });

  if (!canAccessProject(req, projectId)) {
    return res.status(403).json({ error: "Access denied to this project" });
  }

  // Check project not closed
  const [project] = await db
    .select({ lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.lifecycleStatus === "closed") {
    return res.status(400).json({ error: "Cannot place stock in stores for a closed project" });
  }

  const [store] = await db
    .select()
    .from(storesTable)
    .where(eq(storesTable.id, storeId))
    .limit(1);
  if (!store) return res.status(404).json({ error: "Store not found" });
  if (!store.isActive) return res.status(400).json({ error: "Store is inactive" });

  // Check capacity
  const cap = fnum(store.capacityKg);
  const occ = fnum(store.currentOccupancyKg);
  if (cap > 0 && occ + qty > cap) {
    return res.status(400).json({
      error: `Store capacity exceeded. Remaining: ${(cap - occ).toFixed(3)} kg, requested: ${qty.toFixed(3)} kg`,
    });
  }

  // Upsert the location row
  const [existing] = await db
    .select()
    .from(inventoryLocationsTable)
    .where(
      and(
        eq(inventoryLocationsTable.projectId, projectId),
        eq(inventoryLocationsTable.storeId, storeId),
        eq(inventoryLocationsTable.stockType, stockType),
      ),
    )
    .limit(1);

  let location;
  if (existing) {
    [location] = await db
      .update(inventoryLocationsTable)
      .set({
        quantityKg: sql`${inventoryLocationsTable.quantityKg} + ${qty}`,
        zone: zone || existing.zone,
        rack: rack || existing.rack,
        remarks: remarks || existing.remarks,
        updatedAt: new Date(),
      })
      .where(eq(inventoryLocationsTable.id, existing.id))
      .returning();
  } else {
    [location] = await db
      .insert(inventoryLocationsTable)
      .values({
        projectId,
        storeId,
        stockType,
        quantityKg: String(qty),
        zone: zone || null,
        rack: rack || null,
        remarks: remarks || null,
      })
      .returning();
  }

  // Update store occupancy
  await db
    .update(storesTable)
    .set({ currentOccupancyKg: sql`${storesTable.currentOccupancyKg} + ${qty}`, updatedAt: new Date() })
    .where(eq(storesTable.id, storeId));

  // Audit
  await db.insert(stockMovementAuditTable).values({
    projectId,
    actionType: "store_entry",
    destinationStoreId: storeId,
    destinationStoreName: store.storeName,
    stockType,
    quantityKg: String(qty),
    referenceType: "store_entry",
    performedById: actor.id ?? null,
    performedByName: actor.name ?? "",
    remarks: remarks || `Store entry: ${qty} kg ${stockType} placed in ${store.storeName}`,
  });

  return res.status(201).json({ location });
});

// PATCH /inventory-locations/:id — Update zone/rack/remarks only
router.patch("/inventory-locations/:id", requireRole("admin", "developer"), async (req, res) => {
  const { zone, rack, remarks } = req.body as Record<string, string | undefined>;

  const [loc] = await db
    .select()
    .from(inventoryLocationsTable)
    .where(eq(inventoryLocationsTable.id, req.params.id as string))
    .limit(1);
  if (!loc) return res.status(404).json({ error: "Location not found" });

  const [updated] = await db
    .update(inventoryLocationsTable)
    .set({
      zone: zone !== undefined ? zone || null : loc.zone,
      rack: rack !== undefined ? rack || null : loc.rack,
      remarks: remarks !== undefined ? remarks || null : loc.remarks,
      updatedAt: new Date(),
    })
    .where(eq(inventoryLocationsTable.id, req.params.id as string))
    .returning();

  return res.json({ location: updated });
});

// ── STOCK TRANSFERS ────────────────────────────────────────────────────────

// GET /stock-transfers
router.get("/stock-transfers", requireRole("admin", "developer", "employee", "operational_staff"), async (req, res) => {
  const { projectId, status } = req.query;

  if (projectId && !canAccessProject(req, projectId as string)) {
    return res.status(403).json({ error: "Access denied to this project" });
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (projectId) { params.push(projectId); conditions.push(`st.project_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`st.transfer_status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await pool.query(`
    SELECT st.*,
      p.name AS project_name,
      fs.store_name AS from_store_name, fs.store_code AS from_store_code,
      ts.store_name AS to_store_name, ts.store_code AS to_store_code
    FROM stock_transfers st
    JOIN projects p ON p.id = st.project_id
    JOIN stores fs ON fs.id = st.from_store_id
    JOIN stores ts ON ts.id = st.to_store_id
    ${where}
    ORDER BY st.created_at DESC
    LIMIT 200
  `, params);

  return res.json({ transfers: rows.rows });
});

// POST /stock-transfers — Initiate a transfer
router.post("/stock-transfers", requireRole("admin", "developer", "employee"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);

  const {
    projectId, fromStoreId, toStoreId, stockType, quantityKg,
    transferReason, reasonNotes, fromZone, fromRack, toZone, toRack, notes,
  } = req.body as Record<string, string | undefined>;

  if (!projectId || !fromStoreId || !toStoreId || !stockType || !quantityKg || !transferReason) {
    return res.status(400).json({ error: "projectId, fromStoreId, toStoreId, stockType, quantityKg, transferReason are required" });
  }

  const REASONS = ["store_full", "space_optimization", "overflow_movement", "drying_requirement", "other"];
  if (!REASONS.includes(transferReason)) {
    return res.status(400).json({ error: `transferReason must be one of: ${REASONS.join(", ")}` });
  }

  const qty = parseFloat(quantityKg);
  if (!(qty > 0)) return res.status(400).json({ error: "quantityKg must be positive" });
  if (fromStoreId === toStoreId) return res.status(400).json({ error: "From and to stores must be different" });

  if (!canAccessProject(req, projectId)) {
    return res.status(403).json({ error: "Access denied to this project" });
  }

  // Check project lifecycle
  const [project] = await db
    .select({ lifecycleStatus: projectsTable.lifecycleStatus, name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.lifecycleStatus === "closed") {
    return res.status(400).json({ error: "Transfers are not permitted for closed projects" });
  }

  // Validate stores
  const [fromStore] = await db.select().from(storesTable).where(eq(storesTable.id, fromStoreId)).limit(1);
  const [toStore] = await db.select().from(storesTable).where(eq(storesTable.id, toStoreId)).limit(1);
  if (!fromStore) return res.status(400).json({ error: "Source store not found" });
  if (!toStore) return res.status(400).json({ error: "Destination store not found" });
  if (!fromStore.isActive) return res.status(400).json({ error: "Source store is inactive" });
  if (!toStore.isActive) return res.status(400).json({ error: "Destination store is inactive" });

  // Check available stock in source location
  const [fromLoc] = await db
    .select()
    .from(inventoryLocationsTable)
    .where(
      and(
        eq(inventoryLocationsTable.projectId, projectId),
        eq(inventoryLocationsTable.storeId, fromStoreId),
        eq(inventoryLocationsTable.stockType, stockType),
      ),
    )
    .limit(1);

  const available = fnum(fromLoc?.quantityKg);
  if (available < qty) {
    return res.status(400).json({
      error: `Insufficient stock in source store. Available: ${available.toFixed(3)} kg, requested: ${qty.toFixed(3)} kg`,
    });
  }

  // Check destination capacity
  const toCap = fnum(toStore.capacityKg);
  const toOcc = fnum(toStore.currentOccupancyKg);
  const toRemaining = toCap - toOcc;
  if (toCap > 0 && toRemaining < qty) {
    return res.status(400).json({
      error: `Destination store capacity insufficient. Available: ${toRemaining.toFixed(3)} kg, required: ${qty.toFixed(3)} kg`,
    });
  }

  // Generate unique transfer code
  let transferCode = genTransferCode();
  let attempt = 0;
  while (attempt < 5) {
    const [clash] = await db
      .select({ id: stockTransfersTable.id })
      .from(stockTransfersTable)
      .where(eq(stockTransfersTable.transferCode, transferCode))
      .limit(1);
    if (!clash) break;
    transferCode = genTransferCode();
    attempt++;
  }

  const [transfer] = await db
    .insert(stockTransfersTable)
    .values({
      transferCode,
      projectId,
      fromStoreId,
      toStoreId,
      stockType,
      quantityKg: String(qty),
      transferReason,
      reasonNotes: reasonNotes || null,
      fromZone: fromZone || null,
      fromRack: fromRack || null,
      toZone: toZone || null,
      toRack: toRack || null,
      initiatedById: actor.id ?? null,
      initiatedByName: actor.name ?? "",
      notes: notes || null,
    })
    .returning();

  req.log.info({ transferCode, projectId, qty, fromStoreId, toStoreId }, "Stock transfer initiated");
  return res.status(201).json({ transfer });
});

// GET /stock-transfers/:id
router.get("/stock-transfers/:id", requireRole("admin", "developer", "employee", "operational_staff"), async (req, res) => {
  const rows = await pool.query(`
    SELECT st.*,
      p.name AS project_name,
      fs.store_name AS from_store_name, fs.store_code AS from_store_code, fs.store_type AS from_store_type,
      ts.store_name AS to_store_name, ts.store_code AS to_store_code, ts.store_type AS to_store_type
    FROM stock_transfers st
    JOIN projects p ON p.id = st.project_id
    JOIN stores fs ON fs.id = st.from_store_id
    JOIN stores ts ON ts.id = st.to_store_id
    WHERE st.id = $1
  `, [req.params.id]);

  if (!rows.rows.length) return res.status(404).json({ error: "Transfer not found" });
  return res.json({ transfer: rows.rows[0] });
});

// PATCH /stock-transfers/:id/approve
router.patch("/stock-transfers/:id/approve", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);

  const [transfer] = await db
    .select()
    .from(stockTransfersTable)
    .where(eq(stockTransfersTable.id, req.params.id as string))
    .limit(1);

  if (!transfer) return res.status(404).json({ error: "Transfer not found" });
  if (transfer.transferStatus !== "pending") {
    return res.status(400).json({ error: `Cannot approve transfer in status '${transfer.transferStatus}'` });
  }

  const [updated] = await db
    .update(stockTransfersTable)
    .set({
      transferStatus: "approved",
      approvedById: actor.id ?? null,
      approvedByName: actor.name ?? null,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(stockTransfersTable.id, req.params.id as string))
    .returning();

  req.log.info({ transferCode: transfer.transferCode }, "Stock transfer approved");
  return res.json({ transfer: updated });
});

// PATCH /stock-transfers/:id/complete — Execute the physical movement
router.patch("/stock-transfers/:id/complete", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);

  const [transfer] = await db
    .select()
    .from(stockTransfersTable)
    .where(eq(stockTransfersTable.id, req.params.id as string))
    .limit(1);

  if (!transfer) return res.status(404).json({ error: "Transfer not found" });
  if (!["pending", "approved"].includes(transfer.transferStatus)) {
    return res.status(400).json({ error: `Cannot complete transfer in status '${transfer.transferStatus}'` });
  }

  const [fromStore] = await db.select().from(storesTable).where(eq(storesTable.id, transfer.fromStoreId)).limit(1);
  const [toStore] = await db.select().from(storesTable).where(eq(storesTable.id, transfer.toStoreId)).limit(1);
  if (!fromStore || !toStore) return res.status(400).json({ error: "Store(s) not found" });

  const qty = fnum(transfer.quantityKg);

  // Re-validate source inventory
  const [fromLoc] = await db
    .select()
    .from(inventoryLocationsTable)
    .where(
      and(
        eq(inventoryLocationsTable.projectId, transfer.projectId),
        eq(inventoryLocationsTable.storeId, transfer.fromStoreId),
        eq(inventoryLocationsTable.stockType, transfer.stockType),
      ),
    )
    .limit(1);

  if (fnum(fromLoc?.quantityKg) < qty) {
    return res.status(400).json({
      error: `Insufficient stock in source store. Available: ${fnum(fromLoc?.quantityKg).toFixed(3)} kg`,
    });
  }

  // Re-validate destination capacity
  const toCap = fnum(toStore.capacityKg);
  const toOcc = fnum(toStore.currentOccupancyKg);
  if (toCap > 0 && toOcc + qty > toCap) {
    return res.status(400).json({
      error: `Destination store capacity exceeded. Available: ${(toCap - toOcc).toFixed(3)} kg`,
    });
  }

  // Execute atomically
  try {
    await db.transaction(async (tx) => {
      // 1. Deduct from source location
      await tx
        .update(inventoryLocationsTable)
        .set({
          quantityKg: sql`${inventoryLocationsTable.quantityKg} - ${qty}`,
          updatedAt: new Date(),
        })
        .where(eq(inventoryLocationsTable.id, fromLoc!.id));

      // 2. Add to / create destination location
      const [toLoc] = await tx
        .select()
        .from(inventoryLocationsTable)
        .where(
          and(
            eq(inventoryLocationsTable.projectId, transfer.projectId),
            eq(inventoryLocationsTable.storeId, transfer.toStoreId),
            eq(inventoryLocationsTable.stockType, transfer.stockType),
          ),
        )
        .limit(1);

      if (toLoc) {
        await tx
          .update(inventoryLocationsTable)
          .set({
            quantityKg: sql`${inventoryLocationsTable.quantityKg} + ${qty}`,
            zone: transfer.toZone ?? toLoc.zone,
            rack: transfer.toRack ?? toLoc.rack,
            updatedAt: new Date(),
          })
          .where(eq(inventoryLocationsTable.id, toLoc.id));
      } else {
        await tx.insert(inventoryLocationsTable).values({
          projectId: transfer.projectId,
          storeId: transfer.toStoreId,
          stockType: transfer.stockType,
          quantityKg: String(qty),
          zone: transfer.toZone ?? null,
          rack: transfer.toRack ?? null,
        });
      }

      // 3. Update store occupancies
      await tx
        .update(storesTable)
        .set({ currentOccupancyKg: sql`${storesTable.currentOccupancyKg} - ${qty}`, updatedAt: new Date() })
        .where(eq(storesTable.id, transfer.fromStoreId));
      await tx
        .update(storesTable)
        .set({ currentOccupancyKg: sql`${storesTable.currentOccupancyKg} + ${qty}`, updatedAt: new Date() })
        .where(eq(storesTable.id, transfer.toStoreId));

      // 4. Mark completed
      await tx
        .update(stockTransfersTable)
        .set({
          transferStatus: "completed",
          approvedById: transfer.approvedById ?? actor.id ?? null,
          approvedByName: transfer.approvedByName ?? actor.name ?? null,
          approvedAt: transfer.approvedAt ?? new Date(),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stockTransfersTable.id, req.params.id as string));

      // 5. Write-once audit
      await tx.insert(stockMovementAuditTable).values({
        projectId: transfer.projectId,
        actionType: "transfer",
        sourceStoreId: transfer.fromStoreId,
        sourceStoreName: fromStore.storeName,
        destinationStoreId: transfer.toStoreId,
        destinationStoreName: toStore.storeName,
        stockType: transfer.stockType,
        quantityKg: String(qty),
        referenceId: transfer.transferCode,
        referenceType: "transfer",
        performedById: actor.id ?? null,
        performedByName: actor.name ?? "",
        remarks: `Transfer ${transfer.transferCode} completed — ${qty} kg ${transfer.stockType}`,
      });
    });

    const [completed] = await db
      .select()
      .from(stockTransfersTable)
      .where(eq(stockTransfersTable.id, req.params.id as string))
      .limit(1);

    req.log.info({ transferCode: transfer.transferCode, qty }, "Stock transfer completed");
    return res.json({ transfer: completed });
  } catch (err) {
    req.log.error({ err, transferCode: transfer.transferCode }, "Stock transfer completion failed");
    return res.status(500).json({ error: "Transfer completion failed" });
  }
});

// PATCH /stock-transfers/:id/cancel
router.patch("/stock-transfers/:id/cancel", requireRole("admin", "developer"), async (req, res) => {
  const { cancelledReason } = req.body as { cancelledReason?: string };

  const [transfer] = await db
    .select()
    .from(stockTransfersTable)
    .where(eq(stockTransfersTable.id, req.params.id as string))
    .limit(1);

  if (!transfer) return res.status(404).json({ error: "Transfer not found" });
  if (transfer.transferStatus === "completed") {
    return res.status(400).json({ error: "Completed transfers cannot be cancelled" });
  }
  if (transfer.transferStatus === "cancelled") {
    return res.status(400).json({ error: "Transfer already cancelled" });
  }

  const [updated] = await db
    .update(stockTransfersTable)
    .set({
      transferStatus: "cancelled",
      cancelledAt: new Date(),
      cancelledReason: cancelledReason || null,
      updatedAt: new Date(),
    })
    .where(eq(stockTransfersTable.id, req.params.id as string))
    .returning();

  req.log.info({ transferCode: transfer.transferCode }, "Stock transfer cancelled");
  return res.json({ transfer: updated });
});

// ── DISPATCH MEMOS ─────────────────────────────────────────────────────────

// GET /dispatch-memos
router.get("/dispatch-memos", requireRole("admin", "developer", "employee", "operational_staff"), async (req, res) => {
  const { projectId, status } = req.query;

  if (projectId && !canAccessProject(req, projectId as string)) {
    return res.status(403).json({ error: "Access denied to this project" });
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (projectId) { params.push(projectId); conditions.push(`dm.project_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`dm.dispatch_status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await pool.query(`
    SELECT dm.*,
      p.name AS project_name,
      s.store_name, s.store_type
    FROM dispatch_memos dm
    JOIN projects p ON p.id = dm.project_id
    JOIN stores s ON s.id = dm.source_store_id
    ${where}
    ORDER BY dm.issued_at DESC
    LIMIT 200
  `, params);

  return res.json({ memos: rows.rows });
});

// POST /dispatch-memos
router.post("/dispatch-memos", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);

  const {
    projectId, buyerId, buyerName, salesTransactionId,
    sourceStoreId, stockType, totalOrderedKg, zone, rack, notes,
  } = req.body as Record<string, string | undefined>;

  if (!projectId || !buyerName || !sourceStoreId || !stockType || !totalOrderedKg) {
    return res.status(400).json({ error: "projectId, buyerName, sourceStoreId, stockType, totalOrderedKg are required" });
  }

  const qty = parseFloat(totalOrderedKg);
  if (!(qty > 0)) return res.status(400).json({ error: "totalOrderedKg must be positive" });

  if (!canAccessProject(req, projectId)) {
    return res.status(403).json({ error: "Access denied to this project" });
  }

  const [project] = await db
    .select({ lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (project.lifecycleStatus === "closed") {
    return res.status(400).json({ error: "Dispatch not permitted for closed projects" });
  }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, sourceStoreId)).limit(1);
  if (!store) return res.status(404).json({ error: "Source store not found" });
  if (!store.isActive) return res.status(400).json({ error: "Source store is inactive" });

  // Check available stock in source store for this project
  const [loc] = await db
    .select()
    .from(inventoryLocationsTable)
    .where(
      and(
        eq(inventoryLocationsTable.projectId, projectId),
        eq(inventoryLocationsTable.storeId, sourceStoreId),
        eq(inventoryLocationsTable.stockType, stockType),
      ),
    )
    .limit(1);

  if (fnum(loc?.quantityKg) < qty) {
    return res.status(400).json({
      error: `Insufficient stock in source store. Available: ${fnum(loc?.quantityKg).toFixed(3)} kg`,
    });
  }

  // Generate memo code
  let memoCode = genMemoCode();
  for (let i = 0; i < 5; i++) {
    const [clash] = await db
      .select({ id: dispatchMemosTable.id })
      .from(dispatchMemosTable)
      .where(eq(dispatchMemosTable.memoCode, memoCode))
      .limit(1);
    if (!clash) break;
    memoCode = genMemoCode();
  }

  const [memo] = await db.insert(dispatchMemosTable).values({
    memoCode,
    projectId,
    buyerId: buyerId || null,
    buyerName,
    salesTransactionId: salesTransactionId || null,
    sourceStoreId,
    sourceStoreName: store.storeName,
    stockType,
    zone: zone || null,
    rack: rack || null,
    totalOrderedKg: String(qty),
    remainingKg: String(qty),
    issuedById: actor.id ?? null,
    issuedByName: actor.name ?? "",
    notes: notes || null,
  }).returning();

  // Audit
  await db.insert(stockMovementAuditTable).values({
    projectId,
    actionType: "reservation",
    sourceStoreId,
    sourceStoreName: store.storeName,
    stockType,
    quantityKg: String(qty),
    referenceId: memoCode,
    referenceType: "dispatch_memo",
    performedById: actor.id ?? null,
    performedByName: actor.name ?? "",
    remarks: `Dispatch memo ${memoCode} created for ${buyerName}`,
  });

  req.log.info({ memoCode, projectId, qty }, "Dispatch memo created");
  return res.status(201).json({ memo });
});

// GET /dispatch-memos/:id
router.get("/dispatch-memos/:id", requireRole("admin", "developer", "employee", "operational_staff"), async (req, res) => {
  const rows = await pool.query(`
    SELECT dm.*,
      p.name AS project_name,
      s.store_name, s.store_code, s.store_type, s.address
    FROM dispatch_memos dm
    JOIN projects p ON p.id = dm.project_id
    JOIN stores s ON s.id = dm.source_store_id
    WHERE dm.id = $1
  `, [req.params.id]);
  if (!rows.rows.length) return res.status(404).json({ error: "Dispatch memo not found" });
  return res.json({ memo: rows.rows[0] });
});

// PATCH /dispatch-memos/:id/dispatch — Record a partial or full pickup
router.patch("/dispatch-memos/:id/dispatch", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  const actor = await resolveActor(clerkUserId);
  const { dispatchedKg, remarks } = req.body as { dispatchedKg?: string; remarks?: string };

  const qty = parseFloat(dispatchedKg ?? "0");
  if (!(qty > 0)) return res.status(400).json({ error: "dispatchedKg must be positive" });

  const [memo] = await db
    .select()
    .from(dispatchMemosTable)
    .where(eq(dispatchMemosTable.id, req.params.id as string))
    .limit(1);

  if (!memo) return res.status(404).json({ error: "Dispatch memo not found" });
  if (memo.dispatchStatus === "dispatched") {
    return res.status(400).json({ error: "Memo already fully dispatched" });
  }
  if (memo.dispatchStatus === "cancelled") {
    return res.status(400).json({ error: "Cannot dispatch a cancelled memo" });
  }

  const remaining = fnum(memo.remainingKg);
  if (qty > remaining) {
    return res.status(400).json({
      error: `Dispatch quantity ${qty.toFixed(3)} kg exceeds remaining ${remaining.toFixed(3)} kg`,
    });
  }

  const newDispatched = fnum(memo.totalDispatchedKg) + qty;
  const newRemaining = fnum(memo.totalOrderedKg) - newDispatched;
  const newStatus = newRemaining <= 0 ? "dispatched" : "partially_dispatched";

  await db.transaction(async (tx) => {
    await tx
      .update(dispatchMemosTable)
      .set({
        totalDispatchedKg: String(newDispatched),
        remainingKg: String(Math.max(0, newRemaining)),
        dispatchStatus: newStatus,
        completedAt: newStatus === "dispatched" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(dispatchMemosTable.id, req.params.id as string));

    // Reduce physical inventory in source store
    await tx
      .update(inventoryLocationsTable)
      .set({
        quantityKg: sql`${inventoryLocationsTable.quantityKg} - ${qty}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryLocationsTable.projectId, memo.projectId),
          eq(inventoryLocationsTable.storeId, memo.sourceStoreId),
          eq(inventoryLocationsTable.stockType, memo.stockType),
        ),
      );

    await tx
      .update(storesTable)
      .set({ currentOccupancyKg: sql`${storesTable.currentOccupancyKg} - ${qty}`, updatedAt: new Date() })
      .where(eq(storesTable.id, memo.sourceStoreId));

    await tx.insert(stockMovementAuditTable).values({
      projectId: memo.projectId,
      actionType: "dispatch",
      sourceStoreId: memo.sourceStoreId,
      sourceStoreName: memo.sourceStoreName,
      stockType: memo.stockType,
      quantityKg: String(qty),
      referenceId: memo.memoCode,
      referenceType: "dispatch_memo",
      performedById: actor.id ?? null,
      performedByName: actor.name ?? "",
      remarks: remarks || `Dispatch ${qty} kg for ${memo.buyerName} via memo ${memo.memoCode}`,
    });
  });

  const [updated] = await db
    .select()
    .from(dispatchMemosTable)
    .where(eq(dispatchMemosTable.id, req.params.id as string))
    .limit(1);

  req.log.info({ memoCode: memo.memoCode, qty, newStatus }, "Dispatch recorded");
  return res.json({ memo: updated });
});

// PATCH /dispatch-memos/:id/cancel
router.patch("/dispatch-memos/:id/cancel", requireRole("admin", "developer"), async (req, res) => {
  const [memo] = await db
    .select()
    .from(dispatchMemosTable)
    .where(eq(dispatchMemosTable.id, req.params.id as string))
    .limit(1);

  if (!memo) return res.status(404).json({ error: "Dispatch memo not found" });
  if (memo.dispatchStatus === "dispatched") {
    return res.status(400).json({ error: "Cannot cancel a fully dispatched memo" });
  }
  if (memo.dispatchStatus === "cancelled") {
    return res.status(400).json({ error: "Memo already cancelled" });
  }

  const [updated] = await db
    .update(dispatchMemosTable)
    .set({ dispatchStatus: "cancelled", updatedAt: new Date() })
    .where(eq(dispatchMemosTable.id, req.params.id as string))
    .returning();

  return res.json({ memo: updated });
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────

// GET /dashboard/:projectId — Full project inventory dashboard
router.get("/dashboard/:projectId", requireRole("admin", "developer", "employee", "operational_staff", "landowner", "investor"), async (req, res) => {
  const projectId = req.params.projectId as string;

  if (!canAccessProject(req, projectId)) {
    return res.status(403).json({ error: "Access denied to this project" });
  }

  const [project] = await db
    .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });

  // Ownership from existing movements ledger (source of truth)
  const ownership = await computeOwnership(projectId);

  // Physical distribution across stores
  const physicalRows = await pool.query(`
    SELECT il.*,
      s.store_name, s.store_type, s.store_code, s.address
    FROM inventory_locations il
    JOIN stores s ON s.id = il.store_id
    WHERE il.project_id = $1 AND il.quantity_kg > 0
    ORDER BY s.store_name, il.stock_type
  `, [projectId]);

  // Pending transfers
  const pendingTransfers = await pool.query(`
    SELECT st.*,
      fs.store_name AS from_store_name, fs.store_code AS from_store_code,
      ts.store_name AS to_store_name, ts.store_code AS to_store_code
    FROM stock_transfers st
    JOIN stores fs ON fs.id = st.from_store_id
    JOIN stores ts ON ts.id = st.to_store_id
    WHERE st.project_id = $1 AND st.transfer_status IN ('pending', 'approved')
    ORDER BY st.created_at DESC
  `, [projectId]);

  // Active dispatch memos
  const activeMemos = await pool.query(`
    SELECT dm.*, s.store_name
    FROM dispatch_memos dm
    JOIN stores s ON s.id = dm.source_store_id
    WHERE dm.project_id = $1 AND dm.dispatch_status IN ('pending', 'partially_dispatched')
    ORDER BY dm.issued_at DESC
  `, [projectId]);

  // Reconciliation: sum of physical vs computed ownership
  const physicalByStockType: Record<string, number> = {};
  for (const row of physicalRows.rows as Array<Record<string, unknown>>) {
    const st = row.stock_type as string;
    physicalByStockType[st] = (physicalByStockType[st] ?? 0) + fnum(row.quantity_kg as string);
  }

  const reconciliation = ownership.map((o) => ({
    stockType: o.stockType,
    ownedKg: o.net,
    physicalKg: physicalByStockType[o.stockType] ?? 0,
    discrepancyKg: o.net - (physicalByStockType[o.stockType] ?? 0),
    reconciled: Math.abs(o.net - (physicalByStockType[o.stockType] ?? 0)) < 0.001,
  }));

  return res.json({
    project,
    ownership,
    physicalDistribution: physicalRows.rows,
    pendingTransfers: pendingTransfers.rows,
    activeMemos: activeMemos.rows,
    reconciliation,
  });
});

// GET /audit — Stock movement audit trail
router.get("/audit", requireRole("admin", "developer"), async (req, res) => {
  const { projectId, actionType } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (projectId) {
    if (!canAccessProject(req, projectId as string)) {
      return res.status(403).json({ error: "Access denied to this project" });
    }
    params.push(projectId);
    conditions.push(`sma.project_id = $${params.length}`);
  }
  if (actionType) { params.push(actionType); conditions.push(`sma.action_type = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await pool.query(`
    SELECT sma.*,
      p.name AS project_name,
      ss.store_name AS source_store,
      ds.store_name AS destination_store
    FROM stock_movement_audit sma
    JOIN projects p ON p.id = sma.project_id
    LEFT JOIN stores ss ON ss.id = sma.source_store_id
    LEFT JOIN stores ds ON ds.id = sma.destination_store_id
    ${where}
    ORDER BY sma.created_at DESC
    LIMIT 300
  `, params);

  return res.json({ audit: rows.rows });
});

export default router;

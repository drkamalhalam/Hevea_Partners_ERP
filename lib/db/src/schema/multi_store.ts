/**
 * multi_store.ts — Multi-Store Inventory & Stock Transfer System
 *
 * Three independent layers (never combined):
 *   1. Ownership Ledger  — ownershipLedgerTable (project-level totals)
 *   2. Inventory Ledger  — inventoryLocationsTable (physical store quantities)
 *   3. Physical Location — storesTable + zone/rack tracking
 *
 * Stock transfers change ONLY the physical location — never ownership rights,
 * LCA, or any financial entitlement.
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { buyersTable } from "./buyers";
import { salesTransactionsTable } from "./sales";

// ── Stores ────────────────────────────────────────────────────────────────────

export const storesTable = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeName: text("store_name").notNull(),
  storeCode: text("store_code").notNull().unique(),
  storeType: text("store_type").notNull(), // "project_store" | "central_store" | "overflow_store"
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  address: text("address"),
  capacityKg: numeric("capacity_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  currentOccupancyKg: numeric("current_occupancy_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  managerUserId: uuid("manager_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  managerName: text("manager_name"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdById: uuid("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Inventory Locations — Physical Stock Distribution ─────────────────────────
// Tracks WHERE stock physically exists across stores.
// One row per (project × store × stockType) combination.

export const inventoryLocationsTable = pgTable("inventory_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  storeId: uuid("store_id")
    .notNull()
    .references(() => storesTable.id, { onDelete: "restrict" }),
  stockType: text("stock_type").notNull(), // "rubber_sheet" | "rubber_scrap" | "latex"
  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  zone: text("zone"),
  rack: text("rack"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Ownership Ledger — Independent of Physical Location ───────────────────────
// Project-level ownership totals.
// Physical transfers do NOT affect this table.
// Computed totals live here for fast querying; source of truth is inventoryStockMovements.

export const ownershipLedgerTable = pgTable("ownership_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  stockType: text("stock_type").notNull(),
  totalQuantityKg: numeric("total_quantity_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  reservedQuantityKg: numeric("reserved_quantity_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  soldQuantityKg: numeric("sold_quantity_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  availableQuantityKg: numeric("available_quantity_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Stock Transfers ───────────────────────────────────────────────────────────
// Transfer requests with a simple state machine:
//   pending → approved → completed
//   pending → cancelled
//   approved → cancelled

export const stockTransfersTable = pgTable("stock_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferCode: text("transfer_code").notNull().unique(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  fromStoreId: uuid("from_store_id")
    .notNull()
    .references(() => storesTable.id, { onDelete: "restrict" }),
  toStoreId: uuid("to_store_id")
    .notNull()
    .references(() => storesTable.id, { onDelete: "restrict" }),
  stockType: text("stock_type").notNull(),
  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 }).notNull(),
  transferReason: text("transfer_reason").notNull(),
  // "store_full" | "space_optimization" | "overflow_movement" | "drying_requirement" | "other"
  reasonNotes: text("reason_notes"),
  fromZone: text("from_zone"),
  fromRack: text("from_rack"),
  toZone: text("to_zone"),
  toRack: text("to_rack"),
  initiatedById: uuid("initiated_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  initiatedByName: text("initiated_by_name").notNull().default(""),
  approvedById: uuid("approved_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  transferStatus: text("transfer_status").notNull().default("pending"),
  // "pending" | "approved" | "completed" | "cancelled"
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Stock Movement Audit — Write-Once Audit Chain ─────────────────────────────
// Every physical movement creates one immutable row. No UPDATE/DELETE.

export const stockMovementAuditTable = pgTable("stock_movement_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  actionType: text("action_type").notNull(),
  // "store_entry" | "transfer" | "reservation" | "dispatch" | "reservation_release"
  sourceStoreId: uuid("source_store_id").references(() => storesTable.id, {
    onDelete: "set null",
  }),
  sourceStoreName: text("source_store_name"),
  destinationStoreId: uuid("destination_store_id").references(
    () => storesTable.id,
    { onDelete: "set null" },
  ),
  destinationStoreName: text("destination_store_name"),
  stockType: text("stock_type").notNull(),
  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 }).notNull(),
  referenceId: text("reference_id"),
  referenceType: text("reference_type"),
  // "transfer" | "dispatch_memo" | "store_entry" | "reservation"
  performedById: uuid("performed_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  performedByName: text("performed_by_name").notNull().default(""),
  remarks: text("remarks"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Dispatch Memos — Buyer Pickup Memos ───────────────────────────────────────
// Partial dispatch supported: track ordered / dispatched / remaining.

export const dispatchMemosTable = pgTable("dispatch_memos", {
  id: uuid("id").primaryKey().defaultRandom(),
  memoCode: text("memo_code").notNull().unique(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  buyerId: uuid("buyer_id").references(() => buyersTable.id, {
    onDelete: "set null",
  }),
  buyerName: text("buyer_name").notNull(),
  salesTransactionId: uuid("sales_transaction_id").references(
    () => salesTransactionsTable.id,
    { onDelete: "set null" },
  ),
  sourceStoreId: uuid("source_store_id")
    .notNull()
    .references(() => storesTable.id, { onDelete: "restrict" }),
  sourceStoreName: text("source_store_name").notNull(),
  stockType: text("stock_type").notNull(),
  zone: text("zone"),
  rack: text("rack"),
  totalOrderedKg: numeric("total_ordered_kg", { precision: 12, scale: 3 }).notNull(),
  totalDispatchedKg: numeric("total_dispatched_kg", { precision: 12, scale: 3 })
    .notNull()
    .default("0"),
  remainingKg: numeric("remaining_kg", { precision: 12, scale: 3 }).notNull(),
  dispatchStatus: text("dispatch_status").notNull().default("pending"),
  // "pending" | "partially_dispatched" | "dispatched" | "cancelled"
  issuedById: uuid("issued_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  issuedByName: text("issued_by_name").notNull().default(""),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Type exports ──────────────────────────────────────────────────────────────

export type Store = typeof storesTable.$inferSelect;
export type StoreInsert = typeof storesTable.$inferInsert;
export type InventoryLocation = typeof inventoryLocationsTable.$inferSelect;
export type InventoryLocationInsert = typeof inventoryLocationsTable.$inferInsert;
export type OwnershipLedger = typeof ownershipLedgerTable.$inferSelect;
export type StockTransfer = typeof stockTransfersTable.$inferSelect;
export type StockTransferInsert = typeof stockTransfersTable.$inferInsert;
export type StockMovementAudit = typeof stockMovementAuditTable.$inferSelect;
export type DispatchMemo = typeof dispatchMemosTable.$inferSelect;
export type DispatchMemoInsert = typeof dispatchMemosTable.$inferInsert;

import {
  pgTable, uuid, text, numeric, boolean, date, timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { productionBatchesTable } from "./production_log";

/**
 * Audit-friendly inventory ledger.
 * Every stock movement is one immutable row (soft-delete only).
 * Current balance = SUM(in) - SUM(out) for confirmed, active rows.
 *
 * movementType:
 *   opening        → direction: in  (initial opening stock)
 *   production_in  → direction: in  (received from production batch)
 *   purchase_in    → direction: in  (externally purchased/received)
 *   sale_out       → direction: out (sold)
 *   transfer_out   → direction: out (transferred out)
 *   wastage        → direction: out (wastage / spoilage)
 *   adjustment_in  → direction: in  (positive correction — requires confirmation)
 *   adjustment_out → direction: out (negative correction — requires confirmation)
 *
 * status: confirmed (default) | pending (adjustments) | cancelled
 */
export const inventoryStockMovementsTable = pgTable("inventory_stock_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  stockType: text("stock_type").notNull(),       // latex | rubber_sheet | rubber_scrap
  movementType: text("movement_type").notNull(),  // see above
  direction: text("direction").notNull(),         // in | out (denormalized)

  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),                   // litres | kg

  movementDate: date("movement_date").notNull(),

  batchId: uuid("batch_id").references(() => productionBatchesTable.id, {
    onDelete: "set null",
  }),
  referenceId: text("reference_id"),    // external ref: invoice/PO/sale number
  referenceType: text("reference_type"), // production | sale | purchase | transfer

  notes: text("notes"),

  // Workflow status
  status: text("status").notNull().default("confirmed"), // confirmed | pending | cancelled

  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedById: uuid("confirmed_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  confirmedByName: text("confirmed_by_name"),

  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledById: uuid("cancelled_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  cancelledByName: text("cancelled_by_name"),

  createdById: uuid("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name").notNull().default(""),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

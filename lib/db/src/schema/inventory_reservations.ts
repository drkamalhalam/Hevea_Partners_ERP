import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { salesOrdersTable } from "./sales_orders";

/**
 * inventory_reservations — temporary stock holds created when a payment request
 * is initiated.
 *
 * Reserved inventory cannot be sold or transferred until the reservation is
 * released or fulfilled.
 *
 * Status lifecycle:
 *   active    — stock is held, payment pending
 *   released  — payment expired or order cancelled; stock returned to available
 *   fulfilled — payment confirmed; stock permanently moved to sold
 *   expired   — reservation TTL elapsed without payment
 *
 * Available formula:
 *   available = total_store_qty − sum(active reservations) − sold
 */
export const inventoryReservationsTable = pgTable("inventory_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),

  salesOrderId: uuid("sales_order_id")
    .notNull()
    .references(() => salesOrdersTable.id, { onDelete: "cascade" }),
  salesCode: text("sales_code").notNull().default(""),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  storeId: uuid("store_id"),
  storeName: text("store_name"),

  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 }).notNull(),

  status: text("status").notNull().default("active"),
  // active | released | fulfilled | expired

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedById: uuid("released_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  releaseReason: text("release_reason"),

  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

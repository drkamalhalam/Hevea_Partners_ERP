import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { buyersTable } from "./buyers";

/**
 * sales_orders — Payment-workflow sales orders.
 *
 * Separate from salesTransactionsTable (batch revenue recording).
 * This table drives the full payment lifecycle:
 * draft → payment_pending → payment_detected → awaiting_manual_confirmation
 * → confirmed → (partially_dispatched) → completed | cancelled | expired
 *
 * Inventory is NEVER reduced until paymentStatus = confirmed.
 */
export const salesOrdersTable = pgTable("sales_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesCode: text("sales_code").notNull(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  projectName: text("project_name").notNull().default(""),

  buyerId: uuid("buyer_id").references(() => buyersTable.id, {
    onDelete: "set null",
  }),
  buyerName: text("buyer_name").notNull().default(""),

  sellerUserId: uuid("seller_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  sellerName: text("seller_name").notNull().default(""),
  sellerRole: text("seller_role").notNull().default(""),

  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 }).notNull(),
  ratePerKg: numeric("rate_per_kg", { precision: 12, scale: 4 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),

  paymentMode: text("payment_mode").notNull().default("online_only"),
  // online_only | cash_only | both

  paymentReceiverAccountId: uuid("payment_receiver_account_id"),
  paymentReceiverName: text("payment_receiver_name"),

  orderStatus: text("order_status").notNull().default("draft"),
  // draft | payment_pending | payment_detected | awaiting_manual_confirmation
  // | confirmed | partially_dispatched | completed | cancelled | expired

  paymentStatus: text("payment_status").notNull().default("unpaid"),
  // unpaid | pending | detected | confirmed | failed | refunded

  inventoryStatus: text("inventory_status").notNull().default("available"),
  // available | reserved | dispatched | sold

  dispatchStatus: text("dispatch_status").notNull().default("not_dispatched"),
  // not_dispatched | partially_dispatched | fully_dispatched

  quantityDispatchedKg: numeric("quantity_dispatched_kg", {
    precision: 12,
    scale: 3,
  })
    .notNull()
    .default("0"),

  paymentRequestedAt: timestamp("payment_requested_at", {
    withTimezone: true,
  }),
  paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }),
  paymentConfirmedAt: timestamp("payment_confirmed_at", {
    withTimezone: true,
  }),
  paymentConfirmedById: uuid("payment_confirmed_by_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  paymentConfirmedByName: text("payment_confirmed_by_name"),

  invoiceId: uuid("invoice_id"),

  remarks: text("remarks"),
  cancellationReason: text("cancellation_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledById: uuid("cancelled_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

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

/**
 * sales_order_dispatches — one row per physical dispatch event against an order.
 * Multiple rows allowed for partial dispatch support.
 */
export const salesOrderDispatchesTable = pgTable("sales_order_dispatches", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesOrderId: uuid("sales_order_id")
    .notNull()
    .references(() => salesOrdersTable.id, { onDelete: "cascade" }),

  storeId: uuid("store_id"),
  storeName: text("store_name"),

  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 }).notNull(),

  dispatchedById: uuid("dispatched_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  dispatchedByName: text("dispatched_by_name"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * sales_order_audit — append-only log for every status transition and action.
 */
export const salesOrderAuditTable = pgTable("sales_order_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesOrderId: uuid("sales_order_id").references(() => salesOrdersTable.id, {
    onDelete: "set null",
  }),
  salesCode: text("sales_code").notNull().default(""),
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  // created | payment_requested | payment_detected | payment_confirmed
  // | payment_expired | cancelled | dispatched | completed | overridden
  description: text("description").notNull(),
  actorId: uuid("actor_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  actorName: text("actor_name").notNull().default(""),
  actorRole: text("actor_role").notNull().default(""),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

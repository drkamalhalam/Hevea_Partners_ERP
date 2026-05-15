import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { salesOrdersTable } from "./sales_orders";
import { buyersTable } from "./buyers";

/**
 * sales_invoices — finalized invoice generated after payment confirmation.
 *
 * Created exactly once per confirmed sales order.
 * Immutable after generation (write-once for compliance).
 *
 * invoiceNumber: auto-generated sequential code (INV-YYYY-NNNN).
 */
export const salesInvoicesTable = pgTable("sales_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNumber: text("invoice_number").notNull().unique(),

  salesOrderId: uuid("sales_order_id")
    .notNull()
    .references(() => salesOrdersTable.id, { onDelete: "restrict" }),
  salesCode: text("sales_code").notNull().default(""),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  projectName: text("project_name").notNull().default(""),

  buyerId: uuid("buyer_id").references(() => buyersTable.id, {
    onDelete: "set null",
  }),
  buyerName: text("buyer_name").notNull().default(""),
  buyerPhone: text("buyer_phone"),
  buyerAddress: text("buyer_address"),
  buyerGstin: text("buyer_gstin"),

  sellerName: text("seller_name").notNull().default(""),
  sellerRole: text("seller_role").notNull().default(""),

  paymentReceiverName: text("payment_receiver_name"),
  paymentMode: text("payment_mode").notNull().default("online"),
  paymentReference: text("payment_reference"),
  paymentConfirmedAt: timestamp("payment_confirmed_at", {
    withTimezone: true,
  }),

  quantityKg: numeric("quantity_kg", { precision: 12, scale: 3 }).notNull(),
  ratePerKg: numeric("rate_per_kg", { precision: 12, scale: 4 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),

  dispatchStatus: text("dispatch_status").notNull().default("not_dispatched"),
  quantityDispatchedKg: numeric("quantity_dispatched_kg", {
    precision: 12,
    scale: 3,
  })
    .notNull()
    .default("0"),

  isVoided: boolean("is_voided").notNull().default(false),
  voidReason: text("void_reason"),

  generatedById: uuid("generated_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  generatedByName: text("generated_by_name").notNull().default(""),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  invoiceDate: text("invoice_date").notNull(),
  // ISO date string YYYY-MM-DD

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

import { pgTable, uuid, text, boolean, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { buyersTable } from "./buyers";
import { productionBatchesTable } from "./production_log";

// ── Sales Transactions ─────────────────────────────────────────────────────────
// One record per sale event. Can span multiple batches/product types.
// status: draft → accepted entries; confirmed → finalised, inventory updated; cancelled → void.

export const salesTransactionsTable = pgTable("sales_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  buyerId: uuid("buyer_id").references(() => buyersTable.id, { onDelete: "set null" }),
  buyerName: text("buyer_name").notNull(),
  saleNumber: text("sale_number").notNull(),
  saleDate: date("sale_date").notNull(),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  documentRef: text("document_ref"),
  totalGrossRevenue: numeric("total_gross_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 15, scale: 2 }).notNull().default("0"),
  totalNetRevenue: numeric("total_net_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  distributionId: uuid("distribution_id"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedById: uuid("confirmed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  confirmedByName: text("confirmed_by_name"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Sales Line Items ───────────────────────────────────────────────────────────
// One row per product type / batch within a transaction.
// batchId is nullable — allows unlinked (multi-source) line items.

export const salesLineItemsTable = pgTable("sales_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => salesTransactionsTable.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").references(() => productionBatchesTable.id, { onDelete: "set null" }),
  batchNumber: text("batch_number"),
  productType: text("product_type").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  saleRate: numeric("sale_rate", { precision: 12, scale: 4 }),
  grossAmount: numeric("gross_amount", { precision: 15, scale: 2 }),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Sales Deductions ───────────────────────────────────────────────────────────
// Multiple deductions per transaction (transport, commission, tax, etc.)

export const salesDeductionsTable = pgTable("sales_deductions", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => salesTransactionsTable.id, { onDelete: "cascade" }),
  deductionType: text("deduction_type").notNull().default("other"),
  description: text("description"),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

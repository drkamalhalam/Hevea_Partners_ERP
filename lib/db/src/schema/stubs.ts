/**
 * Stub tables for planned future modules.
 *
 * These define the schema skeleton (PKs, FKs, standard audit columns) so that
 * foreign-key relationships, indexes, and data-model decisions are locked in
 * before individual modules are built. Column sets will be expanded when each
 * module is implemented.
 *
 * Modules represented here:
 *   - Contributions   (/contributions)
 *   - Expenditure     (/expenditure)
 *   - Inventory       (/inventory)
 *   - Sales           (/sales)
 *   - Distribution    (/distribution)
 *   - Ownership       (agreement ownership ledger)
 *   - Governance      (/governance)
 */

import {
  pgTable,
  uuid,
  text,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { agreementsTable } from "./agreements";
import { productionRecordsTable } from "./production";

// ── Shared audit column helpers ───────────────────────────────────────────

const auditCols = (users: typeof usersTable) => ({
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

// ── Contributions ─────────────────────────────────────────────────────────
// Capital, labour, equipment, or land contributed by a partner to a project.

export const contributionsTable = pgTable("contributions", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  partnerId: uuid("partner_id").references(() => partnersTable.id, {
    onDelete: "set null",
  }),
  // "cash" | "labour" | "equipment" | "land" | "other"
  type: text("type").notNull().default("cash"),
  amount: real("amount"),
  description: text("description"),
  contributionDate: text("contribution_date"),
  status: text("status").notNull().default("pending"), // pending | verified | rejected
  notes: text("notes"),
  ...auditCols(usersTable),
});

// ── Expenditure ───────────────────────────────────────────────────────────
// Plantation operating and capital expenditure items.

export const expendituresTable = pgTable("expenditures", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  category: text("category").notNull().default("general"),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  expenseDate: text("expense_date").notNull(),
  receiptUrl: text("receipt_url"),
  // pending | approved | rejected
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  ...auditCols(usersTable),
});

// ── Inventory ─────────────────────────────────────────────────────────────
// Consumables, tools, and equipment tracked at the project level.

export const inventoryItemsTable = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  category: text("category").notNull().default("general"),
  quantity: real("quantity").notNull().default(0),
  unit: text("unit").notNull().default("unit"),
  unitCost: real("unit_cost"),
  reorderLevel: real("reorder_level"),
  notes: text("notes"),
  ...auditCols(usersTable),
});

// ── Sales ─────────────────────────────────────────────────────────────────
// Formal rubber sales records (extends / replaces production_records revenue
// tracking once the Sales module is built).

export const salesRecordsTable = pgTable("sales_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  // Optionally linked back to the production batch it came from
  productionRecordId: uuid("production_record_id").references(
    () => productionRecordsTable.id,
    { onDelete: "set null" },
  ),
  buyerName: text("buyer_name"),
  quantityKg: real("quantity_kg").notNull(),
  pricePerKg: real("price_per_kg").notNull(),
  totalAmount: real("total_amount").notNull(),
  saleDate: text("sale_date").notNull(),
  // pending | paid | overdue | cancelled
  paymentStatus: text("payment_status").notNull().default("pending"),
  notes: text("notes"),
  ...auditCols(usersTable),
});

// ── Distribution ──────────────────────────────────────────────────────────
// Revenue / profit distribution events to individual partners.

export const distributionsTable = pgTable("distributions", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  partnerId: uuid("partner_id").references(() => partnersTable.id, {
    onDelete: "set null",
  }),
  // "revenue_share" | "contribution_return" | "dividend" | "bonus"
  type: text("type").notNull().default("revenue_share"),
  amount: real("amount").notNull(),
  distributionDate: text("distribution_date").notNull(),
  // pending | approved | paid | cancelled
  status: text("status").notNull().default("pending"),
  referenceNo: text("reference_no"),
  notes: text("notes"),
  ...auditCols(usersTable),
});

// ── Ownership ─────────────────────────────────────────────────────────────
// Formal ownership ledger — percentage share each partner holds in a project.

export const ownershipsTable = pgTable("ownerships", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),
  // Linked agreement that established this ownership
  agreementId: uuid("agreement_id").references(() => agreementsTable.id, {
    onDelete: "set null",
  }),
  // "land" | "investment" | "development_rights" | "revenue"
  ownershipType: text("ownership_type").notNull().default("land"),
  sharePercentage: real("share_percentage").notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  ...auditCols(usersTable),
});

// ── Governance ────────────────────────────────────────────────────────────
// Meeting minutes, resolutions, policy documents, and decisions.
// projectId is nullable for organisation-level records.

export const governanceRecordsTable = pgTable("governance_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  // null = applies to the whole organisation, not a single project
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  // "meeting" | "resolution" | "decision" | "policy" | "circular"
  recordType: text("record_type").notNull().default("meeting"),
  title: text("title").notNull(),
  description: text("description"),
  // "draft" | "active" | "closed" | "superseded"
  status: text("status").notNull().default("draft"),
  effectiveDate: text("effective_date"),
  documentUrl: text("document_url"),
  notes: text("notes"),
  ...auditCols(usersTable),
});

// ── Exported types ────────────────────────────────────────────────────────

export type Contribution = typeof contributionsTable.$inferSelect;
export type Expenditure = typeof expendituresTable.$inferSelect;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type SalesRecord = typeof salesRecordsTable.$inferSelect;
export type Distribution = typeof distributionsTable.$inferSelect;
export type Ownership = typeof ownershipsTable.$inferSelect;
export type GovernanceRecord = typeof governanceRecordsTable.$inferSelect;

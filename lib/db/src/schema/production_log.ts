import { pgTable, uuid, text, integer, numeric, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// ── Production Batches ────────────────────────────────────────────────────────
// A batch groups one or more typed production entries for a project on a date.
// status: open → accepting entries; closed → finalized; voided → cancelled.

export const productionBatchesTable = pgTable("production_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  batchNumber: text("batch_number").notNull(),
  batchDate: date("batch_date").notNull(),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  entryCount: integer("entry_count").notNull().default(0),
  totalLatexLitres: numeric("total_latex_litres", { precision: 12, scale: 3 }).notNull().default("0"),
  totalSheetKg: numeric("total_sheet_kg", { precision: 12, scale: 3 }).notNull().default("0"),
  totalScrapKg: numeric("total_scrap_kg", { precision: 12, scale: 3 }).notNull().default("0"),
  createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedById: uuid("closed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  closedByName: text("closed_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Production Entries ────────────────────────────────────────────────────────
// Individual production line items within a batch.
// productionType: latex | rubber_sheet | rubber_scrap
// unit: litres (for latex) | kg (for sheets and scrap)

export const productionEntriesTable = pgTable("production_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => productionBatchesTable.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  productionType: text("production_type").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  productionDate: date("production_date").notNull(),
  enteredById: uuid("entered_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  enteredByName: text("entered_by_name").notNull().default(""),
  remarks: text("remarks"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

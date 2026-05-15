import {
  pgTable,
  uuid,
  integer,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * storeEntriesTable
 *
 * Records sheets moved into the store after 3-5 days drying outside.
 * Each row = one store-transfer session by one employee on one day.
 *
 * Design rules:
 *   1. sheetCount must not cause cumulative stored sheets to exceed
 *      cumulative collected sheets (enforced at API layer).
 *   2. weightKg and scrapWeightKg are optional — may not be available
 *      at every entry.
 *   3. Soft-delete only via deletedAt.
 *   4. employeeName denormalised for audit stability.
 *   5. entryDate/entryTime auto-filled by server at creation time.
 */
export const storeEntriesTable = pgTable("store_entries", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  employeeId: uuid("employee_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),

  employeeName: text("employee_name"),

  sheetCount: integer("sheet_count").notNull(),

  weightKg: real("weight_kg"),

  scrapWeightKg: real("scrap_weight_kg"),

  entryDate: text("entry_date").notNull(),
  entryTime: text("entry_time").notNull(),

  remarks: text("remarks"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

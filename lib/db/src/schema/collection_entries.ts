import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * collectionEntriesTable
 *
 * Records daily fresh-sheet collection before drying.
 * Each row = one collection session by one employee on one day.
 *
 * Design rules:
 *   1. sheetCount is a positive integer (raw count of freshly collected sheets).
 *   2. Soft-delete only via deletedAt; hard deletes are prohibited.
 *   3. employeeName is a denormalised snapshot — records stay readable after
 *      user renames.
 *   4. entryDate (YYYY-MM-DD) and entryTime (HH:MM) are captured at creation
 *      time from server clock; employees never set them manually.
 *   5. observerActive is system-set based on ObservationAssignments at the
 *      moment of entry — no employee action required.
 */
export const collectionEntriesTable = pgTable("collection_entries", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  employeeId: uuid("employee_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),

  employeeName: text("employee_name"),

  sheetCount: integer("sheet_count").notNull(),

  entryDate: text("entry_date").notNull(),
  entryTime: text("entry_time").notNull(),

  remarks: text("remarks"),

  observerActive: text("observer_active").default("no"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

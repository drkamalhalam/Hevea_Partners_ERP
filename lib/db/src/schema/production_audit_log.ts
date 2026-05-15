import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * productionAuditLogTable
 *
 * Immutable audit trail for all production & collection module actions.
 * Write-once: no UPDATE or DELETE routes exist for this table.
 *
 * Design rules:
 *   1. One row per action (create, edit, soft-delete).
 *   2. oldValues / newValues are JSONB snapshots for full change history.
 *   3. projectId is denormalised for efficient project-scoped queries.
 */
export const productionAuditLogTable = pgTable("production_audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),

  moduleName: text("module_name").notNull(),

  actionType: text("action_type").notNull(),

  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  userId: uuid("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  oldValues: jsonb("old_values"),

  newValues: jsonb("new_values"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

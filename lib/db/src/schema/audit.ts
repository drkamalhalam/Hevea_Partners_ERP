import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { dbOperationEnum } from "./enums";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * audit_logs — immutable compliance log of every INSERT / UPDATE / DELETE
 * on audited tables. Written at the application layer (not via DB triggers)
 * to keep the implementation portable across environments.
 *
 * This table is append-only. No updates or deletes should ever occur on it.
 *
 * Extended columns (nullable for backward-compat with existing rows):
 *   projectId  — FK to projects (null = platform-level action)
 *   module     — human-readable module name (contributions, expenditures, …)
 *   actionType — human-readable action label (contribution_verified, sale_created, …)
 *   metadata   — arbitrary JSON context (e.g. old status → new status, notes)
 *   userName   — denormalised display name at time of action
 *   userRole   — denormalised role at time of action
 */
export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  tableName: text("table_name").notNull(),
  recordId: uuid("record_id").notNull(),
  operation: dbOperationEnum("operation").notNull(),
  /** Snapshot of the row before the change (null for INSERT) */
  oldData: jsonb("old_data"),
  /** Snapshot of the row after the change (null for DELETE) */
  newData: jsonb("new_data"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  // ── Extended fields ────────────────────────────────────────────────
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  module: text("module"),
  actionType: text("action_type"),
  metadata: jsonb("metadata"),
  userName: text("user_name"),
  userRole: text("user_role"),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;
export type AuditLogInsert = typeof auditLogsTable.$inferInsert;

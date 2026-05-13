import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { dbOperationEnum } from "./enums";
import { usersTable } from "./users";

/**
 * audit_logs — immutable compliance log of every INSERT / UPDATE / DELETE
 * on audited tables. Written at the application layer (not via DB triggers)
 * to keep the implementation portable across environments.
 *
 * This table is append-only. No updates or deletes should ever occur on it.
 */
export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  tableName: text("table_name").notNull(),
  recordId: uuid("record_id").notNull(),
  operation: dbOperationEnum("operation").notNull(),
  // Snapshot of the row before the change (null for INSERT)
  oldData: jsonb("old_data"),
  // Snapshot of the row after the change (null for DELETE)
  newData: jsonb("new_data"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * operational_access_logs — append-only audit trail for every access to
 * production, inventory, and sales records.
 *
 * Written fire-and-forget (non-fatal) by route handlers.
 * Never updated or deleted.
 *
 * resource_type values: production_batch | production_entry | inventory_balance
 *   | inventory_movement | inventory_analytics | sale_transaction | sale_detail
 *   | sale_analytics | sale_summary
 *
 * action values: list | view | analytics | summary | export
 *
 * access_denied: true when the access attempt was rejected (403/401).
 */
export const operationalAccessLogsTable = pgTable("operational_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),

  userId: uuid("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  userName: text("user_name"),
  userRole: text("user_role").notNull(),

  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  projectName: text("project_name"),

  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id"),
  resourceRef: text("resource_ref"),

  action: text("action").notNull(),
  accessDenied: boolean("access_denied").notNull().default(false),

  clientIp: text("client_ip"),
  userAgent: text("user_agent"),

  accessedAt: timestamp("accessed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

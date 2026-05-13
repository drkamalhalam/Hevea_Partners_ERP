import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const financialAccessLogsTable = pgTable("financial_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userRole: text("user_role").notNull().default("unknown"),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  projectId: uuid("project_id"),
  action: text("action").notNull().default("read"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
});

import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { userLoginAuditEventEnum } from "./enums";

/**
 * user_login_audit — write-once audit trail for login account lifecycle events.
 *
 * Records every status transition, person link change, and account type change.
 * No UPDATE or DELETE routes — append-only by design.
 */
export const userLoginAuditTable = pgTable("user_login_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  eventType: userLoginAuditEventEnum("event_type").notNull(),
  performedBy: uuid("performed_by"),
  reason: text("reason"),
  notes: text("notes"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserLoginAuditEvent = typeof userLoginAuditTable.$inferSelect;

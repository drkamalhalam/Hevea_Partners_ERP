import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { workAssignmentAuditEventEnum } from "./enums";

/**
 * work_assignment_audit — write-once lifecycle audit trail for work assignments.
 *
 * Records every status transition, edit, and lifecycle event.
 * No UPDATE or DELETE routes — append-only by design.
 */
export const workAssignmentAuditTable = pgTable("work_assignment_audit", {
  id: uuid("id").defaultRandom().primaryKey(),

  assignmentId: uuid("assignment_id").notNull(),

  eventType: workAssignmentAuditEventEnum("event_type").notNull(),

  performedBy: uuid("performed_by"),
  performedByName: text("performed_by_name"),

  reason: text("reason"),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkAssignmentAuditEvent = typeof workAssignmentAuditTable.$inferSelect;

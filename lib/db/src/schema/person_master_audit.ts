import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";
import { personMasterAuditEventEnum } from "./enums";

/**
 * person_master_audit — write-once immutable audit trail for all
 * changes to person master records.
 *
 * Architecture rule: NO UPDATE or DELETE routes on this table ever.
 * Every mutation to a person_master row must produce a corresponding
 * audit event row here, recording what changed and who changed it.
 *
 * The `metadata` jsonb field stores before/after values for sensitive
 * fields (Aadhaar, mobile, name). Aadhaar values stored in metadata
 * must be masked to last-4 only.
 */
export const personMasterAuditTable = pgTable("person_master_audit", {
  id: uuid("id").defaultRandom().primaryKey(),

  personMasterId: uuid("person_master_id")
    .notNull()
    .references(() => personMasterTable.id, { onDelete: "cascade" }),

  eventType: personMasterAuditEventEnum("event_type").notNull(),

  /** Human-readable description of the change */
  description: text("description"),

  /**
   * Before/after payload for field-level audit.
   * Sensitive values (Aadhaar) must be stored as last-4 only.
   * Example: { before: { mobile: "98765XXXXX" }, after: { mobile: "91234XXXXX" } }
   */
  metadata: jsonb("metadata"),

  /** The user who performed the action. Null = system-automated action. */
  performedBy: uuid("performed_by").references(() => usersTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPersonMasterAuditSchema = createInsertSchema(personMasterAuditTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPersonMasterAudit = z.infer<typeof insertPersonMasterAuditSchema>;
export type PersonMasterAudit = typeof personMasterAuditTable.$inferSelect;

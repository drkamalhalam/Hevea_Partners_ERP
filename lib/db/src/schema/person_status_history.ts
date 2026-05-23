import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";
import { personStatusEnum } from "./enums";

/**
 * person_status_history — write-once log of every status change on a
 * person_master record.
 *
 * Architecture rule: NO UPDATE or DELETE routes on this table ever.
 * Every call to POST /person-master/:id/status must insert a row here,
 * preserving the full transition chain: from → to, who changed it, and why.
 */
export const personStatusHistoryTable = pgTable("person_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),

  personMasterId: uuid("person_master_id")
    .notNull()
    .references(() => personMasterTable.id, { onDelete: "cascade" }),

  /** Status before this change. Null on the first status record (initial creation). */
  fromStatus: personStatusEnum("from_status"),

  /** Status after this change */
  toStatus: personStatusEnum("to_status").notNull(),

  /** The user who triggered the status change. Null = system-automated. */
  changedBy: uuid("changed_by")
    .references(() => usersTable.id, { onDelete: "set null" }),

  /** Denormalized name snapshot for display without joins */
  changedByName: text("changed_by_name"),

  /** Mandatory reason for every status change */
  reason: text("reason").notNull(),

  /** Optional supporting notes */
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PersonStatusHistory = typeof personStatusHistoryTable.$inferSelect;

import { pgTable, uuid, text, numeric, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { usersTable } from "./users";
import { burdenRecordsTable } from "./burden";
import { expendituresTable } from "./expenditures";
import { recoverableAdvanceStatusEnum } from "./enums";

/**
 * Recoverable advance — one row per advance/reimbursement event.
 *
 * Tracks situations where one participant temporarily pays a cost that
 * should be borne by another, with full recovery workflow.
 *
 * IMPORTANT: Advances do NOT create ownership rights. They are purely
 * operational cash-flow events with no effect on equity or land ownership.
 */
export const recoverableAdvancesTable = pgTable("recoverable_advances", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // ── Who actually paid ──────────────────────────────────────────────────────
  advancedByPartnerId: uuid("advanced_by_partner_id").references(
    () => partnersTable.id,
    { onDelete: "set null" },
  ),
  advancedByName: text("advanced_by_name").notNull(),
  advancedByRole: text("advanced_by_role").notNull(), // 'developer' | 'landowner' | 'other'

  // ── Who should have paid (responsible side) ────────────────────────────────
  responsiblePartyRole: text("responsible_party_role").notNull(), // 'developer' | 'landowner'
  responsiblePartnerId: uuid("responsible_partner_id").references(
    () => partnersTable.id,
    { onDelete: "set null" },
  ),
  responsiblePartnerName: text("responsible_partner_name"),

  // ── Optional links to other records ───────────────────────────────────────
  linkedBurdenRecordId: uuid("linked_burden_record_id").references(
    () => burdenRecordsTable.id,
    { onDelete: "set null" },
  ),
  linkedExpenditureId: uuid("linked_expenditure_id").references(
    () => expendituresTable.id,
    { onDelete: "set null" },
  ),

  // ── Amounts ────────────────────────────────────────────────────────────────
  originalAmount: numeric("original_amount", { precision: 15, scale: 2 }).notNull(),
  recoveredAmount: numeric("recovered_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),

  // ── Details ────────────────────────────────────────────────────────────────
  description: text("description").notNull(),
  advancedDate: date("advanced_date").notNull(),
  dueDate: date("due_date"),
  // 'direct_payment' | 'share_deduction' | 'settlement' | null
  recoveryMethod: text("recovery_method"),

  // ── Status ─────────────────────────────────────────────────────────────────
  status: recoverableAdvanceStatusEnum("status").notNull().default("pending"),

  // ── Notes ──────────────────────────────────────────────────────────────────
  notes: text("notes"),
  recoveryNotes: text("recovery_notes"),

  // ── Acknowledgement ────────────────────────────────────────────────────────
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedById: uuid("acknowledged_by_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  acknowledgedByName: text("acknowledged_by_name"),

  // ── Closure ────────────────────────────────────────────────────────────────
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedById: uuid("closed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  closedByName: text("closed_by_name"),

  // ── Soft delete + audit ────────────────────────────────────────────────────
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * Audit trail of every step in an advance's recovery lifecycle.
 * Event types: 'raised' | 'acknowledged' | 'payment' | 'deduction' | 'written_off' | 'note'
 */
export const advanceRecoveryEventsTable = pgTable("advance_recovery_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  advanceId: uuid("advance_id")
    .notNull()
    .references(() => recoverableAdvancesTable.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }),
  description: text("description").notNull(),
  eventDate: date("event_date").notNull(),
  recordedById: uuid("recorded_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type RecoverableAdvance = typeof recoverableAdvancesTable.$inferSelect;
export type NewRecoverableAdvance = typeof recoverableAdvancesTable.$inferInsert;
export type AdvanceRecoveryEvent = typeof advanceRecoveryEventsTable.$inferSelect;
export type NewAdvanceRecoveryEvent = typeof advanceRecoveryEventsTable.$inferInsert;

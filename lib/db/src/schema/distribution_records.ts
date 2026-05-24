/**
 * distribution_records.ts
 *
 * Distribution record and payment history system.
 *
 * Architecture:
 *   - distributionRecordsTable  — one record per (project, partner, period)
 *                                 permanently preserved; never hard-deleted
 *   - distributionPaymentEventsTable — append-only payment event log
 *
 * Pending payable = settlementRecommendation − totalPaid
 * Carry-forward   = unpaid balance at period close, rolled to next period
 *
 * Status machine:
 *   draft → pending → partial → paid
 *   pending / partial / paid → carried_forward  (period closed with balance)
 *   any non-archived → archived  (admin only, soft)
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";

// ── Distribution records ───────────────────────────────────────────────────

export const distributionRecordsTable = pgTable("distribution_records", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Scope
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  partnerId: uuid("partner_id")
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  // Accounting period
  accountingPeriodLabel: text("accounting_period_label").notNull(),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),

  // Linked sources (arrays of UUIDs stored as JSONB)
  linkedSaleIds: jsonb("linked_sale_ids").notNull().default([]),       // salesTransactionsTable
  linkedSettlementId: uuid("linked_settlement_id"),                    // settlement_records.id (optional)
  settlementType: text("settlement_type"),                             // 'fifty_pct' | 'payable' | 'lca' | 'manual'

  // Financials
  grossRevenue: numeric("gross_revenue", { precision: 15, scale: 2 }).notNull().default("0"),
  settlementRecommendation: numeric("settlement_recommendation", { precision: 15, scale: 2 }).notNull().default("0"),
  totalPaid: numeric("total_paid", { precision: 15, scale: 2 }).notNull().default("0"),
  pendingPayable: numeric("pending_payable", { precision: 15, scale: 2 }).notNull().default("0"),

  // Carry-forward
  priorCarryForward: numeric("prior_carry_forward", { precision: 15, scale: 2 }).notNull().default("0"),
  carryForwardBalance: numeric("carry_forward_balance", { precision: 15, scale: 2 }).notNull().default("0"),
  carriedFromRecordId: uuid("carried_from_record_id"),                 // self-reference to prior period record
  carriedToRecordId: uuid("carried_to_record_id"),                    // set when balance is rolled forward

  // Payment details (most recent payment)
  lastPaymentDate: text("last_payment_date"),
  lastPaymentRef: text("last_payment_ref"),
  paymentProofUrl: text("payment_proof_url"),                         // placeholder; set to URL when proof uploaded
  paymentProofNotes: text("payment_proof_notes"),

  // Status
  // 'draft' | 'pending' | 'partial' | 'paid' | 'carried_forward' | 'archived'
  status: text("status").notNull().default("draft"),

  notes: text("notes"),

  // Permanent preservation flag — once set, record must never be deleted
  isPermanentRecord: boolean("is_permanent_record").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),

  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Distribution payment events (append-only) ─────────────────────────────

export const distributionPaymentEventsTable = pgTable("distribution_payment_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  distributionRecordId: uuid("distribution_record_id")
    .notNull()
    .references(() => distributionRecordsTable.id, { onDelete: "restrict" }),

  // Denormalized for query efficiency
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  partnerId: uuid("partner_id").references(() => partnersTable.id, { onDelete: "set null" }),

  // Event type
  // 'payment_recorded' | 'partial_payment' | 'status_changed' | 'carried_forward' |
  // 'proof_attached' | 'carry_forward_received' | 'archived'
  eventType: text("event_type").notNull(),

  // Payment snapshot at event time
  paymentAmount: numeric("payment_amount", { precision: 15, scale: 2 }),
  cumulativePaid: numeric("cumulative_paid", { precision: 15, scale: 2 }),
  remainingBalance: numeric("remaining_balance", { precision: 15, scale: 2 }),

  previousStatus: text("previous_status"),
  newStatus: text("new_status"),

  paymentDate: text("payment_date"),
  paymentRef: text("payment_ref"),

  remarks: text("remarks"),
  metadata: jsonb("metadata"),

  performedBy: uuid("performed_by").references(() => usersTable.id, { onDelete: "set null" }),
  performedByName: text("performed_by_name"),
  performedByRole: text("performed_by_role"),

  // ── V3 Wave 1: balance snapshot + override fields (no behavior yet) ─────
  /** Partner's distributable balance immediately before this payment was applied. */
  balanceBeforePayment: numeric("balance_before_payment", { precision: 15, scale: 2 }),
  /** Partner's distributable balance immediately after this payment was applied. */
  balanceAfterPayment: numeric("balance_after_payment", { precision: 15, scale: 2 }),
  /** Available balance (distributable − held) immediately before this payment. */
  availableBalanceBeforePayment: numeric("available_balance_before_payment", { precision: 15, scale: 2 }),
  /** Available balance immediately after this payment. */
  availableBalanceAfterPayment: numeric("available_balance_after_payment", { precision: 15, scale: 2 }),
  /** Frontier: max partner_financial_ledger.id used to compute the balance snapshot. */
  balanceSnapshotMaxLedgerId: uuid("balance_snapshot_max_ledger_id"),
  /** Frontier: max held_distribution_ledger.id used to compute the available balance. */
  balanceSnapshotMaxHoldId: uuid("balance_snapshot_max_hold_id"),
  /** True when an admin/dev bypassed the over-distribution guard. */
  isOverride: boolean("is_override").notNull().default(false),
  /** Required when is_override = true. */
  overrideReason: text("override_reason"),
  /** Required when is_override = true. */
  overrideAcknowledgedBy: uuid("override_acknowledged_by").references(() => usersTable.id, { onDelete: "set null" }),

  // Immutable
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
});

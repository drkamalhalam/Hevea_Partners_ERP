/**
 * payable.ts
 *
 * Partner Actual Payable Calculation System.
 *
 * Two tables:
 *   payable_adjustments  — manual prior-imbalance and carry-balance entries
 *   payable_snapshots    — write-once recommendation snapshots
 *
 * The computation engine pulls from:
 *   1. fifty_pct_sessions (profit share via agreements.landOwnerId)
 *   2. landowner_ledger_entries (pending recoveries via isRecoverable)
 *   3. lca_ledger (outstanding LCA balance)
 *   4. recoverable_advances (outstanding advance balance owed to/from partner)
 *   5. payable_adjustments (imbalance adjustments + carry balances, manual)
 *
 * Formula:
 *   Profit Share
 *   + Recoverable Advances outstanding
 *   + Pending Recoveries (landowner ledger)
 *   + Pending LCA balance
 *   + Prior Imbalance Adjustments (net of credits − debits)
 *   − Negative Carry Balances
 *   = Actual Payable Recommendation (advisory only; settlement stays manual)
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

// ── payable_adjustments ───────────────────────────────────────────────────

/**
 * Manual adjustments that feed into the payable recommendation.
 * Used for:
 *   - imbalance_adjustment: prior over/under-payment corrections
 *   - carry_balance: negative carry-forward deductions from prior periods
 *   - other_credit / other_debit: catch-all entries
 *
 * Deliberately excludes: profit share (from fifty_pct_sessions),
 * LCA (from lca_ledger), recoverable advances (from recoverable_advances),
 * and pending recoveries (from landowner_ledger_entries) — those are all
 * auto-pulled from their canonical source tables.
 */
export const payableAdjustmentsTable = pgTable("payable_adjustments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  // imbalance_adjustment | carry_balance | other_credit | other_debit
  adjustmentType: text("adjustment_type").notNull(),

  // credit = increases payable; debit = decreases payable
  direction: text("direction").notNull(),

  // Always stored as a positive number; direction determines sign
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),

  periodLabel: text("period_label"),
  description: text("description").notNull(),
  reference: text("reference"),

  // draft | confirmed
  status: text("status").notNull().default("draft"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: uuid("confirmed_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  confirmedByName: text("confirmed_by_name"),

  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),

  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type PayableAdjustment = typeof payableAdjustmentsTable.$inferSelect;
export type NewPayableAdjustment = typeof payableAdjustmentsTable.$inferInsert;

// ── payable_snapshots ─────────────────────────────────────────────────────

/**
 * Write-once recommendation records.
 *
 * Every snapshot captures the full breakdown at the moment of generation.
 * No UPDATE is permitted through the application (status can be finalized
 * by a dedicated endpoint, but amounts are immutable after creation).
 */
export const payableSnapshotsTable = pgTable("payable_snapshots", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  periodLabel: text("period_label").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),

  // Component amounts
  profitShareAmount: numeric("profit_share_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  profitShareSource: text("profit_share_source").notNull().default("fifty_pct"),
  recoverableAdvancesAmount: numeric("recoverable_advances_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),
  pendingRecoveriesAmount: numeric("pending_recoveries_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),
  pendingLcaAmount: numeric("pending_lca_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  priorAdjustmentsAmount: numeric("prior_adjustments_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),
  negativeCarryAmount: numeric("negative_carry_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  // Computed result
  actualPayable: numeric("actual_payable", { precision: 14, scale: 2 }).notNull(),

  // draft | finalized
  status: text("status").notNull().default("draft"),

  generatedBy: uuid("generated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  generatedByName: text("generated_by_name"),
  notes: text("notes"),

  // Full JSON breakdown for audit/display
  breakdown: jsonb("breakdown"),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type PayableSnapshot = typeof payableSnapshotsTable.$inferSelect;
export type NewPayableSnapshot = typeof payableSnapshotsTable.$inferInsert;

/**
 * loss_absorption.ts
 *
 * Loss Absorption & Negative Balance Adjustment Engine
 *
 * Two tables:
 *
 * 1. loss_absorption_records — period-level expected vs actual burden tracking.
 *    Records when the landowner's gross entitlement minus actual burden goes
 *    negative, generating a "loss" that must be absorbed and carried forward.
 *
 * 2. negative_balance_entries — running negative balance ledger per
 *    (project, partner). Append-only audit trail of balance movements.
 *
 * ADVISORY ONLY — no settlement or payment is triggered automatically.
 * The settlement priority engine (API) reads these tables together with
 * the imbalance_ledger, lca_ledger, and fifty_pct_sessions to produce a
 * prioritised recommendation. Final decisions remain manual.
 *
 * Settlement priority (advisory):
 *   1. Recover past imbalances (pending negative_balance_entries)
 *   2. Pay pending LCA (from lca_ledger)
 *   3. Distribute current profit (from fifty_pct_sessions)
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";

// ── 1. Loss Absorption Records ─────────────────────────────────────────────

/**
 * One record per accounting period per (project, partner) pair.
 *
 * Captures:
 *   expectedBurden   — the burden the landowner was supposed to bear (from rules)
 *   actualBurden     — the burden actually charged in the period
 *   grossEntitlement — the landowner's gross revenue share for the period
 *   lossImbalance    — max(0, actualBurden - grossEntitlement)
 *                      i.e. the amount the landowner couldn't cover from revenue
 *   carryForwardAmount — portion of lossImbalance carried to the next period
 *   carryForwardStatus — pending | partial | resolved
 *
 * Status lifecycle:
 *   draft → confirmed → (carryForwardStatus tracks ongoing resolution)
 */
export const lossAbsorptionRecordsTable = pgTable("loss_absorption_records", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  // ── Period ─────────────────────────────────────────────────────────────

  periodLabel: text("period_label").notNull(),
  // Human label: "2024-25 Q3", "FY 2024-25", "Oct 2024"

  periodYear: integer("period_year"),
  // Calendar year for grouping/sorting

  periodStart: text("period_start"),
  // YYYY-MM-DD inclusive start

  periodEnd: text("period_end"),
  // YYYY-MM-DD inclusive end

  // ── Burden figures ──────────────────────────────────────────────────────

  expectedBurden: numeric("expected_burden", { precision: 15, scale: 2 }).notNull().default("0"),
  // The operational burden the landowner was EXPECTED to bear per rules/budget

  actualBurden: numeric("actual_burden", { precision: 15, scale: 2 }).notNull().default("0"),
  // The burden ACTUALLY charged against the landowner in the period

  grossEntitlement: numeric("gross_entitlement", { precision: 15, scale: 2 }).notNull().default("0"),
  // The landowner's gross revenue share (50% split) before deductions

  // ── Loss computation ────────────────────────────────────────────────────

  burdenImbalance: numeric("burden_imbalance", { precision: 15, scale: 2 }).notNull().default("0"),
  // actualBurden - expectedBurden (positive = over-burdened, negative = under-burdened)

  lossAbsorbed: numeric("loss_absorbed", { precision: 15, scale: 2 }).notNull().default("0"),
  // max(0, actualBurden - grossEntitlement) — the loss the landowner couldn't cover

  netAfterBurden: numeric("net_after_burden", { precision: 15, scale: 2 }).notNull().default("0"),
  // grossEntitlement - actualBurden (can be negative; floored at 0 in settlement)

  // ── Carry-forward ───────────────────────────────────────────────────────

  carryForwardAmount: numeric("carry_forward_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  // Portion of lossAbsorbed that has NOT yet been recovered; carried to next period

  carryForwardStatus: text("carry_forward_status").notNull().default("none"),
  // none | pending | partial | resolved

  resolvedAmount: numeric("resolved_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  // How much of the carry-forward has been resolved so far

  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => usersTable.id, { onDelete: "set null" }),
  resolvedByName: text("resolved_by_name"),
  resolutionNote: text("resolution_note"),

  // ── Record lifecycle ────────────────────────────────────────────────────

  status: text("status").notNull().default("draft"),
  // draft | confirmed

  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: uuid("confirmed_by").references(() => usersTable.id, { onDelete: "set null" }),
  confirmedByName: text("confirmed_by_name"),

  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),

  // ── Audit ───────────────────────────────────────────────────────────────

  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 2. Negative Balance Entries ────────────────────────────────────────────

/**
 * Running negative balance ledger — append-only.
 *
 * Records every movement of a partner's balance position into or out of
 * negative territory for a given project.
 *
 * referenceType classifies the source of the balance movement:
 *   loss_absorption     — from a loss_absorption_records carry-forward
 *   lca_shortfall       — from an outstanding LCA balance that wasn't covered
 *   settlement_deficit  — from a settlement where payable < obligation
 *   burden_imbalance    — directly from the imbalance_ledger
 *   manual_adjustment   — admin-entered manual correction
 *   recovery_credit     — partial or full recovery reducing the negative balance
 *
 * Balance semantics:
 *   openingBalance  — balance BEFORE this entry (negative = in deficit)
 *   changeAmount    — the delta (negative = worsens position, positive = improves)
 *   closingBalance  — balance AFTER this entry = openingBalance + changeAmount
 */
export const negativeBalanceEntriesTable = pgTable("negative_balance_entries", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  // ── Source reference ────────────────────────────────────────────────────

  referenceType: text("reference_type").notNull(),
  // loss_absorption | lca_shortfall | settlement_deficit | burden_imbalance | manual_adjustment | recovery_credit

  referenceId: uuid("reference_id"),
  // Optional FK to the source record (e.g. loss_absorption_records.id)

  // ── Period ──────────────────────────────────────────────────────────────

  periodLabel: text("period_label").notNull(),

  // ── Balance movement ────────────────────────────────────────────────────

  openingBalance: numeric("opening_balance", { precision: 15, scale: 2 }).notNull(),
  // Balance before this entry (negative = partner is in deficit)

  changeAmount: numeric("change_amount", { precision: 15, scale: 2 }).notNull(),
  // Delta: negative worsens the position, positive improves it

  closingBalance: numeric("closing_balance", { precision: 15, scale: 2 }).notNull(),
  // openingBalance + changeAmount

  // ── Description ─────────────────────────────────────────────────────────

  description: text("description").notNull(),
  notes: text("notes"),

  // ── Recovery tracking ───────────────────────────────────────────────────

  recoveryStatus: text("recovery_status").notNull().default("pending"),
  // pending | partial | recovered | waived (only meaningful for debit entries)

  recoveredAmount: numeric("recovered_amount", { precision: 15, scale: 2 }).notNull().default("0"),

  // ── Soft delete ─────────────────────────────────────────────────────────

  isActive: boolean("is_active").notNull().default(true),

  // ── Audit ───────────────────────────────────────────────────────────────

  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── TypeScript types ───────────────────────────────────────────────────────

export type LossAbsorptionRecord = typeof lossAbsorptionRecordsTable.$inferSelect;
export type LossAbsorptionRecordInsert = typeof lossAbsorptionRecordsTable.$inferInsert;
export type NegativeBalanceEntry = typeof negativeBalanceEntriesTable.$inferSelect;
export type NegativeBalanceEntryInsert = typeof negativeBalanceEntriesTable.$inferInsert;

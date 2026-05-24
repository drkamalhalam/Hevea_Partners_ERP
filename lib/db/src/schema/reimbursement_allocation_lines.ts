/**
 * reimbursement_allocation_lines.ts
 *
 * V3 Partner Financial Ledger — Wave 1 (schema only).
 *
 * Per-reimbursement-event, per-pair allocation line. Write-once.
 *
 * One line ⇨ ONE paired ledger pair:
 *   - `reimbursement_credit` to paying partner
 *   - `reimbursement_debit`  to receiving partner
 *
 * Source events live in `burden_recovery_adjustments` /
 * `burden_recovery_events`. paying_partner_id ≠ receiving_partner_id.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { numericFlex } from "../numericFlex";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";

export const reimbursementAllocationLinesTable = pgTable(
  "reimbursement_allocation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),

    payingPartnerId: uuid("paying_partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    receivingPartnerId: uuid("receiving_partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),

    /** burden_recovery_adjustment | burden_recovery_event */
    reimbursementReferenceType: text("reimbursement_reference_type").notNull(),
    reimbursementReferenceId: uuid("reimbursement_reference_id").notNull(),

    sourceEventAmount: numericFlex("source_event_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    allocatedAmount: numericFlex("allocated_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    allocationPercentage: numericFlex("allocation_percentage", {
      precision: 12,
      scale: 8,
    }).notNull(),

    /** burden_split | ownership_pct | manual */
    allocationBasis: text("allocation_basis").notNull().default("burden_split"),

    /** UNIQUE FKs to paired ledger entries (set by handler). */
    ledgerDebitEntryId: uuid("ledger_debit_entry_id"),
    ledgerCreditEntryId: uuid("ledger_credit_entry_id"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byEvent: index("rial_event_idx").on(
      t.reimbursementReferenceType,
      t.reimbursementReferenceId,
    ),
    byProjectPaying: index("rial_project_paying_idx").on(
      t.projectId,
      t.payingPartnerId,
    ),
    byProjectReceiving: index("rial_project_receiving_idx").on(
      t.projectId,
      t.receivingPartnerId,
    ),
    uniqueDebit: uniqueIndex("rial_ledger_debit_uq")
      .on(t.ledgerDebitEntryId)
      .where(sql`${t.ledgerDebitEntryId} IS NOT NULL`),
    uniqueCredit: uniqueIndex("rial_ledger_credit_uq")
      .on(t.ledgerCreditEntryId)
      .where(sql`${t.ledgerCreditEntryId} IS NOT NULL`),

    differentParties: check(
      "rial_different_parties_chk",
      sql`${t.payingPartnerId} <> ${t.receivingPartnerId}`,
    ),
    amountsNonNegative: check(
      "rial_amounts_chk",
      sql`${t.sourceEventAmount} >= 0 AND ${t.allocatedAmount} >= 0`,
    ),
    pctRange: check(
      "rial_pct_chk",
      sql`${t.allocationPercentage} >= 0 AND ${t.allocationPercentage} <= 1`,
    ),
    basisValid: check(
      "rial_basis_chk",
      sql`${t.allocationBasis} IN ('burden_split','ownership_pct','manual')`,
    ),
    eventTypeValid: check(
      "rial_event_type_chk",
      sql`${t.reimbursementReferenceType} IN (
        'burden_recovery_adjustment','burden_recovery_event'
      )`,
    ),
  }),
);

export type ReimbursementAllocationLine =
  typeof reimbursementAllocationLinesTable.$inferSelect;
export type ReimbursementAllocationLineInsert =
  typeof reimbursementAllocationLinesTable.$inferInsert;

/**
 * partner_financial_ledger.ts
 *
 * V3 Partner Financial Ledger — Wave 1 (schema only).
 *
 * Append-only per-(project, partner) book of every financial fact. The single
 * source of truth for partner balances under V3. Corrections are made by
 * reversal rows that reference the original entry via `reverses_entry_id`.
 *
 * Wave 1 scope: TABLE + INDEXES + CHECK constraints only. NO writers,
 * NO handlers, NO route integration, NO behavior behind feature flags yet.
 *
 * See V3 Final Freeze and Implementation Readiness Report §1 / §4 / §8.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { numericFlex } from "../numericFlex";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

export const partnerFinancialLedgerTable = pgTable(
  "partner_financial_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ── Scope ─────────────────────────────────────────────────────────────
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),

    // ── Entry classification ──────────────────────────────────────────────
    /**
     * Valid values (V3 §1):
     *   revenue_credit, cost_allocation_debit,
     *   adjustment_credit, adjustment_debit,
     *   distribution_payment_debit,
     *   manual_override_credit, manual_override_debit,
     *   sale_reversal_credit, sale_reversal_debit,
     *   cost_reversal_credit, distribution_reversal_credit,
     *   reimbursement_credit, reimbursement_debit,
     *   inheritance_transfer_out_debit, inheritance_transfer_in_credit
     */
    entryType: text("entry_type").notNull(),

    /** credit | debit */
    direction: text("direction").notNull(),

    /** Always stored positive. `direction` decides the sign in summaries. */
    amount: numericFlex("amount", { precision: 15, scale: 2 }).notNull(),

    /** Business effective date. */
    entryDate: timestamp("entry_date", { withTimezone: true }).notNull(),

    // ── Source reference (V3 §1 reference_type set) ──────────────────────
    /**
     * Valid values:
     *   sales_transaction, store_sale_allocation, internal_partner_purchase,
     *   override_sale, expenditure, burden_record, lca_ledger,
     *   adjustment_record, distribution_payment, inheritance_event,
     *   manual_override, sale_cancellation
     */
    referenceType: text("reference_type").notNull(),
    referenceId: uuid("reference_id"),
    referenceSecondaryId: uuid("reference_secondary_id"),

    // ── Reversal linkage (write-once correction model) ───────────────────
    reversesEntryId: uuid("reverses_entry_id").references(
      (): any => partnerFinancialLedgerTable.id,
      { onDelete: "restrict" },
    ),

    // ── Handler provenance ───────────────────────────────────────────────
    /**
     * Valid values:
     *   sale_revenue_handler, cost_allocator, reimbursement_allocator,
     *   distribution_workflow, adjustment_workflow, inheritance_handler,
     *   override_workflow, legacy_backfill
     */
    createdByHandler: text("created_by_handler").notNull(),

    // ── Description + metadata ───────────────────────────────────────────
    description: text("description").notNull(),
    metadata: jsonb("metadata"),

    // ── Audit ────────────────────────────────────────────────────────────
    recordedById: uuid("recorded_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    recordedByName: text("recorded_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byProjectPartnerDate: index("pfl_project_partner_date_idx").on(
      t.projectId,
      t.partnerId,
      t.entryDate,
    ),
    byReference: index("pfl_reference_idx").on(t.referenceType, t.referenceId),
    byEntryType: index("pfl_entry_type_idx").on(t.entryType),
    uniqueReversal: uniqueIndex("pfl_reverses_entry_id_uq")
      .on(t.reversesEntryId)
      .where(sql`${t.reversesEntryId} IS NOT NULL`),

    amountPositive: check("pfl_amount_positive_chk", sql`${t.amount} > 0`),
    directionValid: check(
      "pfl_direction_chk",
      sql`${t.direction} IN ('credit', 'debit')`,
    ),
    entryTypeValid: check(
      "pfl_entry_type_chk",
      sql`${t.entryType} IN (
        'revenue_credit','cost_allocation_debit',
        'adjustment_credit','adjustment_debit',
        'distribution_payment_debit',
        'manual_override_credit','manual_override_debit',
        'sale_reversal_credit','sale_reversal_debit',
        'cost_reversal_credit','distribution_reversal_credit',
        'reimbursement_credit','reimbursement_debit',
        'inheritance_transfer_out_debit','inheritance_transfer_in_credit'
      )`,
    ),
    handlerValid: check(
      "pfl_handler_chk",
      sql`${t.createdByHandler} IN (
        'sale_revenue_handler','cost_allocator','reimbursement_allocator',
        'distribution_workflow','adjustment_workflow','inheritance_handler',
        'override_workflow','legacy_backfill'
      )`,
    ),
    referenceTypeValid: check(
      "pfl_reference_type_chk",
      sql`${t.referenceType} IN (
        'sales_transaction','store_sale_allocation','internal_partner_purchase',
        'override_sale','expenditure','burden_record','lca_ledger',
        'adjustment_record','distribution_payment','inheritance_event',
        'manual_override','sale_cancellation'
      )`,
    ),
    reversalRequiresLink: check(
      "pfl_reversal_link_chk",
      sql`(${t.entryType} NOT LIKE '%reversal%') OR (${t.reversesEntryId} IS NOT NULL)`,
    ),
  }),
);

export type PartnerFinancialLedger =
  typeof partnerFinancialLedgerTable.$inferSelect;
export type PartnerFinancialLedgerInsert =
  typeof partnerFinancialLedgerTable.$inferInsert;

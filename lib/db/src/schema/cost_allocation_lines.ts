/**
 * cost_allocation_lines.ts
 *
 * V3 Partner Financial Ledger — Wave 1 (schema only).
 *
 * Per-cost, per-partner allocation evidence row. Write-once. Pairs 1:1 with
 * a `partner_financial_ledger` row of entry_type='cost_allocation_debit'
 * via `ledger_entry_id`.
 *
 * Allocation basis:
 *   project_ownership_pct       — ownership-contribution model
 *   fifty_pct_landowner_all     — 50% revenue model (always 100% to landowner)
 *   manual_override             — admin/dev manual allocation
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
import { ownershipSnapshotsTable } from "./ownership_snapshots";

export const costAllocationLinesTable = pgTable(
  "cost_allocation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),

    /** expenditure | burden_record | lca_ledger | manual_override */
    costReferenceType: text("cost_reference_type").notNull(),
    costReferenceId: uuid("cost_reference_id").notNull(),

    /** Original full cost amount (denormalized for validator clarity). */
    originalAmount: numericFlex("original_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),

    /** Portion allocated to this partner. */
    allocatedAmount: numericFlex("allocated_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),

    /** 0..1 (fraction). Sum across partners for one cost MUST = 1.0. */
    allocationPercentage: numericFlex("allocation_percentage", {
      precision: 12,
      scale: 8,
    }).notNull(),

    /** project_ownership_pct | fifty_pct_landowner_all | manual_override */
    allocationBasis: text("allocation_basis").notNull(),

    /** ownership_contribution | fifty_percent_revenue */
    commercialModelAtAllocation: text("commercial_model_at_allocation").notNull(),

    /** Optional FK to the ownership snapshot used at allocation time. */
    ownershipSnapshotReference: uuid("ownership_snapshot_reference").references(
      () => ownershipSnapshotsTable.id,
      { onDelete: "set null" },
    ),

    /** UNIQUE FK to the ledger entry this line backs (set by handler). */
    ledgerEntryId: uuid("ledger_entry_id"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byCost: index("cal_cost_idx").on(t.costReferenceType, t.costReferenceId),
    byProjectPartner: index("cal_project_partner_idx").on(
      t.projectId,
      t.partnerId,
    ),
    uniqueLedgerEntry: uniqueIndex("cal_ledger_entry_uq")
      .on(t.ledgerEntryId)
      .where(sql`${t.ledgerEntryId} IS NOT NULL`),

    amountsNonNegative: check(
      "cal_amounts_chk",
      sql`${t.originalAmount} >= 0 AND ${t.allocatedAmount} >= 0`,
    ),
    pctRange: check(
      "cal_pct_chk",
      sql`${t.allocationPercentage} >= 0 AND ${t.allocationPercentage} <= 1`,
    ),
    basisValid: check(
      "cal_basis_chk",
      sql`${t.allocationBasis} IN (
        'project_ownership_pct','fifty_pct_landowner_all','manual_override'
      )`,
    ),
    modelValid: check(
      "cal_model_chk",
      sql`${t.commercialModelAtAllocation} IN (
        'ownership_contribution','fifty_percent_revenue'
      )`,
    ),
    costRefValid: check(
      "cal_cost_ref_chk",
      sql`${t.costReferenceType} IN (
        'expenditure','burden_record','lca_ledger','manual_override'
      )`,
    ),
  }),
);

export type CostAllocationLine = typeof costAllocationLinesTable.$inferSelect;
export type CostAllocationLineInsert =
  typeof costAllocationLinesTable.$inferInsert;

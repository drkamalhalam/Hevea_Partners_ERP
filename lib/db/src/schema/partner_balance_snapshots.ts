/**
 * partner_balance_snapshots.ts
 *
 * V3 Partner Financial Ledger — Wave 1 (schema only).
 *
 * Derived cache of `partner_financial_position_v`. Rebuildable from the
 * ledger via `recompute_partner_balance(project_id, partner_id)` (not yet
 * implemented — Wave 4). One row per (project, partner).
 */

import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";

export const partnerBalanceSnapshotsTable = pgTable(
  "partner_balance_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),

    // ── Aggregated position fields (V3 §6) ───────────────────────────────
    grossRevenue: numericFlex("gross_revenue", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    grossRevenueExternal: numericFlex("gross_revenue_external", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),
    grossRevenueInternal: numericFlex("gross_revenue_internal", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),

    allocatedCosts: numericFlex("allocated_costs", { precision: 15, scale: 2 })
      .notNull()
      .default(0),

    adjustmentCredits: numericFlex("adjustment_credits", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),
    adjustmentDebits: numericFlex("adjustment_debits", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),

    reimbursementCredits: numericFlex("reimbursement_credits", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),
    reimbursementDebits: numericFlex("reimbursement_debits", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),

    reversalCredits: numericFlex("reversal_credits", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    reversalDebits: numericFlex("reversal_debits", { precision: 15, scale: 2 })
      .notNull()
      .default(0),

    inheritanceIn: numericFlex("inheritance_in", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    inheritanceOut: numericFlex("inheritance_out", { precision: 15, scale: 2 })
      .notNull()
      .default(0),

    distributionPayments: numericFlex("distribution_payments", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),
    distributionReversals: numericFlex("distribution_reversals", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),

    netProfit: numericFlex("net_profit", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    distributableBalance: numericFlex("distributable_balance", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),
    heldBalance: numericFlex("held_balance", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    availableDistributableBalance: numericFlex("available_distributable_balance", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),

    // ── Replay frontier ──────────────────────────────────────────────────
    computedFromMaxLedgerId: uuid("computed_from_max_ledger_id"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueProjectPartner: uniqueIndex("pbs_project_partner_uq").on(
      t.projectId,
      t.partnerId,
    ),
  }),
);

export type PartnerBalanceSnapshot =
  typeof partnerBalanceSnapshotsTable.$inferSelect;
export type PartnerBalanceSnapshotInsert =
  typeof partnerBalanceSnapshotsTable.$inferInsert;

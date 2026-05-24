/**
 * project_closure_partner_snapshots.ts
 *
 * V3 Partner Financial Ledger — Wave 1 (schema only).
 *
 * One row per (project_closure_workflow, partner) capturing the partner's
 * full financial position at closure. Write-once. Paired with frontier
 * references stored on `project_closure_workflows`:
 *   closure_ledger_max_id
 *   closure_holds_max_id
 *   closure_ownership_snapshot_reference
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
import { partnersTable } from "./partners";
import { projectClosureWorkflowsTable } from "./project_closure_workflow";
import { ownershipSnapshotsTable } from "./ownership_snapshots";

export const projectClosurePartnerSnapshotsTable = pgTable(
  "project_closure_partner_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectClosureId: uuid("project_closure_id")
      .notNull()
      .references(() => projectClosureWorkflowsTable.id, {
        onDelete: "restrict",
      }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    partnerName: text("partner_name").notNull(),

    // ── Ownership context ────────────────────────────────────────────────
    ownershipPercentageAtClosure: numericFlex("ownership_percentage_at_closure", {
      precision: 12,
      scale: 8,
    }),
    ownershipSnapshotReference: uuid("ownership_snapshot_reference").references(
      () => ownershipSnapshotsTable.id,
      { onDelete: "set null" },
    ),

    /** Optional FK / handle to a future entitlement snapshot table. */
    entitlementSnapshotReference: uuid("entitlement_snapshot_reference"),

    // ── Entitlements ─────────────────────────────────────────────────────
    sheetEntitlementKg: numericFlex("sheet_entitlement_kg", {
      precision: 14,
      scale: 4,
    })
      .notNull()
      .default(0),
    scrapEntitlementKg: numericFlex("scrap_entitlement_kg", {
      precision: 14,
      scale: 4,
    })
      .notNull()
      .default(0),

    // ── Financial frozen position ────────────────────────────────────────
    grossRevenue: numericFlex("gross_revenue", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    allocatedCosts: numericFlex("allocated_costs", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    netProfit: numericFlex("net_profit", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    distributedAmount: numericFlex("distributed_amount", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),
    remainingDistributableBalance: numericFlex(
      "remaining_distributable_balance",
      { precision: 15, scale: 2 },
    )
      .notNull()
      .default(0),
    heldBalance: numericFlex("held_balance", { precision: 15, scale: 2 })
      .notNull()
      .default(0),
    availableDistributableBalance: numericFlex(
      "available_distributable_balance",
      { precision: 15, scale: 2 },
    )
      .notNull()
      .default(0),

    notes: text("notes"),

    snapshotTakenAt: timestamp("snapshot_taken_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueClosurePartner: uniqueIndex("pcps_closure_partner_uq").on(
      t.projectClosureId,
      t.partnerId,
    ),
  }),
);

export type ProjectClosurePartnerSnapshot =
  typeof projectClosurePartnerSnapshotsTable.$inferSelect;
export type ProjectClosurePartnerSnapshotInsert =
  typeof projectClosurePartnerSnapshotsTable.$inferInsert;

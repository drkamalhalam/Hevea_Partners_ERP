/**
 * valuations.ts
 *
 * DB schema for the Ownership Transfer Valuation Engine.
 *
 * Formula (v1):
 *   Share Value = I × (1 − (1.20)^(−N)) / 0.20
 *   I = avg net profit of up to 3 most recent post-maturity years
 *   N = 25 − post-maturity project age  (guidance horizon; floored at 1 for computation)
 *
 * Design principles:
 *   - Valuation is GUIDANCE only; final price may be manually overridden.
 *   - Profit records are the source of truth for I; sourced from fifty_pct_sessions
 *     (auto-import) or entered manually.
 *   - Runs are immutable snapshots — no in-place overwrite of formula inputs once saved.
 *     Overrides (finalPriceOverride) are additive annotations, not input rewrites.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  numeric,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { ownershipTransfersTable } from "./ownership_transfers";

// ── Annual profit records ─────────────────────────────────────────────────

export const valuationProfitRecordsTable = pgTable("valuation_profit_records", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  periodYear: integer("period_year").notNull(),

  // Breakdown (optional — for transparency)
  grossRevenue: numeric("gross_revenue", { precision: 15, scale: 2 }),
  operationalCost: numeric("operational_cost", { precision: 15, scale: 2 }),
  lcaAmount: numeric("lca_amount", { precision: 15, scale: 2 }),

  // The figure used in the valuation formula: net profit attributable to the project
  netProfit: numeric("net_profit", { precision: 15, scale: 2 }).notNull(),

  // Source tracing
  source: text("source").notNull().default("manual"), // "manual" | "fifty_pct_session"
  sourceId: uuid("source_id"), // FK to fifty_pct_sessions when source=fifty_pct_session

  // Whether this year falls after the project reached mature_production
  // Only post-maturity records are eligible for use in the valuation formula
  isPostMaturity: boolean("is_post_maturity").notNull().default(false),

  notes: text("notes"),
  recordedBy: uuid("recorded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  recordedByName: text("recorded_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Valuation runs ────────────────────────────────────────────────────────

export const valuationRunsTable = pgTable("valuation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // Optional link to a specific ownership transfer this run supports
  transferId: uuid("transfer_id").references(() => ownershipTransfersTable.id, {
    onDelete: "set null",
  }),

  // ── Maturity inputs ───────────────────────────────────────────────────
  maturityDate: text("maturity_date"), // ISO date when project entered mature_production

  // Computed from maturityDate at run time; stored for immutable record
  postMaturityYears: numeric("post_maturity_years", { precision: 5, scale: 2 }).notNull(),

  // Number of profit years used in the average (min(3, available post-maturity years))
  profitYearsUsed: integer("profit_years_used").notNull(),

  // Snapshot of the profit records used — [{year, netProfit}]
  profitYearData: jsonb("profit_year_data").notNull().default([]),

  // I — average annual net profit
  avgAnnualProfit: numeric("avg_annual_profit", { precision: 15, scale: 2 }).notNull(),

  // ── Formula constants (stored for audit immutability) ─────────────────
  discountRate: numeric("discount_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.20"), // always 20%

  valuationHorizon: integer("valuation_horizon").notNull().default(25), // always 25

  // N = max(1, horizon - postMaturityYears)
  remainingLife: numeric("remaining_life", { precision: 5, scale: 2 }).notNull(),

  isHorizonExceeded: boolean("is_horizon_exceeded").notNull().default(false),

  // ── Results ────────────────────────────────────────────────────────────

  // Full project gross value (100% ownership, formula output)
  projectGrossValue: numeric("project_gross_value", { precision: 15, scale: 2 }).notNull(),

  // Optional share-specific pricing
  shareFraction: numeric("share_fraction", { precision: 8, scale: 6 }), // e.g. 0.30
  shareValue: numeric("share_value", { precision: 15, scale: 2 }), // project_gross_value × share_fraction

  // ── Override ───────────────────────────────────────────────────────────
  finalPriceOverride: numeric("final_price_override", { precision: 15, scale: 2 }),
  overrideReason: text("override_reason"),

  // ── Metadata ──────────────────────────────────────────────────────────
  status: text("status").notNull().default("draft"), // "draft" | "final"
  notes: text("notes"),
  formulaVersion: text("formula_version").notNull().default("v1"),

  calculatedBy: uuid("calculated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  calculatedByName: text("calculated_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── TypeScript types ───────────────────────────────────────────────────────

export type ValuationProfitRecord = typeof valuationProfitRecordsTable.$inferSelect;
export type ValuationProfitRecordInsert = typeof valuationProfitRecordsTable.$inferInsert;
export type ValuationRun = typeof valuationRunsTable.$inferSelect;
export type ValuationRunInsert = typeof valuationRunsTable.$inferInsert;

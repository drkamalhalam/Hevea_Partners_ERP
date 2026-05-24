/**
 * revenue_attribution_lines.ts
 *
 * V3 Partner Financial Ledger — Wave 1 (schema only).
 *
 * Per-sale, per-entitlement-owner revenue line. Write-once. Pairs 1:1 with a
 * `partner_financial_ledger` row of entry_type='revenue_credit' via
 * `ledger_entry_id`.
 *
 * gross_revenue_amount   — partner share of pre-deduction sale total
 * cost_deduction_amount  — partner share of sales_deductions
 * net_revenue_amount     — gross − deduction
 * recognized_partner_revenue — final amount credited to ledger
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

export const revenueAttributionLinesTable = pgTable(
  "revenue_attribution_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),

    /**
     * sales_transaction | sales_order | store_sale | internal_partner_purchase
     * | override_sale
     */
    saleReferenceType: text("sale_reference_type").notNull(),
    saleReferenceId: uuid("sale_reference_id").notNull(),

    /**
     * V3 revenue_category:
     *   individual_partner_sale, store_sale, internal_partner_purchase,
     *   admin_override_sale, developer_override_sale, future_sale_type
     */
    revenueCategory: text("revenue_category").notNull(),

    /** partner | admin | developer | store */
    saleExecutorType: text("sale_executor_type").notNull(),

    /** Quantity attributed to this partner (e.g., consumed kg). */
    consumedQuantity: numericFlex("consumed_quantity", {
      precision: 14,
      scale: 4,
    }).notNull(),
    consumedUnit: text("consumed_unit").notNull().default("kg"),

    /** pro_rata_kg | pro_rata_revenue | flat_split */
    deductionAllocationBasis: text("deduction_allocation_basis")
      .notNull()
      .default("pro_rata_kg"),

    grossRevenueAmount: numericFlex("gross_revenue_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    costDeductionAmount: numericFlex("cost_deduction_amount", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default(0),
    netRevenueAmount: numericFlex("net_revenue_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    recognizedPartnerRevenue: numericFlex("recognized_partner_revenue", {
      precision: 15,
      scale: 2,
    }).notNull(),

    /** FK to the ledger entry this line backs (UNIQUE; set by handler). */
    ledgerEntryId: uuid("ledger_entry_id"),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    bySale: index("ral_sale_idx").on(t.saleReferenceType, t.saleReferenceId),
    byProjectPartner: index("ral_project_partner_idx").on(
      t.projectId,
      t.partnerId,
    ),
    /**
     * Wave-3 idempotency guard. One attribution row per
     * (sale_reference_type, sale_reference_id, partner_id, revenue_category).
     * Partial: applies only to rows where revenue_category is non-null (always
     * true in V3 — included for future schema evolution).
     */
    uniqueSalePartnerCategory: uniqueIndex(
      "ral_sale_partner_category_uq",
    ).on(
      t.saleReferenceType,
      t.saleReferenceId,
      t.partnerId,
      t.revenueCategory,
    ),
    amountsNonNegative: check(
      "ral_amounts_chk",
      sql`${t.grossRevenueAmount} >= 0
        AND ${t.costDeductionAmount} >= 0
        AND ${t.netRevenueAmount} >= 0
        AND ${t.recognizedPartnerRevenue} >= 0
        AND ${t.grossRevenueAmount} >= ${t.netRevenueAmount}
        AND ${t.netRevenueAmount} >= ${t.recognizedPartnerRevenue}`,
    ),
    revenueCategoryValid: check(
      "ral_revenue_category_chk",
      sql`${t.revenueCategory} IN (
        'individual_partner_sale','store_sale','internal_partner_purchase',
        'admin_override_sale','developer_override_sale','future_sale_type'
      )`,
    ),
    executorValid: check(
      "ral_executor_chk",
      sql`${t.saleExecutorType} IN ('partner','admin','developer','store')`,
    ),
    deductionBasisValid: check(
      "ral_deduction_basis_chk",
      sql`${t.deductionAllocationBasis} IN ('pro_rata_kg','pro_rata_revenue','flat_split')`,
    ),
  }),
);

export type RevenueAttributionLine =
  typeof revenueAttributionLinesTable.$inferSelect;
export type RevenueAttributionLineInsert =
  typeof revenueAttributionLinesTable.$inferInsert;

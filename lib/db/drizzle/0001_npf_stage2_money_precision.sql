-- ════════════════════════════════════════════════════════════════════════════
-- NPF Stage 2 — Money Precision Foundation (money columns only)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Formal governance migration artifact covering ONLY monetary columns
-- (target type: numeric(15, 2)).
--
-- Non-money numeric precision (ownership %, quantity/kg, land area,
-- escalation factor) is handled by the Drizzle schema push and is NOT
-- included here to avoid unintended data semantics / precision loss from
-- applying a blanket ROUND(..., 2) to non-money values.
--
-- Operational guidance for production cut-over:
--   The companion helper `pnpm --filter @workspace/scripts run
--   npf:stage2:migrate-money` snapshots every row into
--   `precision_conversion_audit` BEFORE each ALTER and logs rounding-event
--   counts per column. Run that script instead of this raw SQL if per-row
--   audit evidence is required for governance review. This file documents
--   the equivalent direct DDL for cases where the cut-over is performed
--   manually by a DBA.
--
--   No table renames. No column renames. No data rewrites beyond the
--   value-preserving ROUND(::numeric, 2). No ownership recalculation.
--   No financial recalculation.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Precision conversion audit table (append-only, no UPDATE/DELETE routes) ─
CREATE TABLE IF NOT EXISTS "precision_conversion_audit" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_table"     text NOT NULL,
  "source_row_id"    uuid,
  "source_column"    text NOT NULL,
  "original_value"   double precision,
  "converted_value"  numeric(15, 2),
  "delta"            double precision,
  "migrated_at"      timestamptz NOT NULL DEFAULT now(),
  "notes"            text
);
CREATE INDEX IF NOT EXISTS "pca_table_column_idx"
  ON "precision_conversion_audit" ("source_table", "source_column");
CREATE INDEX IF NOT EXISTS "pca_table_row_idx"
  ON "precision_conversion_audit" ("source_table", "source_row_id");

-- ════════════════════════════════════════════════════════════════════════════
-- MONEY COLUMNS ONLY  →  numeric(15, 2)
--   a.  real           → numeric(15, 2)   (requires USING ROUND)
--   b.  numeric(14, 2) → numeric(15, 2)   (precision bump only, safe cast)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1a. real → numeric(15, 2) ─────────────────────────────────────────────

ALTER TABLE "agreements"
  ALTER COLUMN "land_notional_value"  TYPE numeric(15, 2) USING ROUND("land_notional_value"::numeric, 2),
  ALTER COLUMN "yearly_escalation"    TYPE numeric(15, 2) USING ROUND("yearly_escalation"::numeric, 2);

ALTER TABLE "contributions"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "expenditures"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "lca_configs"
  ALTER COLUMN "base_amount" TYPE numeric(15, 2) USING ROUND("base_amount"::numeric, 2);

ALTER TABLE "lca_ledger"
  ALTER COLUMN "base_amount"    TYPE numeric(15, 2) USING ROUND("base_amount"::numeric, 2),
  ALTER COLUMN "gross_due"      TYPE numeric(15, 2) USING ROUND("gross_due"::numeric, 2),
  ALTER COLUMN "carry_forward"  TYPE numeric(15, 2) USING ROUND("carry_forward"::numeric, 2),
  ALTER COLUMN "total_due"      TYPE numeric(15, 2) USING ROUND("total_due"::numeric, 2),
  ALTER COLUMN "amount_paid"    TYPE numeric(15, 2) USING ROUND("amount_paid"::numeric, 2),
  ALTER COLUMN "balance"        TYPE numeric(15, 2) USING ROUND("balance"::numeric, 2);

ALTER TABLE "lca_payment_events"
  ALTER COLUMN "amount_paid" TYPE numeric(15, 2) USING ROUND("amount_paid"::numeric, 2);

-- Correct table name: landowner_ledger_entries
-- (earlier draft incorrectly used landowner_account_ledger — that table does not exist)
ALTER TABLE "landowner_ledger_entries"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "burden_recovery_adjustments"
  ALTER COLUMN "amount_recovered"   TYPE numeric(15, 2) USING ROUND("amount_recovered"::numeric, 2),
  ALTER COLUMN "recoverable_amount" TYPE numeric(15, 2) USING ROUND("recoverable_amount"::numeric, 2);

-- Correct table name: post_maturity_cost_payments
-- (earlier draft incorrectly used post_maturity_payments — that table does not exist)
ALTER TABLE "post_maturity_cost_payments"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "distribution_previews"
  ALTER COLUMN "gross_revenue" TYPE numeric(15, 2) USING ROUND("gross_revenue"::numeric, 2);
  -- epp_total / landowner_total do not exist in distribution_previews.
  -- The 50/50 split totals are in fifty_pct_sessions — those are already
  -- standard numeric(15,2) and need no conversion.

ALTER TABLE "agreement_accounting_profiles"
  ALTER COLUMN "monthly_developer_share" TYPE numeric(15, 2) USING ROUND("monthly_developer_share"::numeric, 2),
  ALTER COLUMN "monthly_landowner_share" TYPE numeric(15, 2) USING ROUND("monthly_landowner_share"::numeric, 2);

-- Correct column name: selling_price_per_kg
-- (earlier draft incorrectly used price_per_kg — that column does not exist in production_records)
ALTER TABLE "production_records"
  ALTER COLUMN "selling_price_per_kg" TYPE numeric(15, 2) USING ROUND("selling_price_per_kg"::numeric, 2);

-- ── 1b. numeric(14, 2) → numeric(15, 2)  (precision bump, safe cast) ──────

ALTER TABLE "advances"
  ALTER COLUMN "amount" TYPE numeric(15, 2);

ALTER TABLE "burden_records"
  ALTER COLUMN "total_amount"                TYPE numeric(15, 2),
  ALTER COLUMN "expected_developer_amount"   TYPE numeric(15, 2),
  ALTER COLUMN "expected_landowner_amount"   TYPE numeric(15, 2),
  ALTER COLUMN "actual_developer_amount"     TYPE numeric(15, 2),
  ALTER COLUMN "actual_landowner_amount"     TYPE numeric(15, 2),
  ALTER COLUMN "developer_imbalance_amount"  TYPE numeric(15, 2),
  ALTER COLUMN "landowner_imbalance_amount"  TYPE numeric(15, 2),
  ALTER COLUMN "recoverable_amount"          TYPE numeric(15, 2);

ALTER TABLE "imbalance_ledger"
  ALTER COLUMN "amount" TYPE numeric(15, 2);

ALTER TABLE "money_custody_ledger"
  ALTER COLUMN "amount" TYPE numeric(15, 2);

ALTER TABLE "payable_entries"
  ALTER COLUMN "amount" TYPE numeric(15, 2);

ALTER TABLE "payment_transactions"
  ALTER COLUMN "amount" TYPE numeric(15, 2);

ALTER TABLE "sales_transactions"
  ALTER COLUMN "price_per_kg"         TYPE numeric(15, 2),
  ALTER COLUMN "total_gross_revenue"  TYPE numeric(15, 2);
  -- quantity_kg in sales_transactions is NOT a money column; left to schema push.

ALTER TABLE "sales_invoices"
  ALTER COLUMN "subtotal"    TYPE numeric(15, 2),
  ALTER COLUMN "tax_amount"  TYPE numeric(15, 2),
  ALTER COLUMN "total"       TYPE numeric(15, 2);

ALTER TABLE "sales_orders"
  ALTER COLUMN "subtotal"    TYPE numeric(15, 2),
  ALTER COLUMN "tax_amount"  TYPE numeric(15, 2),
  ALTER COLUMN "total"       TYPE numeric(15, 2);

-- ════════════════════════════════════════════════════════════════════════════
-- EXPLICITLY UNCHANGED BY THIS FILE
-- ════════════════════════════════════════════════════════════════════════════
--   Non-money numeric columns (handled by Drizzle schema push only):
--     - projects.developer_ownership_pct, .landowner_ownership_pct  (numeric 12,8)
--     - lca_configs.escalation_pct                                   (numeric 7,4)
--     - production_records.production_kg, .sold_kg                   (numeric 12,3)
--     - store_entries.quantity_kg                                     (numeric 12,3)
--     - sales_transactions.quantity_kg                                (numeric 12,3)
--     - projects.land_area, .land_value_per_unit                      (numeric 12,4)
--     - agreements.land_area, .escalation_factor                      (numeric 12,4 / 12,6)
--     - project_parcels.land_area                                     (numeric 12,4)
--   GPS coordinates (intentionally real):
--     - projects.latitude, .longitude
--     - project_parcels.latitude, .longitude
--     - agreements.gps_lat, .gps_lng
--   Frozen historical tables (write-once, never converted):
--     - ownership_snapshots.*
--     - inheritance_history.*
--     - generations.*
--     - backup_* tables
--
-- No table renames. No column renames. No data rewrites beyond
-- value-preserving ROUND. No business-logic changes.
-- ════════════════════════════════════════════════════════════════════════════

COMMIT;

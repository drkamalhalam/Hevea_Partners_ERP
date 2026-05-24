-- ════════════════════════════════════════════════════════════════════════════
-- NPF Stage 2 — Money & Numeric Precision Foundation
-- ════════════════════════════════════════════════════════════════════════════
--
-- Formal governance migration artifact for the already-approved Stage 2
-- conversions. Drizzle-kit `push` was used in development; this file is the
-- reviewable SQL representation of those same ALTER COLUMN operations for
-- production cut-over via `psql -f` or the operations runbook.
--
-- Precision matrix:
--   Money              numeric(15, 2)
--   Ownership %        numeric(12, 8)
--   Non-ownership %    numeric(7, 4)
--   Quantity / kg      numeric(12, 3)
--   Land area          numeric(12, 4)
--   Escalation factor  numeric(12, 6)
--   GPS lat/lng        real  (UNCHANGED per spec)
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
-- 1.  MONEY  →  numeric(15, 2)
--     a.  real           → numeric(15, 2)
--     b.  numeric(14, 2) → numeric(15, 2)
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. real → numeric(15, 2) -----------------------------------------------

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

ALTER TABLE "landowner_account_ledger"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "burden_recovery_adjustments"
  ALTER COLUMN "amount_recovered"   TYPE numeric(15, 2) USING ROUND("amount_recovered"::numeric, 2),
  ALTER COLUMN "recoverable_amount" TYPE numeric(15, 2) USING ROUND("recoverable_amount"::numeric, 2);

ALTER TABLE "post_maturity_payments"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "distribution_previews"
  ALTER COLUMN "gross_revenue"   TYPE numeric(15, 2) USING ROUND("gross_revenue"::numeric, 2),
  ALTER COLUMN "epp_total"       TYPE numeric(15, 2) USING ROUND("epp_total"::numeric, 2),
  ALTER COLUMN "landowner_total" TYPE numeric(15, 2) USING ROUND("landowner_total"::numeric, 2);

ALTER TABLE "agreement_accounting_profiles"
  ALTER COLUMN "monthly_developer_share" TYPE numeric(15, 2) USING ROUND("monthly_developer_share"::numeric, 2),
  ALTER COLUMN "monthly_landowner_share" TYPE numeric(15, 2) USING ROUND("monthly_landowner_share"::numeric, 2);

ALTER TABLE "production_records"
  ALTER COLUMN "price_per_kg" TYPE numeric(15, 2) USING ROUND("price_per_kg"::numeric, 2);

-- 1b. numeric(14, 2) → numeric(15, 2) -------------------------------------

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
  ALTER COLUMN "quantity_kg"          TYPE numeric(12, 3),
  ALTER COLUMN "price_per_kg"         TYPE numeric(15, 2),
  ALTER COLUMN "total_gross_revenue"  TYPE numeric(15, 2);

ALTER TABLE "sales_invoices"
  ALTER COLUMN "subtotal"    TYPE numeric(15, 2),
  ALTER COLUMN "tax_amount"  TYPE numeric(15, 2),
  ALTER COLUMN "total"       TYPE numeric(15, 2);

ALTER TABLE "sales_orders"
  ALTER COLUMN "subtotal"    TYPE numeric(15, 2),
  ALTER COLUMN "tax_amount"  TYPE numeric(15, 2),
  ALTER COLUMN "total"       TYPE numeric(15, 2);

-- ════════════════════════════════════════════════════════════════════════════
-- 2.  OWNERSHIP %  →  numeric(12, 8)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "projects"
  ALTER COLUMN "developer_ownership_pct" TYPE numeric(12, 8) USING ROUND("developer_ownership_pct"::numeric, 8),
  ALTER COLUMN "landowner_ownership_pct" TYPE numeric(12, 8) USING ROUND("landowner_ownership_pct"::numeric, 8);

-- (Snapshots / inheritance / generations tables remain UNCHANGED — frozen.)

-- ════════════════════════════════════════════════════════════════════════════
-- 3.  NON-OWNERSHIP %  →  numeric(7, 4)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "lca_configs"
  ALTER COLUMN "escalation_pct" TYPE numeric(7, 4) USING ROUND("escalation_pct"::numeric, 4);

-- ════════════════════════════════════════════════════════════════════════════
-- 4.  QUANTITY / KG  →  numeric(12, 3)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "production_records"
  ALTER COLUMN "production_kg" TYPE numeric(12, 3) USING ROUND("production_kg"::numeric, 3),
  ALTER COLUMN "sold_kg"       TYPE numeric(12, 3) USING ROUND("sold_kg"::numeric, 3);

ALTER TABLE "store_entries"
  ALTER COLUMN "quantity_kg" TYPE numeric(12, 3) USING ROUND("quantity_kg"::numeric, 3);

-- ════════════════════════════════════════════════════════════════════════════
-- 5.  LAND AREA  →  numeric(12, 4)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "projects"
  ALTER COLUMN "land_area"           TYPE numeric(12, 4) USING ROUND("land_area"::numeric, 4),
  ALTER COLUMN "land_value_per_unit" TYPE numeric(15, 2) USING ROUND("land_value_per_unit"::numeric, 2);

ALTER TABLE "agreements"
  ALTER COLUMN "land_area" TYPE numeric(12, 4) USING ROUND("land_area"::numeric, 4);

ALTER TABLE "project_parcels"
  ALTER COLUMN "land_area" TYPE numeric(12, 4) USING ROUND("land_area"::numeric, 4);

-- ════════════════════════════════════════════════════════════════════════════
-- 6.  ESCALATION FACTOR  →  numeric(12, 6)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "agreements"
  ALTER COLUMN "escalation_factor" TYPE numeric(12, 6) USING ROUND("escalation_factor"::numeric, 6);

-- ════════════════════════════════════════════════════════════════════════════
-- 7.  EXPLICITLY UNCHANGED
-- ════════════════════════════════════════════════════════════════════════════
--   - projects.latitude, projects.longitude         (real, GPS)
--   - project_parcels.latitude, .longitude          (real, GPS)
--   - ownership_snapshots.*                         (frozen historical)
--   - inheritance_history.*                         (frozen historical)
--   - generations.*                                 (frozen historical)
--   - backup_* tables                               (frozen historical)
--
-- No table renames. No column renames. No data rewrites beyond
-- value-preserving ROUND. No business-logic changes.
-- ════════════════════════════════════════════════════════════════════════════

COMMIT;

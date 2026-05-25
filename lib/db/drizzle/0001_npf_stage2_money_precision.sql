-- ════════════════════════════════════════════════════════════════════════════
-- NPF Stage 2 — Money Precision Foundation (real → numeric(15,2) only)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Scope: ONLY monetary columns that were originally declared as `real` (float4)
-- and must be converted to numeric(15,2) with a value-preserving ROUND.
--
-- Out of scope for this file (handled solely by Drizzle schema push):
--   - Ownership % columns          → numeric(12,8)
--   - Non-ownership % columns      → numeric(7,4)
--   - Quantity / kg columns        → numeric(12,3)
--   - Land area columns            → numeric(12,4)
--   - Escalation factor columns    → numeric(12,6)
--   - Precision widenings (14→15)  → handled by numericFlex push, no ROUND needed
-- These are excluded here to avoid applying ROUND(...,2) to non-money values.
--
-- GPS lat/lng (real) are intentionally excluded — float is correct for coordinates.
-- Frozen tables (ownership_snapshots, inheritance_history, generations, backup_*)
-- are explicitly excluded — write-once historical tables must not be converted.
--
-- Operational guidance:
--   Run `pnpm --filter @workspace/scripts run npf:stage2:migrate-money` for
--   per-row audit snapshots before each ALTER. This file is the equivalent
--   direct DDL for manual DBA cut-over without per-row audit evidence.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Precision conversion audit table (append-only) ───────────────────────────
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
-- MONEY columns: real → numeric(15, 2)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "agreements"
  ALTER COLUMN "land_notional_value" TYPE numeric(15, 2)
    USING ROUND("land_notional_value"::numeric, 2);
  -- yearly_escalation is numeric(7,4) — escalation rate, NOT a money column.
  -- land_area, escalation_factor are also non-money. All excluded.

ALTER TABLE "contributions"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "expenditures"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "lca_configs"
  ALTER COLUMN "base_amount" TYPE numeric(15, 2) USING ROUND("base_amount"::numeric, 2);
  -- escalation_pct is numeric(7,4) — excluded.

ALTER TABLE "lca_ledger"
  ALTER COLUMN "base_amount"   TYPE numeric(15, 2) USING ROUND("base_amount"::numeric, 2),
  ALTER COLUMN "gross_due"     TYPE numeric(15, 2) USING ROUND("gross_due"::numeric, 2),
  ALTER COLUMN "carry_forward" TYPE numeric(15, 2) USING ROUND("carry_forward"::numeric, 2),
  ALTER COLUMN "total_due"     TYPE numeric(15, 2) USING ROUND("total_due"::numeric, 2),
  ALTER COLUMN "amount_paid"   TYPE numeric(15, 2) USING ROUND("amount_paid"::numeric, 2),
  ALTER COLUMN "balance"       TYPE numeric(15, 2) USING ROUND("balance"::numeric, 2);

ALTER TABLE "lca_payment_events"
  ALTER COLUMN "amount_paid" TYPE numeric(15, 2) USING ROUND("amount_paid"::numeric, 2);

-- Actual table: landowner_ledger_entries
-- (earlier drafts incorrectly used landowner_account_ledger)
ALTER TABLE "landowner_ledger_entries"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "burden_recovery_adjustments"
  ALTER COLUMN "amount_recovered"   TYPE numeric(15, 2) USING ROUND("amount_recovered"::numeric, 2),
  ALTER COLUMN "recoverable_amount" TYPE numeric(15, 2) USING ROUND("recoverable_amount"::numeric, 2);

-- Actual table: post_maturity_cost_payments
-- (earlier drafts incorrectly used post_maturity_payments)
ALTER TABLE "post_maturity_cost_payments"
  ALTER COLUMN "amount" TYPE numeric(15, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "distribution_previews"
  ALTER COLUMN "gross_revenue" TYPE numeric(15, 2) USING ROUND("gross_revenue"::numeric, 2);
  -- epp_total / landowner_total do not exist in this table.
  -- 50/50 split totals live in fifty_pct_sessions (already numeric(15,2)).

ALTER TABLE "agreement_accounting_profiles"
  ALTER COLUMN "monthly_developer_share" TYPE numeric(15, 2)
    USING ROUND("monthly_developer_share"::numeric, 2),
  ALTER COLUMN "monthly_landowner_share" TYPE numeric(15, 2)
    USING ROUND("monthly_landowner_share"::numeric, 2);

-- Actual column: selling_price_per_kg (NOT price_per_kg)
ALTER TABLE "production_records"
  ALTER COLUMN "selling_price_per_kg" TYPE numeric(15, 2)
    USING ROUND("selling_price_per_kg"::numeric, 2);
  -- production_kg, sold_kg are quantity columns (numeric(12,3)) — excluded.

-- ════════════════════════════════════════════════════════════════════════════
-- EXPLICITLY UNCHANGED BY THIS FILE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Non-money numeric precision (already correct via Drizzle numericFlex push):
--   agreements.yearly_escalation           numeric(7,4)   — escalation rate
--   agreements.land_area                   numeric(12,4)  — land area
--   agreements.escalation_factor           numeric(12,6)  — factor
--   agreements.ownership_share_*           numeric(12,8)  — ownership %
--   projects.developer/landowner_*_pct     numeric(12,8)  — ownership %
--   lca_configs.escalation_pct             numeric(7,4)   — rate
--   production_records.production_kg/sold_kg numeric(12,3) — quantity
--   store_entries.quantity_kg              numeric(12,3)  — quantity
--   project_parcels.land_area              numeric(12,4)  — land area
--   projects.land_area/land_value_per_unit numeric(12,4)  — land area
--   recoverable_advances.*                 numeric(15,2)  — already correct
--   payable_adjustments.*                  numeric(15,2)  — already correct
--
-- GPS coordinates (intentionally real):
--   projects.latitude/longitude, project_parcels.latitude/longitude
--   agreements.gps_lat/gps_lng
--
-- Frozen historical tables (write-once, excluded per Stage 2 spec §7):
--   ownership_snapshots.*, inheritance_history.*, generations.*, backup_*
--
-- No table renames. No column renames. No data rewrites beyond
-- value-preserving ROUND(::numeric, 2). No business-logic changes.
-- ════════════════════════════════════════════════════════════════════════════

COMMIT;

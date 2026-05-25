# NPF Stage 2 — Numeric Precision Foundation: Implementation Report

**Date:** 2026-05-25
**Scope:** `real → numeric(p,s)` column migration + app-layer numeric hardening

---

## 1. Column Inventory

### 1.1 Migrated — `real → numeric(15,2)` (money columns)

Applied via `lib/db/drizzle/0001_npf_stage2_money_precision.sql`:

| Table | Column | Migration |
|---|---|---|
| `agreements` | `land_notional_value` | `real → numeric(15,2)` |
| `contributions` | `amount` | `real → numeric(15,2)` |
| `expenditures` | `amount` | `real → numeric(15,2)` |
| `lca_configs` | `base_amount` | `real → numeric(15,2)` |
| `lca_ledger` | `base_amount`, `gross_due`, `carry_forward`, `total_due`, `amount_paid`, `balance` | `real → numeric(15,2)` |
| `lca_payment_events` | `amount_paid` | `real → numeric(15,2)` |
| `landowner_ledger_entries` | `amount` | `real → numeric(15,2)` |
| `burden_recovery_adjustments` | `amount_recovered`, `recoverable_amount` | `real → numeric(15,2)` |
| `post_maturity_cost_payments` | `amount` | `real → numeric(15,2)` |
| `distribution_previews` | `gross_revenue` | `real → numeric(15,2)` |
| `agreement_accounting_profiles` | `monthly_developer_share`, `monthly_landowner_share` | `real → numeric(15,2)` |
| `production_records` | `selling_price_per_kg` | `real → numeric(15,2)` |

### 1.2 Already-correct plain `numeric()` tables (string-returning, no type change needed)

These tables use plain `numeric()` Drizzle columns (returning strings at ORM level) and were already correctly typed. No DDL was applied:

| Table | Source file |
|---|---|
| `fifty_pct_sessions` | `lib/db/src/schema/fifty_pct.ts` |
| `loss_absorption_accounts` | `lib/db/src/schema/loss_absorption.ts` |
| `multi_store_inventory` | `lib/db/src/schema/multi_store.ts` |
| `ownership_transfers` | `lib/db/src/schema/ownership_transfers.ts` |
| `held_distribution_ledger` | `lib/db/src/schema/held_distribution_ledger.ts` |

### 1.3 Explicitly excluded — GPS coordinates (`real` is correct)

| Table | Columns | Reason |
|---|---|---|
| `projects` | `latitude`, `longitude` | Float is correct for GPS coordinates; rounding to 2dp would destroy precision |
| `project_parcels` | `latitude`, `longitude` | Same |
| `agreements` | `gps_lat`, `gps_lng` | Same |

### 1.4 Explicitly excluded — frozen write-once historical tables

| Table | Reason |
|---|---|
| `ownership_snapshots` | Write-once historical record; altering would break immutability guarantee |
| `inheritance_history` | Write-once audit trail |
| `generations` | Agreement generation snapshots; immutable |
| `backup_*` | Backup tables; excluded per Stage 2 spec §7 |

### 1.5 Non-money numeric columns (already correct precision via `numericFlex`)

| Column pattern | Type | Note |
|---|---|---|
| `*_ownership_pct`, `ownership_share_*` | `numeric(12,8)` | Ownership percentages |
| `*_escalation_pct`, `yearly_escalation` | `numeric(7,4)` | Escalation rates |
| `*_kg`, `production_kg`, `sold_kg` | `numeric(12,3)` | Quantity/weight |
| `land_area`, `land_value_per_unit` | `numeric(12,4)` | Land area |
| `escalation_factor` | `numeric(12,6)` | Compounding factor |
| `recoverable_advances.*`, `payable_adjustments.*` | `numeric(15,2)` | Already correct from initial schema |

---

## 2. App-Layer Hardening

### 2.1 `parseNumeric` frontend helper

- **File:** `artifacts/plantation-web/src/lib/numeric.ts`
- **Signature:** `parseNumeric(value: string | number | null | undefined): number`
- **Returns:** `0` for null/undefined/NaN/empty string

### 2.2 Frontend pages wrapped (12 pages)

All API-sourced decimal fields from plain `numeric()` tables are now parsed through `parseNumeric`:

| Page | Fields wrapped |
|---|---|
| `HeldDistributions` | `principalAmount`, `interestAmount`, `totalDue` |
| `Stores` | `capacityKg`, `occupancyKg`, `occupancyPct`, `balanceValue` |
| `MultiStoreInventory` | `balanceQuantity`, `balanceValue`, `reservedQuantity`, `availableQuantity` |
| `StockTransfer` | `balanceQuantity`, `transferQuantity`, `balanceValue` |
| `DispatchMemo` | `remainingKg`, `totalOrderedKg`, `dispatchedKg`, `valuePerKg`, `totalValue` |
| `MoneyCustody` | `depositedAmount`, `releasedAmount`, `balance` |
| `SettlementGovernance` | `grossRevenue`, `landownerPool`, `totalEppShares`, `sessionAmount` |
| `LNVGovernance` | `landNotionalValue`, `landValuePerUnit`, `perTreeValue` |
| `FiftyPctSettlement` | `grossRevenue`, `landownerPool`, `eppShares`, `participationPct` |
| `SalesOrders` | `quantityKg`, `ratePerKg`, `grossAmount`, `netAmount` |
| `SalesOrderDetail` | `quantityKg`, `ratePerKg`, `totalAmount`, `grossAmount` |
| `OwnershipContinuityDashboard` | `transferPct`, `oldOwnershipPct`, `newOwnershipPct`, `totalOwnership` |

### 2.3 Server hot-path hardening

#### `distributionEngine.ts` — `round2` function

Changed from `Math.round(n * 100) / 100` (floating-point imprecise) to
`toMoney(n).toDecimalPlaces(2).toNumber()` (Decimal.js, banker's rounding via `toDecimalPlaces`).

Import added: `import { toMoney } from "@workspace/db"`.

#### `reportDataService.ts` — aggregation reduces

Replaced all `parseFloat(String(r.field ?? "0"))` patterns with `toN(r.field)` where:
```ts
const toN = (v: unknown): number =>
  toMoney(v as string | number | null | undefined).toNumber();
```

Applies to: financial totals (contributions, expenditures, sales, distributions, settlement records, inventory balances, inflows/outflows, ownership %).

---

## 3. Migration SQL Safety Gate

**File:** `lib/db/drizzle/0001_npf_stage2_money_precision.sql`

The `DO $$` safety gate was strengthened to handle all three DB states:

| State | Behaviour |
|---|---|
| Fresh DB, no data | Proceeds — no audit rows needed, nothing to round |
| Existing DB, no audit table, data present | **FAILS** with `precision_conversion_audit table not found` error |
| Existing DB, audit table present, no matching rows | **FAILS** with `no audit snapshots found` error |
| Existing DB, audit table present, rows found | Proceeds — rounding evidence confirmed |

The fix uses PL/pgSQL exception handling: tries to `SELECT COUNT(*)` from `precision_conversion_audit`; on `undefined_table` exception, dynamically checks for data in key financial tables via `EXECUTE`.

---

## 4. Residual Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| `routes/lca.ts`, `routes/burden.ts` raw `Number()` calls on non-critical display paths | Low | Fields come from `numericFlex` (already `number` type); display-only paths, no accumulation |
| `LNVGovernance.tsx` line 471 `Number(p.landNotionalValue)` | Low | `|| 0` fallback present; `landNotionalValue` typed as `number` via numericFlex |
| Any future schema additions using plain `numeric()` | Low | `parseNumeric` and `toN` helpers are established patterns; enforce in code review |

---

## 5. Rounding Policy

- **Money columns:** `numeric(15,2)` — 15 significant digits, 2 decimal places (paise precision)
- **Ownership %:** `numeric(12,8)` — 8 decimal places (supports fractional percent splits)
- **Escalation rates:** `numeric(7,4)` — 4 decimal places
- **Quantities (kg):** `numeric(12,3)` — 3 decimal places
- **GPS coordinates:** `real` (float4) — intentionally floating-point, no rounding applied
- **Application rounding:** `toMoney(n).toDecimalPlaces(2)` via Decimal.js — avoids IEEE 754 floating-point accumulation errors in financial aggregations

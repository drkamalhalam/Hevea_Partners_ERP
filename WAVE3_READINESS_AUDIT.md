# Wave 3 Readiness Audit
**Against: Wave 3 Design Confirmation Report Revision 4**
**Date: 2026-05-25**
**Scope: Read-only — no code changes made**

---

## Table of Contents
1. [held_distribution_ledger compatibility](#1-held_distribution_ledger-compatibility)
2. [revenue_attribution_lines compatibility](#2-revenue_attribution_lines-compatibility)
3. [partner_financial_ledger compatibility](#3-partner_financial_ledger-compatibility)
4. [ownership_transfers compatibility](#4-ownership_transfers-compatibility)
5. [Governance blocking sources](#5-governance-blocking-sources)
6. [Existing reusable ownership/share logic](#6-existing-reusable-ownershipshare-logic)
7. [Route impact audit](#7-route-impact-audit)
8. [Wave 3 blocker assessment](#8-wave-3-blocker-assessment)
9. [Recommended implementation sequence](#9-recommended-implementation-sequence)

---

## 1. held_distribution_ledger compatibility

**Schema file**: `lib/db/src/schema/held_distribution_ledger.ts`
**Drizzle export**: `heldDistributionLedgerTable`
**DB table name**: `held_distribution_ledger`

### Existing columns

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid PK | NO | `defaultRandom()` |
| `project_id` | uuid FK → projects | NO | `onDelete: restrict` |
| `partner_id` | uuid FK → partners | NO | `onDelete: restrict` |
| `partner_name` | text | NO | denormalized snapshot |
| `hold_type` | text | NO | see values below |
| `source_id` | uuid | YES | FK to source event/session |
| `source_type` | text | YES | `'fifty_pct_session' \| 'sales_transaction' \| 'lca_event' \| 'manual'` |
| `source_description` | text | NO | |
| `period_year` | integer | YES | |
| `held_amount` | numeric(15,2) | NO | INR, 2dp |
| `ownership_pct_at_time` | numeric(12,8) | YES | snapshot for audit |
| `hold_reason` | text | NO | see values below |
| `hold_notes` | text | YES | |
| `status` | text | NO | default `'held'` |
| `released_at` | timestamptz | YES | |
| `released_amount` | numeric(15,2) | YES | |
| `released_to` | text | YES | `'original_partner' \| 'dispute_settlement' \| 'alternative_party' \| 'forfeited'` |
| `release_notes` | text | NO | default `''` |
| `released_by` | uuid FK → users | YES | `onDelete: set null` |
| `released_by_name` | text | YES | |
| `created_by` | uuid FK → users | YES | `onDelete: set null` |
| `created_by_name` | text | YES | |
| `created_at` | timestamptz | NO | `defaultNow()` |
| `updated_at` | timestamptz | NO | `defaultNow()` |

### hold_type values (comment-documented, not a DB enum)
`profit_distribution` | `sale_proceeds` | `lca_credit` | `revenue_entitlement` | `other`

### hold_reason values (comment-documented, not a DB enum)
`ownership_dispute` | `payment_dispute` | `governance_lock` | `inheritance_pending` | `admin_hold`

### Status lifecycle
`held` → `released` | `forfeited`  
Forward-only. `releasedAt` + `status` update in place (NOT write-once — this is a hold management table, not an audit table).

### Blocked-entitlement hold contract (R7–R10)

**Can be implemented without schema changes: YES.**

Mapping:
- `holdType = 'revenue_entitlement'` — use for blocked stock sale entitlement holds
- `sourceType = 'ownership_transfers'` + `sourceId = <transferId>` — traces the hold to the transfer event
- `holdReason = 'governance_lock'` — covers ownership transfer lock scenario
- `ownershipPctAtTime` — captures the contested share % at hold time for audit

**Minor gap identified**: The approved R7–R10 "blocked_entitlement" hold type does not appear explicitly in the `hold_type` comment list. The closest match is `revenue_entitlement`. Implementation must standardize on `revenue_entitlement` (not `other`) so that data health queries and release workflows can filter precisely. Alternatively, `other` plus a consistent `source_type = 'ownership_transfers'` filter works but is less discoverable.

### Missing fields for R7–R10
None required. All fields needed for the approved blocked-entitlement contract exist:
- Source tracing: `source_id` + `source_type` ✅
- Amount: `held_amount` ✅
- Ownership snapshot: `ownership_pct_at_time` ✅
- Release destination: `released_to` ✅
- Audit: `released_by`, `release_notes`, `created_by` ✅

---

## 2. revenue_attribution_lines compatibility

**Schema file**: `lib/db/src/schema/revenue_attribution_lines.ts`
**Drizzle export**: `revenueAttributionLinesTable`
**DB table name**: `revenue_attribution_lines`

### ledger_entry_id nullability

```
ledgerEntryId: uuid("ledger_entry_id"),
```
**Confirmed nullable** — no `.notNull()`, no default. Row 91 of the schema file.

### Delayed back-fill support

The two-phase write (insert RAL → insert PFL → UPDATE RAL.ledger_entry_id) is fully supported:
- `ledgerEntryId` is nullable ✅
- No NOT NULL constraint blocks the initial insert ✅
- No trigger or check constraint requires `ledgerEntryId` to be populated on insert ✅

**No unique index on `ledgerEntryId`** in RAL (unlike `cost_allocation_lines` which has `cal_ledger_entry_uq`). This is correct — the idempotency guard on RAL is the composite unique index `ral_sale_partner_category_uq` on `(saleReferenceType, saleReferenceId, partnerId, revenueCategory)`, not on the back-filled FK.

### Constraints

| Constraint | Definition | Impact |
|---|---|---|
| `ral_sale_partner_category_uq` | UNIQUE (saleReferenceType, saleReferenceId, partnerId, revenueCategory) | Idempotency guard — safe for retry ✅ |
| `ral_amounts_chk` | grossRevenue ≥ 0, costDeduction ≥ 0, net ≥ 0, gross ≥ net ≥ recognized | Values must be non-negative and consistent ✅ |
| `ral_revenue_category_chk` | IN (individual_partner_sale, store_sale, internal_partner_purchase, admin_override_sale, developer_override_sale, future_sale_type) | Category must be one of the V3 set ✅ |
| `ral_executor_chk` | IN (partner, admin, developer, store) | ✅ |
| `ral_deduction_basis_chk` | IN (pro_rata_kg, pro_rata_revenue, flat_split) | ✅ |

**No constraints block the approved delayed back-fill flow.**

### Numeric types
All monetary amounts use `numericFlex` (precision 15, scale 2) aligned with NPF Stage 2. `consumedQuantity` uses `numericFlex(14, 4)` ✅

---

## 3. partner_financial_ledger compatibility

**Schema file**: `lib/db/src/schema/partner_financial_ledger.ts`
**Drizzle export**: `partnerFinancialLedgerTable`
**DB table name**: `partner_financial_ledger`

### reference_secondary_id

```
referenceSecondaryId: uuid("reference_secondary_id"),
```
**Confirmed present and nullable** — row 78, no constraints. Available for sub-event correlation (e.g. sales order dispatch ID pairing with confirm-payment primary reference). ✅

### reverses_entry_id design

```
reversesEntryId: uuid("reverses_entry_id").references(
  (): any => partnerFinancialLedgerTable.id,
  { onDelete: "restrict" },
),
```

- Self-referential FK with `onDelete: restrict` — prevents deleting the original entry while a reversal points to it ✅
- Unique partial index `pfl_reverses_entry_id_uq` WHERE `reversesEntryId IS NOT NULL` — prevents double-reversal of the same entry ✅
- Check constraint `pfl_reversal_link_chk`: any `entryType` containing `'reversal'` MUST have `reversesEntryId IS NOT NULL` — prevents orphan reversal rows ✅

**Reversal entryType coverage**:
`sale_reversal_credit`, `sale_reversal_debit`, `cost_reversal_credit`, `distribution_reversal_credit` — all covered by the check ✅

**Release/reversal workflow compatibility**: Fully supported. A release event would insert a new row referencing the original hold entry via `reversesEntryId`.

### idempotency for revenue_credit

Partial unique index `pfl_revenue_credit_uq` on `(referenceType, referenceId, partnerId)` WHERE `entryType = 'revenue_credit' AND referenceId IS NOT NULL`. Prevents double-credit on retried attribution. ✅

### Schema blockers

**None identified.**

---

## 4. ownership_transfers compatibility

**Schema file**: `lib/db/src/schema/ownership_transfers.ts`
**Drizzle export**: `ownershipTransfersTable`
**DB table name**: `ownership_transfers`

### Stock entitlement handling fields

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `stock_entitlement_handling` | text | YES | `null \| 'retain_with_seller' \| 'transfer_to_buyer'` |
| `stock_entitlement_kg` | numeric(12,3) | YES | total stored stock at effective date |
| `stock_entitlement_retained_kg` | numeric(12,3) | YES | kg retained by seller |
| `stock_entitlement_transferred_kg` | numeric(12,3) | YES | kg transferred to buyer |
| `stock_entitlement_notes` | text | YES | |

All four approved fields are present ✅. The sum constraint `retained_kg + transferred_kg = stock_entitlement_kg` is documented in comments but NOT enforced by a DB check constraint — validation must be enforced at the API layer.

### Multi-transfer chain algorithm

The schema provides sufficient data to reconstruct a transfer chain:
- `transferor_partner_id` + `buyer_partner_id` (nullable for third_party) ✅
- `effective_date` (date, nullable) ✅
- `linked_snapshot_id` → ownership snapshot at submission ✅
- `offered_percentage` ✅

**Gap**: No `previous_transfer_id` or `chain_root_id` column. Multi-transfer chain detection must be computed by the API layer by querying all `ownership_transfers` for a given partner across a project, ordered by `effective_date`. This is an API concern, not a schema blocker. The approved multi-transfer chain algorithm can be implemented from existing data.

### Enums

`ownershipTransferTypeEnum`: `internal` | `third_party` ✅
`ownershipTransferStatusEnum`: `draft` → `pending_rofr` → `rofr_accepted` | `rofr_rejected` → `pending_approval` → `approved` → `executed`; `cancelled`; `expired` ✅

**No schema blockers.**

---

## 5. Governance blocking sources

### governance_overrides

**Table**: `governance_overrides`
**Export**: `governanceOverridesTable`
**Names match approved design** ✅

Key fields:
- `override_type` (text, not enum) — current documented values: settlement_distribution, settlement_finalized, settlement_reopened, contribution_dispute_resolved, contribution_dispute_rejected, lca_ledger_adjustment, transfer_price_override, **ownership_transfer**, expenditure_approved, expenditure_rejected, governance_manual_note
- `module` (text) — values: contributions | expenditures | settlement | lca | ownership | valuations | governance — does **not** include `attribution` or `wave3`
- `related_table` (text) + `related_record_id` (text — **NOT uuid**) — FK is text-typed; UUID strings work but no DB-level FK enforcement

**Naming difference**: `related_record_id` is TEXT not UUID. Wave 3 handlers writing override records for attribution events must cast UUIDs to string — not a blocker.

**Gap**: `module` does not have an `attribution` value. Wave 3 attribution overrides should use `module = 'ownership'` to stay within the existing set, or a new module value must be agreed upon before implementation.

### prematurity_succession

**Naming difference — IMPORTANT:**

The approved design references `prematurity_succession` as if it were a single table. The actual schema contains **three separate tables**:

| Actual table name | Export | Purpose |
|---|---|---|
| `claimant_participation_records` | `claimantParticipationRecordsTable` | Per-(claimId, claimantId) participation activation |
| `claimant_contributions` | `claimantContributionsTable` | OTP-verified contributions during succession |
| `disputed_accumulation_ledger` | `disputedAccumulationLedgerTable` | Held amounts during active dispute |

Any Wave 3 route or query that checks for "active prematurity succession blocks" must query:
- `claimant_participation_records WHERE participation_status IN ('active', 'disputed')` for active participants
- `disputed_accumulation_ledger WHERE status = 'accumulating'` for held amounts

There is no single `prematurity_succession` table to query.

`participationStatus` values: `active` | `disputed` | `suspended` | `resolved` | `withdrawn`

### Inheritance-related blocking sources

| Concern | Actual table | Actual export | Approved design name |
|---|---|---|---|
| Claims | `inheritance_claims` | `inheritanceClaimsTable` | inheritance_claims ✅ |
| Claimant shares | `inheritance_claimant_shares` | `inheritanceClaimantSharesTable` | inheritance_claimant_shares ✅ |
| Ownership history | `inheritance_ownership_history` | `inheritanceOwnershipHistoryTable` | **inheritance_history** ❌ |
| Succession documents | `inheritance_documents` | `inheritanceDocumentsTable` | ✅ |

**Critical naming difference**: The actual table is `inheritance_ownership_history` (export: `inheritanceOwnershipHistoryTable`). The approved design references it as `inheritance_history`. Any Wave 3 code or query using `inheritance_history` will fail. Use `inheritanceOwnershipHistoryTable` from `@workspace/db`.

`inheritanceClaimStatusEnum` values: `open` | `under_review` | `pending_documents` | `pending_approval` | `approved` | `rejected` | `disputed`

For Wave 3 blocking: check `inheritance_claims WHERE status IN ('open', 'under_review', 'pending_documents', 'pending_approval', 'disputed')` to identify in-progress claims that may block distribution to the affected partner.

---

## 6. Existing reusable ownership/share logic

### sharesFromSnapshot — confirmed present

**Location**: `artifacts/api-server/src/lib/distributionEngine.ts`, line 202

```typescript
export function sharesFromSnapshot(
  entries: OwnershipSnapshotEntry[],
  landownerPartnerId?: string | null,
  developerPartnerId?: string | null,
): ContributionModelInputs["ownerShares"]
```

Maps ownership snapshot JSONB entries to role-annotated share objects with `partnerKey`, `partnerId`, `partnerName`, `role`, `percentage`. ✅

**Reuse point for Wave 3**: Call `sharesFromSnapshot(snapshot.entries, agreement.landownerPartnerId, project.developerPartnerId)` to produce the per-partner share array needed by `calculateContributionDistribution`. No duplication needed.

### sharesFromAgreement — two-party model only

**Location**: same file, line 230

Takes explicit `landownerId/pct` + `developerId/pct` parameters. This is the **legacy two-party model** helper — do NOT use for Wave 3 multi-partner attribution; use `sharesFromSnapshot` instead.

### calculateContributionDistribution / calculateFiftyPercentDistribution

**Location**: `artifacts/api-server/src/lib/distributionEngine.ts`, lines 57 / 141

Pure functions with no DB side effects. Take typed inputs and return per-partner distribution amounts. Fully reusable from Wave 3 attribution handler. ✅

### round2 — duplication risk

**Location**: `artifacts/api-server/src/lib/distributionEngine.ts`, line 258 (private function)

```typescript
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

This is the **float-based rounding helper** that NPF Stage 2 replaced with the `toMoney`/`fromMoney`/`sumMoney` utility in `@workspace/db`. All new Wave 3 code that calls `calculateContributionDistribution` or `calculateFiftyPercentDistribution` and then writes monetary results to PFL/RAL must use the `@workspace/db` money utility for the final write, not propagate `round2` results directly.

**Recommendation**: Wave 3 should NOT call `round2` directly. All monetary amounts flowing into `partner_financial_ledger.amount` and `revenue_attribution_lines.*Amount` columns must go through `toMoney()` for precision normalization before insert.

**Duplication risk**: If `distributionEngine.ts` itself is not updated to use the money utility, callers that pipe its outputs into PFL inserts will silently carry float precision risk. This is a pre-implementation concern, not a blocker for the schema layer.

---

## 7. Route impact audit

### sales.ts — event publication hook locations

**File**: `artifacts/api-server/src/routes/sales.ts`

| Route | Handler location | Hook status |
|---|---|---|
| `POST /sales` (create) | Line 296 | No emission — correct, creation alone is not a recognition event |
| `POST /sales/:id/confirm` | Line 595 | **`emitSaleRecognized` already wired at line 726** ✅ — inside a non-fatal try/catch |
| `POST /sales/:id/cancel` | Line 956 | **No reversal hook** — gap for Wave 3 |
| Other mutation routes | Lines 741, 790, 867, 1011, 1070 | Line item / deduction CRUD — no attribution hooks needed |

**Exact insertion point for confirm hook** (already implemented):

```
Line 725: // ── V3 Wave 3: sale-event emission (flag-gated, no-op when flags OFF) ─────
Line 726: emitSaleRecognized(db, {
Line 727:   saleTxId: txId,
Line 728:   projectId: updated.projectId,
Line 729:   recognizedAt: updated.confirmedAt ?? new Date(),
           ...
Line 732: });
```

**Gap — cancellation reversal**: `POST /sales/:id/cancel` (around line 956) has no `emitSaleCancelled` or reversal hook. If `emitSaleRecognized` ran on confirm, a cancellation must trigger reversal entries in PFL. Hook insertion point: immediately after the `UPDATE salesTransactionsTable SET status = 'cancelled'` call completes and before the final `writeSaleAudit`.

### sales_orders_v2.ts — event publication hook locations

**File**: `artifacts/api-server/src/routes/sales_orders_v2.ts`

| Route | Handler location | Hook status |
|---|---|---|
| `POST /` (create order) | Line 168 | No emission — correct |
| `POST /:id/confirm-payment` | Line 367 | **`emitSaleRecognized` already wired at line 519** ✅ — inside non-fatal try/catch |
| `POST /:id/dispatch` | Line 596 | No attribution hook — **correct**, dispatch is a fulfillment event, not a revenue event |
| `POST /:id/cancel` | Line 540 | **No reversal hook** — gap for Wave 3 |
| `POST /admin/expire-reservations` | Line 697 | Administrative — no hook needed |
| `POST /admin/reconcile-bridges` | Line 732 | Administrative — no hook needed |

**Exact insertion point for confirm-payment hook** (already implemented):

```
Line 510: // ── V3 Wave 3: sale-event emission on bridge record (flag-gated) ─────
Line 519: emitSaleRecognized(db, { ... });
Line 525: // emitSaleRecognized failed (non-fatal)
```

**Gap — cancellation reversal**: `POST /:id/cancel` has no `emitSaleCancelled`. Hook insertion point: after status update to `cancelled`, if the order was previously `confirm-payment` processed (i.e., `emitSaleRecognized` may have run).

---

## 8. Wave 3 blocker assessment

### Classification: NO MAJOR BLOCKERS

The schema layer is ready for Wave 3 implementation. All four core tables exist, are structurally correct, and require no DDL changes before implementation can begin.

### Minor blockers (implementation notes — resolve before implementation)

| # | Area | Issue | Resolution |
|---|---|---|---|
| M1 | held_distribution_ledger | `holdType = 'blocked_entitlement'` not in the documented value list | Standardize on `holdType = 'revenue_entitlement'` for R7–R10 stock blocks and document it in the route handler comment |
| M2 | governance_overrides | `module` column has no `attribution` value | Use `module = 'ownership'` for Wave 3 attribution overrides, or extend the comment list before implementation |
| M3 | governance_overrides | `related_record_id` is TEXT not uuid | Cast UUID to string when writing — no schema change needed |
| M4 | prematurity_succession | Design references single table; actual schema is three tables | All Wave 3 queries must use `claimant_participation_records`, `claimant_contributions`, `disputed_accumulation_ledger` |
| M5 | inheritance_ownership_history | Design references `inheritance_history`; actual table is `inheritance_ownership_history` | Use `inheritanceOwnershipHistoryTable` from `@workspace/db` import |
| M6 | distributionEngine.ts | Private `round2` is float-based; inconsistent with NPF Stage 2 money utility | All monetary writes from Wave 3 attribution handler must go through `toMoney()`/`fromMoney()` before PFL/RAL insert |
| M7 | sales.ts + sales_orders_v2.ts | No cancellation reversal hook in either route | Must add `emitSaleCancelled` hook at cancellation endpoints before attribution is enabled |
| M8 | ownership_transfers | `retained_kg + transferred_kg = stock_entitlement_kg` not enforced by DB check | Enforce in API layer at PATCH handler |

### No blockers

- `revenue_attribution_lines.ledger_entry_id` is nullable — delayed back-fill works ✅
- `partner_financial_ledger.reference_secondary_id` exists ✅
- `partner_financial_ledger.reverses_entry_id` self-reference with unique partial index ✅
- All stock entitlement fields on `ownership_transfers` exist ✅
- `sharesFromSnapshot` exists and is exportable ✅
- `emitSaleRecognized` hooks already wired in both sales routes ✅

---

## 9. Recommended implementation sequence

Listed in dependency order. Each step assumes the previous is merged and typechecking cleanly.

| Step | File | Work |
|---|---|---|
| 1 | `artifacts/api-server/src/lib/revenueHandler/categorize.ts` | Verify / complete sale event categorization — must cover all `saleReferenceType` values including `sales_order` (V2 bridge flow) |
| 2 | `artifacts/api-server/src/lib/revenueHandler/processOne.ts` | Implement attribution writer: `sharesFromSnapshot` → per-partner amounts → insert RAL → insert PFL → back-fill RAL.ledgerEntryId. Use `@workspace/db` money utility throughout. |
| 3 | `artifacts/api-server/src/lib/revenueHandler/processPending.ts` | Implement batch re-processor for flag-gated backfill of existing confirmed sales |
| 4 | `artifacts/api-server/src/routes/sales.ts` | Add `emitSaleCancelled` reversal hook at `POST /:id/cancel` (after status update, before `writeSaleAudit`) |
| 5 | `artifacts/api-server/src/routes/sales_orders_v2.ts` | Add `emitSaleCancelled` reversal hook at `POST /:id/cancel` (if confirm-payment attribution was already emitted) |
| 6 | `artifacts/api-server/src/routes/held_distribution.ts` | New route file: CRUD for hold creation + release. Hold creation uses `holdType = 'revenue_entitlement'`, `sourceType = 'ownership_transfers'`. Release writes PFL `distribution_reversal_credit`. |
| 7 | `artifacts/api-server/src/lib/distributionEngine.ts` | Update `round2` → money utility, or add a wrapper that converts distribution outputs to `Decimal` before returning. Prevents float drift in the share calculation pipeline. |
| 8 | `lib/api-spec/openapi.yaml` | Add paths for: `/held-distribution`, `/partner-financial-ledger`, `/revenue-attribution-lines`, attribution summary endpoints |
| 9 | `pnpm --filter @workspace/api-spec run codegen` | Regenerate React Query hooks from updated spec |
| 10 | Frontend pages for PFL balance + attribution drill-down | After codegen; depends on finalized OpenAPI schemas |

**Feature flag gates** (existing in `revenueHandler`):
- `emission_flag` — controls whether `emitSaleRecognized` publishes a sale event (currently OFF in production)
- `attribution_flag` — controls whether `processOne` writes RAL + PFL rows (currently OFF)

Enable `emission_flag` first in staging, validate event shape, then enable `attribution_flag`. Do not enable both simultaneously in a single deploy.

---

*End of Wave 3 Readiness Audit. No files were modified during this audit.*

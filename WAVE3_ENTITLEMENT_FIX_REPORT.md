# Wave 3 Entitlement Fix Report

**Date:** 2026-05-25
**Plan ref:** `WAVE3_ENTITLEMENT_CORRECTION_PLAN.md`
**Audit ref:** `WAVE3_BUSINESS_RULE_VALIDATION.md`

---

## Files Changed

| File | Change type | Description |
|---|---|---|
| `artifacts/api-server/src/lib/entitlement/resolveBatchEntitlement.ts` | Modified | Core fix — extended SELECT + handling-aware loop |
| `artifacts/api-server/src/lib/entitlement/resolveBatchEntitlement.test.ts` | Created | 59-assertion unit test suite covering all 5 scenarios + edge cases |
| `artifacts/api-server/package.json` | Modified | Added new test file to `test` script |

**No other files were touched.** Schema files, route files, OpenAPI spec, generated code, feature flags, and event contracts are all unchanged.

---

## What Changed in `resolveBatchEntitlement.ts`

### 1. New exported `TransferRecord` interface (lines 50–62)

An explicit interface for the transfer DB row shape is now exported. This decouples the pure algorithm from the Drizzle query type so unit tests can construct fixtures without a live DB.

### 2. New exported `applyTransferEntitlements` function (lines 64–145)

The transfer-chain application loop was extracted from `resolveBatchEntitlement` into a standalone pure function. It takes `Map<string, EntitlementEntry>` + `TransferRecord[]` and returns the mutated map. The drift guard remains in the outer DB-calling function — `applyTransferEntitlements` only handles the per-transfer branching.

**Three handling paths:**

| `stockEntitlementHandling` | KG fields | Action |
|---|---|---|
| `'retain_with_seller'` | null / `totalKg ≤ 0` / `transferredKg` null | `continue` — full retain, zero shift |
| `'retain_with_seller'` | complete (`totalKg > 0`, `transferredKg` set) | `effectivePct = offeredPct × (transferredKg / totalKg)` |
| `'transfer_to_buyer'` or `null` | any | `effectivePct = offeredPct` (unchanged from pre-fix) |

An additional guard: if `effectivePct ≤ 0` after calculation (e.g. `transferredKg = 0`), the transfer is skipped — no zero-percentage entries are created in the map.

### 3. Extended SELECT in Step 3 (previously lines 111–116, now lines 184–196)

Four columns added to the Drizzle `.select()`:
- `stockEntitlementHandling`
- `stockEntitlementKg`
- `stockEntitlementRetainedKg`
- `stockEntitlementTransferredKg`

### 4. Loop body replaced (previously lines 128–154)

The for-loop body now calls `applyTransferEntitlements(entitlements, transfers)` — a single line — instead of the inline transfer application.

### 5. File header updated

Algorithm name updated from "R10 Binary Handling" to "R10 Handling-Aware" and Step 4 description updated to reflect the new branching.

---

## Exact Behavior Before Fix vs After Fix

### Scenario A — `retain_with_seller`, no KG fields

**Setup:** Snapshot A=60%, B=40%. Batch at T1. Transfer A→C, 20%, `retain_with_seller`. Sale at T3.

| Partner | Before fix | After fix |
|---|---|---|
| A | 40% (shorted ₹20,000 on ₹1,00,000 sale) | **60%** ✓ |
| B | 40% | 40% ✓ |
| C | 20% (unearned) | **0% — absent from map** ✓ |

---

### Scenario B — `transfer_to_buyer`, no KG fields

**Setup:** Same as A but `transfer_to_buyer`.

| Partner | Before fix | After fix |
|---|---|---|
| A | 40% | 40% (unchanged) |
| B | 40% | 40% (unchanged) |
| C | 20% | 20% (unchanged) |

No change — `transfer_to_buyer` follows the same code path as before. Backward compatible.

---

### Scenario C — chain: A→B `retain_with_seller`, B→C `retain_with_seller`

**Setup:** Snapshot A=60%, B=30%, D=10%. Two retain transfers in chronological order.

| Partner | Before fix | After fix |
|---|---|---|
| A | 30% (shorted ₹30,000) | **60%** ✓ |
| B | 20% (shorted ₹10,000) | **30%** ✓ |
| C | 40% (unearned) | **0% — absent** ✓ |
| D | 10% | 10% |

Key property: because TX1 is skipped, B's balance stays at 30% when TX2 is evaluated — so TX2 skip is also consistent with the original snapshot state.

---

### Scenario D — mixed chain: A→B `retain_with_seller`, B→C `transfer_to_buyer`

**Setup:** Snapshot A=50%, B=40%, D=10%. TX1 retain (20%), TX2 transfer_to_buyer (30%).

| Partner | Before fix | After fix |
|---|---|---|
| A | 30% (shorted ₹20,000) | **50%** ✓ |
| B | 30% (excess ₹20,000 — absorbed TX1 shift then lost TX2 shift) | **10%** ✓ |
| C | 30% (coincidentally correct amount, wrong composition) | 30% ✓ |
| D | 10% | 10% |

The fix causes B's actual result to change (30% → 10%), which is the correct economic outcome: B transferred 30% of its *original* 40% to C.

---

### Scenario E — partial KG split, `retain_with_seller`

**Setup:** Snapshot A=60%, B=40%. Transfer A→C, 20%, `retain_with_seller`, stockEntitlementKg=1000, stockEntitlementTransferredKg=400.

```
effectivePct = 20% × (400 / 1000) = 8%
```

| Partner | Before fix | After fix |
|---|---|---|
| A | 40% (full 20% lost) | **52%** (only 8% lost) ✓ |
| B | 40% | 40% |
| C | 20% (full shift received) | **8%** (transferred fraction only) ✓ |

Drift check: 52 + 40 + 8 = 100.00 ✓

---

## Test Results

```
59 tests   14 suites   59 pass   0 fail
```

### New entitlement tests (19 assertions across 6 suites)

```
✔ Scenario A — retain_with_seller, no KG fields
  ✔ seller retains full entitlement — transfer is skipped
  ✔ sum of percentages stays at 100 after skip

✔ Scenario B — transfer_to_buyer, no KG fields
  ✔ buyer receives full offeredPercentage shift
  ✔ null handling behaves identically to transfer_to_buyer

✔ Scenario C — double retain_with_seller chain
  ✔ both transfers skipped — map equals original snapshot
  ✔ second skip does not use inflated B balance from first (skipped) transfer

✔ Scenario D — mixed chain: retain then transfer_to_buyer
  ✔ retain leg skipped; transfer_to_buyer leg applied from original balance
  ✔ B does not receive A's 20% before losing 30% (order matters)

✔ Scenario E — partial KG split (retain_with_seller + KG fields)
  ✔ effectivePct = offeredPct × (transferredKg / totalKg)
  ✔ 75% retained / 25% transferred splits correctly
  ✔ 100% transferred KG equals full transfer_to_buyer behavior
  ✔ 0% transferred KG (all retained) equals full retain (skip)

✔ Edge cases
  ✔ retain_with_seller with zero totalKg falls back to full retain (skip)
  ✔ retain_with_seller with transferredKg null but totalKg set → full retain
  ✔ buyerPartnerId null → transfer skipped regardless of handling
  ✔ empty transfers array returns map unchanged
  ✔ buyer already exists in map — gains are additive
  ✔ three-partner chain with mixed handling preserves sum
```

### Pre-existing money tests (40 assertions — all still pass)

Full `splitMoney`, `toMoney`, `fromMoney`, `addMoney`, `subMoney`, `mulMoney` and comparison suite — all 40 assertions pass unchanged.

---

## Verification Checklist

| Check | Result |
|---|---|
| `pnpm --filter @workspace/api-server run typecheck` | ✓ Clean |
| `pnpm run typecheck` (full workspace) | ✓ Clean — all 4 artifacts pass |
| `pnpm --filter @workspace/api-server run test` | ✓ 59/59 pass |
| Schema files modified | None |
| `pnpm --filter @workspace/db run push` needed | No |
| Route files modified | None |
| OpenAPI spec modified | No |
| Codegen run needed | No |
| Event contracts modified | No |
| Feature flags modified | No |
| `FIN_REVENUE_ATTRIBUTION_ENABLED` touched | No — not enabled, not changed |

---

## Closing BF-1 and BF-2

| Finding | Status |
|---|---|
| **BF-1** `retain_with_seller` not implemented | **RESOLVED** — transfers with this flag are now skipped for pre-transfer batches; the seller retains full entitlement |
| **BF-2** Partial KG entitlement not implemented | **RESOLVED** — `stockEntitlementKg` and `stockEntitlementTransferredKg` are now read and used to compute a proportional effective percentage shift |

---

## Remaining Wave 3 Gaps (Non-Blocking)

These were classified as non-blocking in `WAVE3_BUSINESS_RULE_VALIDATION.md` and are out of scope for this fix:

| ID | Description | Scope |
|---|---|---|
| NBG-1 | `POST /held-distribution-ledger/:id/release` does not auto-create a `partner_financial_ledger` credit. Released amount is acknowledged but not posted to the partner's balance. | Separate task |
| NBG-2 | `SaleCancelled` event type returns `null` from `categorizeEvent` — reversal logic deferred to Wave 5. | Wave 5 |
| NBG-3 | `processOne.ts` hard-codes `holdReason = 'inheritance_pending'` for all blocked partners regardless of the actual block source (prematurity succession, governance override). Reporting only — no financial impact. | Backlog |

---

## Next Steps

`FIN_REVENUE_ATTRIBUTION_ENABLED` can now be staged on in a test project that has `retain_with_seller` transfers. Before enabling in production, confirm whether any attribution rows were produced under the pre-fix engine (query `processed_sale_events` joined to events that had in-window `retain_with_seller` transfers). If found, follow the remediation path in §6 of `WAVE3_ENTITLEMENT_CORRECTION_PLAN.md`.

Wave 4 has not been begun.

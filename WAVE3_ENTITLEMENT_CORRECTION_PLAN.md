# Wave 3 Entitlement Correction Plan

**Date:** 2026-05-25
**Scope:** Corrective implementation design for BF-1 and BF-2 from `WAVE3_BUSINESS_RULE_VALIDATION.md`.
**Instruction:** Design only — no code was modified.

---

## 1. Where the Transfer Chain Is Applied Today

All transfer logic lives in **`artifacts/api-server/src/lib/entitlement/resolveBatchEntitlement.ts`**.
Step 3 occupies lines 105–155. Within that block:

```
Line 106:   if (batchCreatedAt !== null) {          ← guard: skipped for unbatched sales
Lines 110–126:  db.select(…).from(ownershipTransfersTable)  ← transfer query
Lines 128–154:  for (const tx of transfers) {        ← application loop
  Line 129:   if (!tx.buyerPartnerId) continue;
  Line 131:   const pct = new Decimal(tx.offeredPercentage ?? "0");
  Lines 133–138:  transferor loses pct
  Lines 141–153:  buyer gains pct (or is created with pct)
```

**The SELECT at lines 111–116 fetches exactly four columns:**

```typescript
{
  transferorPartnerId: ownershipTransfersTable.transferorPartnerId,
  buyerPartnerId:      ownershipTransfersTable.buyerPartnerId,
  buyerName:           ownershipTransfersTable.buyerName,
  offeredPercentage:   ownershipTransfersTable.offeredPercentage,
}
```

`stockEntitlementHandling`, `stockEntitlementKg`, `stockEntitlementRetainedKg`, and
`stockEntitlementTransferredKg` are **absent from this SELECT and absent from the WHERE clause**.
The loop therefore applies every executed transfer in the date window with no inspection of these fields.

---

## 2. BF-1 — Corrected Algorithm for `retain_with_seller`

### 2.1 Semantic Rule

`stockEntitlementHandling` on a transfer record controls how pre-transfer stock is attributed:

| Value | Meaning | Engine action |
|---|---|---|
| `null` | Not configured — backward-compatible default | Apply full `offeredPercentage` shift (current behavior) |
| `transfer_to_buyer` | New owner receives revenue from pre-transfer stock | Apply full `offeredPercentage` shift (current behavior) |
| `retain_with_seller` | Old owner retains revenue from pre-transfer stock | Do NOT shift entitlement (see §2.2) |

The rule applies **only to pre-transfer batches** — batches whose `batchCreatedAt < transfer.effectiveDate`. This is exactly the population Step 3 operates on. Post-transfer batches are unaffected (they use a later baseline snapshot where the transfer has already been folded in).

### 2.2 Corrected Step 3 Logic

**Required SELECT additions (lines 111–116):**

```typescript
stockEntitlementHandling:     ownershipTransfersTable.stockEntitlementHandling,
stockEntitlementKg:           ownershipTransfersTable.stockEntitlementKg,
stockEntitlementRetainedKg:   ownershipTransfersTable.stockEntitlementRetainedKg,
stockEntitlementTransferredKg: ownershipTransfersTable.stockEntitlementTransferredKg,
```

**Corrected application loop (replaces lines 128–154):**

```
for each tx in transfers (chronological):
  if tx.buyerPartnerId is null → skip (third-party with no buyer on record)

  if tx.stockEntitlementHandling == 'retain_with_seller':
    if KG fields are complete (stockEntitlementKg > 0 AND stockEntitlementTransferredKg is not null):
      effectivePct = tx.offeredPercentage × (stockEntitlementTransferredKg / stockEntitlementKg)
      apply effectivePct shift  (transferor loses effectivePct, buyer gains effectivePct)
    else:
      skip (full retain — do not shift any entitlement for this batch)

  else:  // null OR 'transfer_to_buyer'
    effectivePct = tx.offeredPercentage
    apply effectivePct shift  (unchanged from current behavior)
```

The drift guard at lines 157–170 continues to operate on the final map and requires no changes. Because `effectivePct` is symmetric (transferor loses exactly what buyer gains), total ownership percentage remains at 100 regardless of which handling path is taken.

### 2.3 Edge Cases

| Case | Design decision |
|---|---|
| `handling = null` | Treat as `transfer_to_buyer`. Current behavior preserved. Backward compatible. |
| `handling = 'retain_with_seller'`, KG fields all null | Full retain — skip transfer. No effectivePct shift. |
| `handling = 'retain_with_seller'`, `stockEntitlementKg = 0` | Full retain — skip transfer (division by zero avoided). |
| `handling = 'retain_with_seller'`, `stockEntitlementKg` set but `stockEntitlementTransferredKg` null | Fall back to full retain — partial data, conservative path. |
| `handling = 'transfer_to_buyer'`, KG fields populated | Ignore KG fields — KG fields are only meaningful under `retain_with_seller`. Full pct applied. |
| `stockEntitlementRetainedKg + stockEntitlementTransferredKg ≠ stockEntitlementKg` | Use `transferredKg / totalKg` ratio directly. Enforcement of the sum constraint is a data validation concern (API route), not an engine concern. |

---

## 3. Worked Examples — Pre-Fix vs Post-Fix

In all examples below:
- `T0 < T1 < T2 < T3 < T4` (chronological)
- Snapshot is always taken at T0
- Batch is always created at T1 (so `batchCreatedAt = T1`)
- Sale is recognized at the final T (so Step 3 applies transfers in the window `(T1, T_sale]`)
- Gross sale amount is ₹1,00,000 with no deductions for clarity

---

### Scenario A — `retain_with_seller` (no KG fields)

```
Snapshot S0 at T0:   A = 60%,  B = 40%
Batch B1 at T1
TX1 at T2:  A → C,  offeredPct = 20%,  retain_with_seller,  KG fields = null,  executed
Sale recognized at T3
```

**Pre-fix (current) Step 3 trace:**
```
TX1 found in (T1, T3]:
  stockEntitlementHandling NOT examined
  A: 60% − 20% = 40%
  C:  0% + 20% = 20%
Result: { A: 40%,  B: 40%,  C: 20% }
```

| Partner | Pre-fix % | Pre-fix Revenue |
|---|---|---|
| A | 40% | ₹40,000 ← shorted ₹20,000 |
| B | 40% | ₹40,000 |
| C | 20% | ₹20,000 ← unearned |

**Post-fix Step 3 trace:**
```
TX1 found in (T1, T3]:
  stockEntitlementHandling = 'retain_with_seller'
  KG fields: all null → full retain → SKIP TX1
Result: { A: 60%,  B: 40% }
```

| Partner | Post-fix % | Post-fix Revenue |
|---|---|---|
| A | 60% | ₹60,000 ✓ |
| B | 40% | ₹40,000 ✓ |
| C | 0% | ₹0 ✓ |

---

### Scenario B — `transfer_to_buyer` (no KG fields)

```
Same setup as A but TX1.stockEntitlementHandling = 'transfer_to_buyer'
```

**Pre-fix Step 3 trace:**
```
TX1 found: apply full 20% shift → { A: 40%, B: 40%, C: 20% }
```

**Post-fix Step 3 trace:**
```
TX1 found:
  stockEntitlementHandling = 'transfer_to_buyer' → full pct path
  Apply 20% shift → { A: 40%, B: 40%, C: 20% }
```

| Partner | Pre-fix % | Post-fix % | Change? |
|---|---|---|---|
| A | 40% | 40% | None |
| B | 40% | 40% | None |
| C | 20% | 20% | None |

**Behavior is identical before and after the fix.** `transfer_to_buyer` is the default code path; no change is required. The fix is backward compatible for this flag value.

---

### Scenario C — Chain: A→B `retain_with_seller`, B→C `retain_with_seller`

```
Snapshot S0 at T0:   A = 60%,  B = 30%,  D = 10%
Batch B1 at T1
TX1 at T2:  A → B,  offeredPct = 30%,  retain_with_seller,  executed
  (Post-TX1 live ownership: A=30%, B=60%, D=10%)
TX2 at T3:  B → C,  offeredPct = 40%,  retain_with_seller,  executed
  (B had 60% post-TX1, transfers 40%)
Sale recognized at T4
```

**Pre-fix Step 3 trace:**
```
TX1 (T2): A: 60−30=30%,  B: 30+30=60%
TX2 (T3): B: 60−40=20%,  C:  0+40=40%
Result: { A: 30%,  B: 20%,  C: 40%,  D: 10% }
```

| Partner | Pre-fix % | Pre-fix Revenue |
|---|---|---|
| A | 30% | ₹30,000 ← shorted ₹30,000 |
| B | 20% | ₹20,000 ← shorted ₹10,000 |
| C | 40% | ₹40,000 ← unearned (C had 0% when stock was produced) |
| D | 10% | ₹10,000 |

**Post-fix Step 3 trace:**
```
TX1 (T2): retain_with_seller, KG null → SKIP
TX2 (T3): retain_with_seller, KG null → SKIP
Result: { A: 60%,  B: 30%,  D: 10% }
```

| Partner | Post-fix % | Post-fix Revenue |
|---|---|---|
| A | 60% | ₹60,000 ✓ |
| B | 30% | ₹30,000 ✓ |
| C | 0% | ₹0 ✓ |
| D | 10% | ₹10,000 ✓ |

**Key property:** Because both links skip, the second `retain_with_seller` skips even though the first
transfer did NOT create a C entry in the map. The algorithm is order-safe: skipping TX1 means
B's balance stays at 30%, not 60%, so the TX2 skip is consistent with the baseline map.

---

### Scenario D — Mixed Chain: A→B `retain_with_seller`, B→C `transfer_to_buyer`

```
Snapshot S0 at T0:   A = 50%,  B = 40%,  D = 10%
Batch B1 at T1
TX1 at T2:  A → B,  offeredPct = 20%,  retain_with_seller,  executed
  (Post-TX1 live ownership: A=30%, B=60%, D=10%)
TX2 at T3:  B → C,  offeredPct = 30%,  transfer_to_buyer,   executed
  (B has 60% post-TX1, transfers 30% to C)
Sale recognized at T4
```

**Pre-fix Step 3 trace:**
```
TX1 (T2): A: 50−20=30%,  B: 40+20=60%
TX2 (T3): B: 60−30=30%,  C:  0+30=30%
Result: { A: 30%,  B: 30%,  C: 30%,  D: 10% }
```

| Partner | Pre-fix % | Pre-fix Revenue |
|---|---|---|
| A | 30% | ₹30,000 ← shorted ₹20,000 |
| B | 30% | ₹30,000 ← excess ₹20,000 (from incorrect TX1 application) |
| C | 30% | ₹30,000 |
| D | 10% | ₹10,000 |

**Post-fix Step 3 trace:**
```
TX1 (T2): retain_with_seller, KG null → SKIP
  Map remains: { A: 50%, B: 40%, D: 10% }

TX2 (T3): transfer_to_buyer → apply full 30% shift from B → C
  B: 40% − 30% = 10%
  C:  0% + 30% = 30%
Result: { A: 50%,  B: 10%,  C: 30%,  D: 10% }
Sum: 50 + 10 + 30 + 10 = 100  ✓
```

| Partner | Post-fix % | Post-fix Revenue |
|---|---|---|
| A | 50% | ₹50,000 ✓ (TX1 skipped — A retains pre-transfer stake) |
| B | 10% | ₹10,000 ✓ (B transferred 30% to C, retained 10% of original 40%) |
| C | 30% | ₹30,000 ✓ (transfer_to_buyer honored) |
| D | 10% | ₹10,000 ✓ |

**Critical note:** C's revenue changes from ₹30,000 to ₹30,000 (same amount) in this specific setup,
but the composition is correct: C gets 30% of B's *original* 40% (because TX1 was skipped), not
30% of B's inflated post-TX1 60%. B's balance drops to 10% instead of 30%.

---

### Scenario E — Partial Retained / Transferred KG Split

```
Snapshot S0 at T0:   A = 60%,  B = 40%
Batch B1 at T1
TX1 at T2:  A → C,  offeredPct = 20%,  retain_with_seller
  stockEntitlementKg           = 1000 kg
  stockEntitlementRetainedKg   =  600 kg   (seller retains revenue on 600kg of stored stock)
  stockEntitlementTransferredKg =  400 kg   (buyer receives revenue on 400kg of stored stock)
Sale recognized at T3
```

**Post-fix Step 3 trace:**
```
TX1 found in (T1, T3]:
  stockEntitlementHandling = 'retain_with_seller'
  KG fields complete: totalKg = 1000,  transferredKg = 400

  transferredFraction = 400 / 1000 = 0.40
  effectivePct = 20% × 0.40 = 8%

  Apply 8% shift:
    A: 60% − 8% = 52%
    C:  0% + 8% =  8%

Result: { A: 52%,  B: 40%,  C: 8% }
Sum: 52 + 40 + 8 = 100  ✓
```

| Partner | % | Revenue (₹1,00,000) | Interpretation |
|---|---|---|---|
| A | 52% | ₹52,000 | Retains revenue on 600/1000 of the transferred stake |
| B | 40% | ₹40,000 | Unaffected |
| C | 8% | ₹8,000 | Receives revenue only on 400/1000 of A's transferred stake |

**Comparison with full-retain (no KG fields):**

| Scenario | A | B | C |
|---|---|---|---|
| Full retain (no KG) | ₹60,000 | ₹40,000 | ₹0 |
| Partial KG split (400/1000 transferred) | ₹52,000 | ₹40,000 | ₹8,000 |
| Full transfer_to_buyer (current bug path) | ₹40,000 | ₹40,000 | ₹20,000 |

---

## 4. Can Partial KG Support Be Added Without Schema Changes?

**Yes — unconditionally.**

All four columns are already present in `ownershipTransfersTable` in
`lib/db/src/schema/ownership_transfers.ts`:

```
Line 165:  stockEntitlementHandling:     text("stock_entitlement_handling")
Line 168:  stockEntitlementKg:           numeric("stock_entitlement_kg", { precision: 12, scale: 3 })
Line 174:  stockEntitlementRetainedKg:   numeric("stock_entitlement_retained_kg", { precision: 12, scale: 3 })
Line 178:  stockEntitlementTransferredKg: numeric("stock_entitlement_transferred_kg", { precision: 12, scale: 3 })
```

These columns are already in the deployed schema. The Drizzle ORM table reference
(`ownershipTransfersTable`) exported by `@workspace/db` already includes them. The OpenAPI
spec already exposes them (confirmed in `lib/api-client-react/src/generated/api.schemas.ts`).
No `pnpm --filter @workspace/db run push` or `generate` is needed.

---

## 5. Files Requiring Modification

**Only one file requires modification for both BF-1 and BF-2:**

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/entitlement/resolveBatchEntitlement.ts` | Extend SELECT (lines 111–116) + replace application loop (lines 128–154) |

No other file is implicated:

| File | Reason unchanged |
|---|---|
| `processOne.ts` | Consumes `resolveBatchEntitlement` output via `getConsumedLines`. Output shape unchanged (still `Map<partnerId, EntitlementEntry>`). |
| `getConsumedLines.ts` | Passes through to `resolveBatchEntitlement`. No changes to its interface or return type. |
| `blockedPartners.ts` | Operates independently of transfer handling. |
| `errors.ts` | `OwnershipDriftError` and `NoSnapshotError` are unchanged. |
| `routes/held_distribution_ledger.ts` | Not part of entitlement resolution. |
| `lib/db/src/schema/ownership_transfers.ts` | All columns already exist. |
| `lib/api-spec/openapi.yaml` | `stockEntitlementHandling` and KG fields already in spec. |
| `lib/api-client-react/src/generated/` | No codegen needed. |

The file header comment (lines 1–23) should also be updated to rename the algorithm from
"R10 Binary Handling" to "R10 Handling-Aware" and document the new retain/KG branching, but
this is documentation only.

---

## 6. Impact on Existing Attribution Rows

### If `FIN_REVENUE_ATTRIBUTION_ENABLED` Was Never Enabled in Production

No existing `revenue_attribution_lines`, `partner_financial_ledger`, or
`held_distribution_ledger` rows were produced by the engine. No remediation required.

### If `FIN_REVENUE_ATTRIBUTION_ENABLED` Was ON Before the Fix

Any sale event that:
1. Was batch-linked (`batchCreatedAt` not null), AND
2. Had an executed transfer with `stockEntitlementHandling = 'retain_with_seller'` in the window
   `(batchCreatedAt, recognizedAt]`

…will have produced **incorrect** attribution rows and ledger credits. The buyer received revenue
it was not entitled to; the seller was shorted.

**Remediation path (design level — not in scope of this fix, but must be planned):**

1. Query `processed_sale_events` joined with `sale_event_journal` joined with
   `ownershipTransfersTable` to identify events processed under the buggy algorithm.
2. Delete the affected `revenue_attribution_lines` rows (and linked `partner_financial_ledger`
   credits via `ledgerEntryId`).
3. Delete the corresponding `processed_sale_events` rows to allow re-claim.
4. Re-run `processOne` for the affected `eventId`s.

The idempotency mechanism (`ON CONFLICT DO NOTHING` on `processed_sale_events.event_id`) will
prevent double-processing once the re-claim is complete.

**Risk level:** Medium. The remediation is clean if `processOne` is re-entrant after claim removal.
The claim removal must happen inside a transaction with the row deletions to prevent a race condition
with a concurrent `processPending` run.

---

## 7. Change Classification

| Dimension | Required? | Details |
|---|---|---|
| **Schema migration** | **NO** | All 4 columns already exist in `ownership_transfers`. No `ALTER TABLE` needed. |
| **`pnpm --filter @workspace/db run push`** | **NO** | Schema is already in sync. |
| **Index change** | **NO** | No new query pattern requires an index. The existing date-range query on `effectiveDate` is unchanged; adding 4 more columns to the SELECT does not alter query shape or cardinality. |
| **Route change** | **NO** | No API route is modified. The `stockEntitlementHandling` field is already accepted and stored by `POST /ownership-transfers` and `PATCH /ownership-transfers/:id`. |
| **Event contract change** | **NO** | `SaleEventType` enum is unchanged. `InternalPartnerPurchaseCompleted` and `SaleFinanciallyRecognized` are the only processed event types. No new event types are introduced. |
| **OpenAPI spec change** | **NO** | `stockEntitlementHandling` and KG fields are already in the spec and generated schemas. |
| **Codegen run** | **NO** | No spec change → no regeneration needed. |
| **`FIN_REVENUE_ATTRIBUTION_ENABLED` flag** | Consider staging it OFF | If the flag is ON in production with existing incorrect rows, disable it before deploying the fix, run remediation, then re-enable. If the flag has never been enabled in production, deploy freely. |

**Code changes only. Single file. No infrastructure touches.**

---

## 8. Corrective SELECT and Loop — Side-by-Side

### Current SELECT (lines 111–116)

```typescript
const transfers = await db
  .select({
    transferorPartnerId: ownershipTransfersTable.transferorPartnerId,
    buyerPartnerId:      ownershipTransfersTable.buyerPartnerId,
    buyerName:           ownershipTransfersTable.buyerName,
    offeredPercentage:   ownershipTransfersTable.offeredPercentage,
  })
```

### Corrected SELECT

```typescript
const transfers = await db
  .select({
    transferorPartnerId:      ownershipTransfersTable.transferorPartnerId,
    buyerPartnerId:           ownershipTransfersTable.buyerPartnerId,
    buyerName:                ownershipTransfersTable.buyerName,
    offeredPercentage:        ownershipTransfersTable.offeredPercentage,
    stockEntitlementHandling: ownershipTransfersTable.stockEntitlementHandling,
    stockEntitlementKg:       ownershipTransfersTable.stockEntitlementKg,
    stockEntitlementRetainedKg:    ownershipTransfersTable.stockEntitlementRetainedKg,
    stockEntitlementTransferredKg: ownershipTransfersTable.stockEntitlementTransferredKg,
  })
```

### Current Application Loop (lines 128–154)

```typescript
for (const tx of transfers) {
  if (!tx.buyerPartnerId) continue;
  const pct = new Decimal(tx.offeredPercentage ?? "0");
  const from = entitlements.get(tx.transferorPartnerId);
  if (from) {
    entitlements.set(tx.transferorPartnerId, {
      ...from,
      percentage: from.percentage.minus(pct),
    });
  }
  const to = entitlements.get(tx.buyerPartnerId);
  if (to) {
    entitlements.set(tx.buyerPartnerId, {
      ...to,
      percentage: to.percentage.plus(pct),
    });
  } else {
    entitlements.set(tx.buyerPartnerId, {
      partnerId: tx.buyerPartnerId,
      partnerName: tx.buyerName,
      percentage: pct,
    });
  }
}
```

### Corrected Application Loop

```typescript
for (const tx of transfers) {
  if (!tx.buyerPartnerId) continue;

  const fullPct = new Decimal(tx.offeredPercentage ?? "0");
  const handling = tx.stockEntitlementHandling;

  // Resolve the effective percentage shift for this pre-transfer batch.
  let effectivePct: Decimal;

  if (handling === "retain_with_seller") {
    const totalKg     = tx.stockEntitlementKg           ? new Decimal(tx.stockEntitlementKg)           : null;
    const transferKg  = tx.stockEntitlementTransferredKg ? new Decimal(tx.stockEntitlementTransferredKg) : null;

    if (totalKg && totalKg.greaterThan(0) && transferKg !== null) {
      // Partial KG split: only the transferred fraction of offeredPct shifts to buyer.
      effectivePct = fullPct.mul(transferKg.div(totalKg));
    } else {
      // Full retain: seller keeps all entitlement for this batch — skip entirely.
      continue;
    }
  } else {
    // transfer_to_buyer (or null / unknown) — apply full percentage.
    effectivePct = fullPct;
  }

  // Apply the (possibly reduced) percentage shift.
  const from = entitlements.get(tx.transferorPartnerId);
  if (from) {
    entitlements.set(tx.transferorPartnerId, {
      ...from,
      percentage: from.percentage.minus(effectivePct),
    });
  }

  const to = entitlements.get(tx.buyerPartnerId);
  if (to) {
    entitlements.set(tx.buyerPartnerId, {
      ...to,
      percentage: to.percentage.plus(effectivePct),
    });
  } else {
    entitlements.set(tx.buyerPartnerId, {
      partnerId: tx.buyerPartnerId,
      partnerName: tx.buyerName,
      percentage: effectivePct,
    });
  }
}
```

### Behavioral Equivalence Table

| `handling` | KG fields | Pre-fix | Post-fix | Same? |
|---|---|---|---|---|
| `null` | any | full pct applied | full pct applied | ✓ identical |
| `transfer_to_buyer` | any | full pct applied | full pct applied | ✓ identical |
| `retain_with_seller` | null | full pct applied ← **bug** | skipped | ✗ corrected |
| `retain_with_seller` | complete | full pct applied ← **bug** | fraction applied | ✗ corrected |
| `retain_with_seller` | partial/zero | full pct applied ← **bug** | skipped (conservative) | ✗ corrected |

---

## Final Section

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
READY TO IMPLEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Rationale:**

Both BF-1 and BF-2 are resolved by **a single file change** with no ambiguity:

- The fix is mathematically deterministic. Every handling branch produces a result that satisfies
  the drift guard (transferor loses exactly what buyer gains). No new invariants are introduced.

- The fix is backward compatible. `null` and `transfer_to_buyer` entries follow the existing
  code path unchanged. Existing data from those records remains correct.

- No infrastructure changes are required. Schema, indexes, routes, API contract, and codegen
  are all untouched.

- No new error types are needed. `OwnershipDriftError` will still catch any arithmetic error
  in the corrected loop.

- The only prerequisite before deploying is confirming whether `FIN_REVENUE_ATTRIBUTION_ENABLED`
  has ever been ON in production with `retain_with_seller` transfers present. If yes, the
  remediation path described in §6 must run before re-enabling. If no, deploy and enable freely.

There are no open architectural decisions. The design is complete.

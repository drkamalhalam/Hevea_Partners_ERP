# Wave 3 Business Rule Validation Audit

**Date:** 2026-05-25
**Scope:** Read-only audit of Wave 3 revenue attribution implementation vs. approved business architecture.
**Instruction:** No code was modified. All findings are based on reading the actual implementation.

---

## Files Read

| File | Role |
|---|---|
| `artifacts/api-server/src/lib/entitlement/resolveBatchEntitlement.ts` | Core entitlement resolution engine |
| `artifacts/api-server/src/lib/entitlement/getConsumedLines.ts` | Per-line aggregator, calls resolveBatchEntitlement |
| `artifacts/api-server/src/lib/entitlement/blockedPartners.ts` | Determines which partners are blocked |
| `artifacts/api-server/src/lib/entitlement/errors.ts` | Typed error hierarchy |
| `artifacts/api-server/src/lib/revenueHandler/processOne.ts` | Per-event attribution handler |
| `artifacts/api-server/src/lib/revenueHandler/categorize.ts` | Event type → revenue_category mapping |
| `artifacts/api-server/src/routes/held_distribution_ledger.ts` | Held distribution CRUD + release endpoint |
| `lib/db/src/schema/held_distribution_ledger.ts` | Held ledger DB schema |
| `lib/db/src/schema/ownership_transfers.ts` | Ownership transfer schema (incl. stockEntitlementHandling) |
| `lib/db/src/schema/revenue_attribution_lines.ts` | Attribution line DB schema |
| `lib/db/src/schema/enums.ts` | Enum definitions |

---

## 1. Entitlement Resolution Validation

### Algorithm Summary (actual implementation)

`resolveBatchEntitlement(db, projectId, batchCreatedAt, recognizedAt)`:

1. `baselineDate = batchCreatedAt ?? recognizedAt`
2. Find latest `ownershipSnapshot` where `snapshotAt ≤ baselineDate` (for this project). If not found and `batchCreatedAt` was set, retry with `snapshotAt ≤ recognizedAt` as fallback. If still no snapshot → throw `NoSnapshotError`.
3. Build entitlement map from snapshot entries.
4. **Only if `batchCreatedAt !== null`:** apply executed transfers where `effectiveDate > baselineDate AND effectiveDate ≤ recognizedAt`, in chronological order. For each: subtract `offeredPercentage` from transferor, add to buyer.
5. Drift guard: sum of all percentages must equal 100 ± 0.01. On violation → throw `OwnershipDriftError`.
6. Remove partners with percentage ≤ 0.
7. Return `Map<partnerId, EntitlementEntry>`.

**Critical pre-reading note:** The transfers query in step 4 selects only: `transferorPartnerId`, `buyerPartnerId`, `buyerName`, `offeredPercentage`. The `stockEntitlementHandling` column is **not selected and not filtered**. This is the root cause of the findings in scenarios A, C, and D.

---

### Scenario A — `retain_with_seller` Transfer

**Setup:**
```
Snapshot S0 (snapshotAt = T0):  A = 60%,  B = 40%
Batch B1 created at T1          (T0 < T1)
Transfer TX1:  A → C,  offeredPercentage = 20%,
               stockEntitlementHandling = 'retain_with_seller'
               effectiveDate = T2  (T1 < T2),  status = 'executed'
Sale S1 recognized at T3 (T2 < T3), line item linked to B1
Gross amount of sale = ₹1,00,000
```

**Engine trace:**
```
resolveBatchEntitlement(db, projectId, T1, T3)
  baselineDate = T1
  Step 1: latest snapshot ≤ T1  →  S0  →  { A: 60%, B: 40% }
  Step 3: transfers where effectiveDate ∈ (T1, T3]:
           TX1 found  (stockEntitlementHandling is NOT examined)
           A: 60% − 20% = 40%
           C: 0%  + 20% = 20%
  Drift: 40 + 40 + 20 = 100  ✓
  Return: { A: 40%,  B: 40%,  C: 20% }
```

**Actual attribution output (₹1,00,000 sale):**

| Partner | Entitlement % | Gross Revenue |
|---|---|---|
| A | 40% | ₹40,000 |
| B | 40% | ₹40,000 |
| C | 20% | ₹20,000 |

**Expected behavior for `retain_with_seller`:**
Stock was produced at T1 when C had 0% stake. `retain_with_seller` means the seller (A) retains economic entitlement for pre-transfer stock. C should receive nothing from this batch.

| Partner | Expected % | Expected Revenue |
|---|---|---|
| A | 60% | ₹60,000 |
| B | 40% | ₹40,000 |
| C | 0% | ₹0 |

**Finding:** `retain_with_seller` is NOT honored. The engine applies the ownership transfer regardless of `stockEntitlementHandling`. C receives ₹20,000 it should not receive; A is shorted ₹20,000.

---

### Scenario B — `transfer_to_buyer` Transfer

**Setup:** Identical to Scenario A but `stockEntitlementHandling = 'transfer_to_buyer'`.

**Engine trace:** Identical to Scenario A — the flag is not read. Result: `{ A: 40%, B: 40%, C: 20% }`.

**Expected behavior for `transfer_to_buyer`:** C receives entitlement from pre-transfer stock, which IS what the engine produces.

**Finding:** `transfer_to_buyer` works correctly. The engine always applies executed transfers — this happens to match the intended behavior for this flag. Both A and B produce identical output from the engine's perspective; only `transfer_to_buyer` is actually correct.

---

### Scenario C — Multiple `retain_with_seller` Chain: A → B, B → C

**Setup:**
```
Snapshot S0 (T0):  A = 60%,  B = 30%,  D = 10%
Batch B1 at T1
TX1 at T2:  A → B,  offeredPct = 30%,  retain_with_seller,  executed
TX2 at T3:  B → C,  offeredPct = 40%,  retain_with_seller,  executed
  (After TX1: A=30%, B=60%, D=10% — hence B has 40% available to transfer)
Sale recognized at T4, batch-linked to B1
Gross sale = ₹1,00,000
```

**Engine trace:**
```
resolveBatchEntitlement(db, projectId, T1, T4)
  baselineDate = T1
  Step 1: S0  →  { A: 60%, B: 30%, D: 10% }
  Step 3: transfers in (T1, T4]:
    TX1 (T2): A: 60−30=30%,  B: 30+30=60%
    TX2 (T3): B: 60−40=20%,  C:  0+40=40%
  Drift: 30 + 20 + 40 + 10 = 100  ✓
  Return: { A: 30%,  B: 20%,  C: 40%,  D: 10% }
```

**Actual attribution (₹1,00,000):**

| Partner | % | Revenue |
|---|---|---|
| A | 30% | ₹30,000 |
| B | 20% | ₹20,000 |
| C | 40% | ₹40,000 |
| D | 10% | ₹10,000 |

**Expected behavior:** Stock was produced at T1 when C had 0%. Both `retain_with_seller` links mean neither transfer should shift entitlement for this batch. Revenue should reflect ownership at T1 (the batch origin):

| Partner | Expected % | Expected Revenue |
|---|---|---|
| A | 60% | ₹60,000 |
| B | 30% | ₹30,000 |
| D | 10% | ₹10,000 |
| C | 0% | ₹0 |

**Who receives revenue from stock produced before both transfers?**

Per the stated business rule, **A and B should receive all revenue** (60% and 30% respectively), with D at 10%. C entered after the stock was produced and both transfers explicitly selected `retain_with_seller`. The current implementation erroneously credits C with ₹40,000.

**Finding:** The double-`retain_with_seller` chain is not honored at all. The full transfer chain is applied without respect to the flag on either link.

---

### Scenario D — Mixed Chain: A → B `retain_with_seller`, B → C `transfer_to_buyer`

**Setup:**
```
Snapshot S0 (T0):  A = 50%,  B = 40%,  D = 10%
Batch B1 at T1
TX1 at T2:  A → B,  offeredPct = 20%,  retain_with_seller,  executed
TX2 at T3:  B → C,  offeredPct = 30%,  transfer_to_buyer,   executed
  (After TX1: A=30%, B=60%, D=10%)
Sale recognized at T4, batch-linked to B1
Gross = ₹1,00,000
```

**Engine trace:**
```
resolveBatchEntitlement(db, projectId, T1, T4)
  Step 1: { A: 50%, B: 40%, D: 10% }
  Step 3:
    TX1: A: 50−20=30%,  B: 40+20=60%
    TX2: B: 60−30=30%,  C:  0+30=30%
  Drift: 30 + 30 + 30 + 10 = 100  ✓
  Return: { A: 30%,  B: 30%,  C: 30%,  D: 10% }
```

**Expected behavior:** TX1 is `retain_with_seller` — A's 20% should not shift for this pre-TX1 batch. TX2 is `transfer_to_buyer` — C should receive B's transferred share. Since TX1 was not applied, B's entitlement stays at 40%; B→C 30% then gives C 30% of B's original 40%, leaving B with 10%.

| Partner | Expected % | Expected Revenue |
|---|---|---|
| A | 50% | ₹50,000 |
| B | 10% | ₹10,000 |
| C | 30% | ₹30,000 |
| D | 10% | ₹10,000 |

**Actual attribution:** A gets ₹30,000 (short ₹20,000), B gets ₹30,000 (excess ₹20,000), C gets ₹30,000 (correct amount coincidentally), D gets ₹10,000 (correct).

**Finding:** The mixed-chain scenario produces partially wrong results because the `retain_with_seller` leg (TX1) is applied when it should be suppressed. C's amount coincidentally equals expected, but A and B's amounts are wrong.

---

### Scenario E — Partial Retained / Transferred KG Fields

**Schema fields on `ownership_transfers`:**
```
stockEntitlementHandling:       text    (retain_with_seller | transfer_to_buyer)
stockEntitlementKg:             numeric(12,3)   total kg in storage at transfer date
stockEntitlementRetainedKg:     numeric(12,3)   kg seller retains entitlement on
stockEntitlementTransferredKg:  numeric(12,3)   kg buyer receives entitlement on
```

**Engine behavior:** `resolveBatchEntitlement` queries `ownershipTransfersTable` selecting only `transferorPartnerId`, `buyerPartnerId`, `buyerName`, `offeredPercentage`. None of the KG fields are selected. The `getConsumedLines` aggregator works on `salesLineItemsTable.quantity × (entitlement_pct / 100)`. The result is always a pure percentage split — no KG-level routing exists anywhere in the engine.

**Example:** Transfer where seller retains 600kg and transfers 400kg of a 1,000kg stock position. A sale of 200kg from this batch would be expected to route 200kg × (600/1000) = 120kg credit to seller and 80kg to buyer. The engine instead routes 200 × seller_pct% and 200 × buyer_pct%, ignoring the KG split entirely.

**Finding:** `stockEntitlementRetainedKg` and `stockEntitlementTransferredKg` are stored in the database as audit metadata but are **never read by any processing code**. KG-level partial entitlement is not implemented. The engine is percentage-only.

---

### Scenario F — Internal Entitlement Purchase

**Event type:** `InternalPartnerPurchaseCompleted` → `categorize.ts` maps to `revenueCategory='internal_partner_purchase', saleExecutorType='partner'`.

**Engine trace (example):**
```
Snapshot: A = 60%, B = 40%
Batch at T0 (batch_created_at = T0)
Partner B buys rubber from partner A internally; sale event at T1
No ownership transfers in (T0, T1]

resolveBatchEntitlement(db, projectId, T0, T1)
  Step 1: { A: 60%, B: 40% }
  Step 3: no transfers in window
  Return: { A: 60%, B: 40% }
```

Attribution: A gets 60% of net proceeds, B gets 40%. The `revenueCategory='internal_partner_purchase'` tag is written to `revenue_attribution_lines.revenue_category` for reporting grouping (Wave 9+).

**Finding:** Internal entitlement purchase scenarios work correctly. The revenue_category tag differentiates internal purchases from open-market sales in reporting without affecting the entitlement math.

---

### Scenario G — Sale with No Batch Linkage

**Call:** `resolveBatchEntitlement(db, projectId, null, recognizedAt)`

**Engine trace:**
```
batchCreatedAt = null
baselineDate = recognizedAt   (line 50: const baselineDate = batchCreatedAt ?? recognizedAt)

Step 1: latest snapshot where snapshotAt ≤ recognizedAt
  → finds the most recent snapshot at or before sale date

Step 3: if (batchCreatedAt !== null) is FALSE → transfer application is SKIPPED entirely

Return: entitlement map from latest snapshot, no transfer chain applied
```

**Finding:** Correct behavior. For unlinked sales there is no batch history to trace, so the current ownership state (latest snapshot at/before recognizedAt) is used directly. The skip of the transfer chain is deliberate and correct.

---

### Entitlement Resolution Summary Table

| Scenario | Implementation Correct? | Root Cause of Deviation |
|---|---|---|
| A — retain_with_seller | **NO** | `stockEntitlementHandling` not read in engine |
| B — transfer_to_buyer | YES (by coincidence) | Engine always applies transfers — matches intent |
| C — double retain_with_seller chain | **NO** | Same root cause — both transfers applied |
| D — mixed chain | **PARTIALLY NO** | retain_with_seller leg incorrectly applied |
| E — partial KG fields | **NOT IMPLEMENTED** | KG fields stored but never consumed |
| F — internal entitlement purchase | YES | Correct categorization, correct math |
| G — no batch linkage | YES | Transfer chain correctly skipped |

---

## 2. Held Entitlement Validation

### 2.1 Blocked Partner Receives Attribution Row

**Verified YES.** In `processOne.ts` (lines 194–229), when `isBlocked = blockedIds.has(partner.partnerId)` is true:

```typescript
await db.insert(revenueAttributionLinesTable).values({
  id: attrId,
  projectId,
  partnerId: partner.partnerId,
  ...
  ledgerEntryId: null,          // explicitly null
  notes: "entitlement_held",    // tagged for audit
}).onConflictDoNothing();
```

The attribution line IS written. It records the full entitlement (gross, cost, net) with `notes='entitlement_held'` as an audit trail.

### 2.2 No `revenue_credit` Is Created for a Blocked Partner

**Verified YES.** The `partnerFinancialLedgerTable` insert (`entryType: "revenue_credit"`) only occurs in the `else if (writeLedger)` branch (line 232). The `isBlocked` branch exits without touching the ledger. A blocked partner receives no credit row.

### 2.3 `held_distribution_ledger` Row Is Created

**Verified YES.** Immediately after the attribution insert, in the `isBlocked` branch (lines 216–229):

```typescript
await db.insert(heldDistributionLedgerTable).values({
  projectId,
  partnerId: partner.partnerId,
  partnerName: partner.partnerName,
  holdType: "revenue_entitlement",
  sourceId: attrId,                            // FK → attribution line UUID
  sourceType: "revenue_attribution",
  sourceDescription: `Revenue held for ${revenueCategory} — event ${eventId}`,
  heldAmount: fromMoney(recognizedD),          // 2-dp string
  ownershipPctAtTime: partner.ownershipPctAtTime.toFixed(8),
  holdReason: "inheritance_pending",
  status: "held",
});
```

`sourceId` links back to the exact attribution line, enabling full traceability.

### 2.4 Reconciliation Totals Remain Correct

**Verified YES.**

- `GET /held-distribution-ledger/summary` executes `SUM(heldAmount::numeric)` grouped by `(projectId, partnerId, partnerName)` filtered to `status='held'`.
- The `heldAmount` is derived from `recognizedD = grossD − deductionShare` — the same net that would have been credited to the partner had they not been blocked.
- The `revenueAttributionLinesTable` row records the full `grossRevenueAmount`, `costDeductionAmount`, `netRevenueAmount`, `recognizedPartnerRevenue` — sufficient to reconcile against any distribution session.
- Idempotency (`onConflictDoNothing`) prevents double-counting on replay.

### 2.5 Release Path Compatibility with Revision 4 Design

**Partially compatible — one gap identified.**

`POST /held-distribution-ledger/:id/release` (admin only):

```
Sets: status → 'released' | 'forfeited'
      releasedAt, releasedAmount, releasedTo, releaseNotes, releasedByName
```

`releasedTo` enum: `original_partner | dispute_settlement | alternative_party | forfeited`

**Gap:** The release endpoint updates the `held_distribution_ledger` row status but does **not** create a corresponding `partner_financial_ledger` credit. The held amount is acknowledged as released but the released funds are never actually posted to the partner's ledger. Releasing a hold requires a separate manual ledger entry from an operator or a future Wave implementation.

The release path is architecturally compatible with Revision 4's state machine (`held → released | forfeited`) but is **incomplete** for automated credit delivery.

---

## 3. Contribution-Model Compatibility

Wave 3 touches: `revenue_attribution_lines`, `partner_financial_ledger`, `held_distribution_ledger`, `sale_event_journal`, `processed_sale_events`. It does not read or write: `contributions`, `lca_*`, `landowner_ledger_entries`, `burden_recovery_adjustments`, `payable_adjustments`, `recoverable_advances`.

| Contribution-model feature | Wave 3 interaction | Compatible? |
|---|---|---|
| Ownership crystallization at maturity | Wave 3 reads `ownershipSnapshotsTable` (created at crystallization) as baseline | ✓ YES |
| Contribution freeze after maturity | Wave 3 never reads or writes `contributions` | ✓ YES |
| Reimbursement settlements | Wave 3 `revenue_credit` is a separate ledger entry type | ✓ YES |
| Task expenditure → contribution conversion | Wave 3 does not touch `contributions` or `expenditures` | ✓ YES |
| Withdrawal burden transfers | Wave 3 `costDeductionAmount` is from `salesTransactions.totalDeductions` (per-sale), not from `burden_recovery_adjustments` | ✓ YES |

**No conflicts found with the contribution model lifecycle.**

---

## 4. LCA Compatibility

Per the approved roadmap:

| LCA rule | Implementation behavior | Compatible? |
|---|---|---|
| LCA = contribution model only | Wave 3 processes sale events for any model; LCA ledger (`lca_configs`, `lca_ledger`, `lca_payment_events`) is never touched by Wave 3 | ✓ YES |
| Not applicable under 50% revenue model | Wave 3 does not check `commercialModel`; LCA applicability is enforced by LCA routes separately | ✓ YES |
| Accrues monthly, paid yearly | Wave 3 `costDeductionAmount` is per-sale deduction from `totalDeductions`; LCA accrual is a separate periodic process | ✓ YES |
| Escalation clock starts at maturity, never resets | Wave 3 does not read or write `lca_configs.escalation_pct` or `lca_ledger` | ✓ YES |
| Switching models does not reset escalation | Wave 3 does not alter `commercialModel` or any LCA state | ✓ YES |
| `held_distribution_ledger.holdType` includes `lca_credit` | This allows LCA credits to be held pending dispute resolution — schema consistent | ✓ YES |

**Potential double-counting concern (dismissed):** Wave 3's `costDeductionAmount` comes from `salesTransactions.totalDeductions` — operational per-sale costs. LCA adjustments are a separate yearly process posting to `lca_ledger`. They operate on different fields and do not overlap.

**No conflicts found between Wave 3 and the LCA system.**

---

## 5. Multi-Project Compatibility

### 5.1 Attribution Processing Is Project-Isolated

`processOne.ts` extracts `projectId` from `journalRow.projectId` (the event's own project). Every downstream insert includes this `projectId`:

- `revenueAttributionLinesTable` insert → `projectId` field ✓
- `partnerFinancialLedgerTable` insert → `projectId` field ✓
- `heldDistributionLedgerTable` insert → `projectId` field ✓

`resolveBatchEntitlement` filters `ownershipSnapshotsTable` and `ownershipTransfersTable` by `projectId`. A snapshot or transfer from Project X can never bleed into Project Y's entitlement calculation.

### 5.2 Held Distributions Are Project-Isolated

`heldDistributionLedgerTable.projectId` is `NOT NULL` with a foreign key to `projectsTable.id`. The GET routes support `?projectId=` filter. The `/summary` route groups by `projectId` explicitly.

### 5.3 Ownership Snapshots Are Project-Isolated

`ownershipSnapshotsTable` is filtered by `projectId` in every `resolveBatchEntitlement` query (line 61: `eq(ownershipSnapshotsTable.projectId, projectId)`). Snapshot lookup is scoped to the specific project.

### 5.4 Partner Balances Cannot Leak Across Projects

`revenueAttributionLinesTable` (schema line 35): `projectId uuid NOT NULL`. DB composite unique index at line 102 includes `projectId`. `partnerFinancialLedgerTable` (schema line 38): `projectId uuid NOT NULL`, with composite unique index at line 111 including `projectId`.

A developer managing 10 projects will have isolated attribution lines and ledger credits per project. There is no aggregate cross-project ledger at Wave 3 — per-project isolation is enforced at the schema level.

`getBlockedPartnerIds` also scopes all three block sources (inheritance claims, prematurity succession, governance overrides) by `projectId` — a partner blocked in Project X is not blocked in Project Y.

**Multi-project isolation is correctly implemented.**

---

## 6. Findings Summary

### BLOCKING FINDINGS

#### BF-1: `retain_with_seller` Is Not Implemented (Scenarios A, C, D)

**Severity:** Critical

**Location:** `resolveBatchEntitlement.ts` lines 110–154

**Root cause:** The transfers query in Step 3 does not select `stockEntitlementHandling` and does not filter on it. All executed transfers in the date window are applied uniformly regardless of this field. The `transfer_to_buyer` behavior happens to be correct because it matches the default behavior; `retain_with_seller` is silently ignored.

**Impact:** Sellers who transferred ownership mid-period with `retain_with_seller` will have revenue from pre-transfer stock attributed to the buyer. This is incorrect and will produce financially wrong distributions for any project that uses `retain_with_seller` transfers.

**Required fix direction:** When applying a transfer in Step 3, if `stockEntitlementHandling = 'retain_with_seller'`, that transfer must be excluded from the entitlement chain for batches created before the transfer's `effectiveDate`. The query must select and evaluate this field.

#### BF-2: Partial KG Entitlement Is Not Implemented (Scenario E)

**Severity:** High

**Location:** `resolveBatchEntitlement.ts` (missing), `ownership_transfers` schema (present)

**Root cause:** `stockEntitlementKg`, `stockEntitlementRetainedKg`, `stockEntitlementTransferredKg` are stored as schema fields but are not read anywhere in the entitlement engine. The engine is percentage-only.

**Impact:** Any scenario where a transfer specifies a partial KG split (e.g. seller retains revenue on 600kg, buyer takes 400kg) will be ignored. Revenue will be split by ownership percentage instead of the documented KG allocation.

**Required fix direction:** When `stockEntitlementHandling` is present, the engine must apply the KG-level split: route revenue proportional to `retainedKg / totalKg` to the seller and `transferredKg / totalKg` to the buyer for that batch's line items.

### NON-BLOCKING GAPS

#### NBG-1: Release Path Does Not Auto-Credit Partner

**Severity:** Medium (operational gap)

**Location:** `routes/held_distribution_ledger.ts` — `POST /:id/release`

**Detail:** Releasing a hold updates the ledger status (`held → released`) but creates no corresponding `partner_financial_ledger` credit row. Operators must manually post a credit after releasing, or a future Wave must handle this.

**Impact:** Held amounts acknowledged as released are not automatically credited to the receiving partner. No double-payment risk (conservative), but the partner's balance is understated until a manual credit is posted.

#### NBG-2: `SaleCancelled` Reversal Not Implemented

**Severity:** Low (known / intentional)

**Location:** `revenueHandler/categorize.ts` line 56

**Detail:** `SaleCancelled` returns `null` from `categorizeEvent` — the event is skipped by the handler. Reversal logic is explicitly deferred to Wave 5.

**Impact:** If a sale is cancelled after attribution runs, the attribution rows and ledger credits are not reversed. The `sale_event_journal` row for the cancellation will be left unprocessed. This is acknowledged scope deferral, not a bug.

#### NBG-3: `holdReason` Hard-Coded to `inheritance_pending`

**Severity:** Low

**Location:** `processOne.ts` line 226

**Detail:** The held_distribution_ledger row always sets `holdReason = 'inheritance_pending'`. However, `getBlockedPartnerIds` can block a partner for three different reasons (open inheritance claim, disputed prematurity succession participation, or governance override). Partners blocked for prematurity succession or governance override will be tagged as `inheritance_pending` regardless.

**Impact:** Reporting/filtering by `holdReason` will be inaccurate for non-inheritance blocks. No financial impact.

---

## Final Section

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BLOCKED WITH FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Reasoning:**

Two blocking findings prevent staging enablement:

**BF-1** (`retain_with_seller` not implemented) is a correctness defect in the core entitlement engine. Enabling the `FIN_REVENUE_ATTRIBUTION_ENABLED` flag in production with this bug will produce financially incorrect attributions for any ownership transfer that used `retain_with_seller`. Revenue will be credited to buyers for stock they have no legitimate claim to, and sellers will be shorted. This cannot be corrected after the fact without reversing already-written ledger entries and attribution lines, which the current architecture (write-once idempotency) makes difficult.

**BF-2** (partial KG entitlement not implemented) means any documented KG-split agreement is silently overridden by percentage ownership. This will produce incorrect attributions for any transfer that specified a KG-level entitlement split.

**Non-blocking gaps (NBG-1, NBG-2, NBG-3)** do not prevent staging enablement once BF-1 and BF-2 are resolved. They represent operational gaps and known Wave-5 scope, not attribution correctness failures.

**All other validations passed:**
- Held path (blocked partner → attribution row, no ledger credit, held_distribution_ledger row, reconciliation totals): ✓ CORRECT
- Contribution-model compatibility: ✓ NO CONFLICTS
- LCA compatibility: ✓ NO CONFLICTS
- Multi-project isolation: ✓ CORRECT at schema and engine level
- Scenarios B, F, G: ✓ CORRECT
- Drift guard, idempotency, flag gates: ✓ CORRECT
```

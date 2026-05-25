# Wave 3 Production Readiness Audit

**Date:** 2026-05-25
**Scope:** Wave 3 only — Read-only audit, no code changes
**References:** WAVE3_ENTITLEMENT_FIX_REPORT.md · WAVE3_ENTITLEMENT_CORRECTION_PLAN.md · WAVE3_BUSINESS_RULE_VALIDATION.md
**Auditor:** Main agent — static code analysis

---

## Audit Coverage

| Dimension | Files Examined |
|---|---|
| Attribution engine | `resolveBatchEntitlement.ts`, `applyTransferEntitlements`, `getConsumedLines.ts` |
| Revenue handler | `processOne.ts`, `processPending.ts`, `revenueHandler/index.ts`, `categorize.ts` |
| Blocked entitlement | `blockedPartners.ts`, `claim.ts` |
| Feature flags | `featureFlags.ts` |
| Route call sites | `sales.ts`, `sales_orders_v2.ts`, `sale_events_admin.ts`, `held_distribution_ledger.ts`, `fifty_pct.ts` |
| Schema | `revenue_attribution_lines.ts`, `held_distribution_ledger.ts`, `processed_sale_events.ts`, `sale_event_journal.ts`, `ownership_transfers.ts`, `partner_financial_ledger.ts` |
| Test suite | `resolveBatchEntitlement.test.ts` — 59 assertions |

---

## Section 1: retain_with_seller Correction Effectiveness

### All Attribution Paths Covered

The fix is applied in `applyTransferEntitlements`, which is the single call site for all transfer chain application. `processOne` → `getConsumedLines` → `resolveBatchEntitlement` → `applyTransferEntitlements`. There are no bypass paths.

### Decision Logic (Complete)

| `stockEntitlementHandling` | KG field state | Engine action | Verified |
|---|---|---|---|
| `retain_with_seller` | `stockEntitlementKg` null or zero | `continue` — full retain | ✓ |
| `retain_with_seller` | `stockEntitlementTransferredKg` null | `continue` — full retain | ✓ |
| `retain_with_seller` | Both KG fields set, totalKg > 0 | `effectivePct = offeredPct × (transferredKg / totalKg)` | ✓ |
| `transfer_to_buyer` | any | Full `offeredPct` shift (unchanged) | ✓ |
| `null` (unset) | any | Full `offeredPct` shift (backward-compatible default) | ✓ |

Additional guard: if `effectivePct ≤ 0` after computation (e.g. `transferredKg = "0"`), the transfer is skipped — no zero-entry inserted into the map.

### Drift Guard

After `applyTransferEntitlements` returns, `resolveBatchEntitlement` sums all percentages and throws `OwnershipDriftError` if `|sum − 100| > 0.01`. Because each path is symmetric (transferor loses exactly what buyer gains), all three paths preserve the sum. Verified by unit test ("three-partner chain with mixed handling preserves sum").

### Result: PASS

---

## Section 2: Partial KG Entitlement — All Scenarios

Engine formula: `effectivePct = offeredPct × (transferredKg / totalKg)`.

| Scenario | Input | Expected | Engine behavior | Result |
|---|---|---|---|---|
| `retainedKg = 0` | retained=0, transferred=1000, total=1000 | Full transfer (offeredPct) | `effectivePct = offeredPct × 1.0 = offeredPct` | PASS ✓ |
| `transferredKg = 0` | retained=1000, transferred=0, total=1000 | Full retain (skip) | `effectivePct = offeredPct × 0 = 0` → zero guard → skip | PASS ✓ |
| `retainedKg + transferredKg = totalKg` | retained=600, transferred=400, total=1000 | 40% of offeredPct shifts | `effectivePct = offeredPct × 0.4` | PASS ✓ |
| `retainedKg + transferredKg ≠ totalKg` | retained=500, transferred=600, total=1000 | Ambiguous (data inconsistency) | Engine uses `transferredKg/totalKg = 0.6`; ignores `retainedKg` | **See M-3 below** |
| `null KG values` | `stockEntitlementKg = null` | Full retain (skip) | `totalKg = null` → condition false → `continue` | PASS ✓ |
| `null transferredKg only` | totalKg=1000, transferredKg=null | Full retain (skip) | `transferKg = null` → condition false → `continue` | PASS ✓ |
| Mixed transfer chains | retain then transfer_to_buyer | Retain skipped; transfer applied from original balance | Confirmed in Scenario D | PASS ✓ |

### retainedKg — Architectural Note

`stockEntitlementRetainedKg` is an audit/documentation field only. The engine computes entitlement exclusively from `transferredKg / totalKg`. The `retainedKg` value has zero effect on any calculation. This is correct by design but creates a data quality risk when `retainedKg + transferredKg ≠ totalKg` (see **M-3**).

### Result: PASS (with M-3 caveat)

---

## Section 3: Blocked Entitlement Flow

### Block Sources

`getBlockedPartnerIds(db, projectId)` merges three independent sources, all filtered by `projectId`:

| Source | Table | Condition |
|---|---|---|
| Open inheritance claims | `inheritance_claims` | `status = 'open' AND project_id = ?` |
| Disputed prematurity succession | `claimant_participation_records` | `participation_status = 'disputed' AND project_id = ?` |
| Governance override extension point | `governance_overrides` | `metadata->>'blocked_partner_id' IS NOT NULL AND project_id = ?` |

### revenue_attribution_lines Creation

- Written for **every** entitled partner (blocked or not) via `db.insert(...).onConflictDoNothing()`.
- Unique constraint `ral_sale_partner_category_uq` on `(saleReferenceType, saleReferenceId, partnerId, revenueCategory)` prevents duplicate rows.
- Blocked partners: `ledgerEntryId = null`, `notes = 'entitlement_held'`.
- Unblocked partners (with `FIN_LEDGER_ENABLED = ON`): `ledgerEntryId` set, `notes = null`.

### held_distribution_ledger Creation

- Written for blocked partners after the attribution line insert.
- `holdType = 'revenue_entitlement'`, `sourceId = attrId`, `sourceType = 'revenue_attribution'`.
- **No `onConflictDoNothing()`.** The `heldDistributionLedgerTable` has no unique constraint scoped to `(sourceId, sourceType, partnerId)`. See **M-2**.

### No Duplicate Credits (Unblocked Path)

Two independent guards prevent duplicate `partner_financial_ledger` credits:

1. `pfl_revenue_credit_uq` unique index on `(referenceType, referenceId, partnerId)` WHERE `entryType = 'revenue_credit'` — database-enforced.
2. `onConflictDoNothing()` on the Drizzle insert — application-enforced.

Both must fire together. They do. Tested via the idempotency claim mechanism, which prevents `processOne` from even reaching the insert on a retry.

### Idempotent Reprocessing (Normal Path)

1. `claimSaleEvent`: `INSERT ... ON CONFLICT (event_id, processed_by_handler) DO NOTHING RETURNING id`. Returns `claimed = true` only if the row was newly inserted.
2. On a second call with the same eventId: `claimed = false` → `return { outcome: 'already_processed' }`. Attribution code never runs again.
3. Attribution and ledger inserts use `onConflictDoNothing()` as a defense-in-depth layer.

**Idempotency hold:** The claim is inserted before any attribution write. If processing fails after claiming, the claim row stays (see **M-4**). Admin reprocess explicitly deletes the claim row before re-running.

### Result: PASS for duplicate credits and idempotency. M-2 (held ledger) and M-4 (error claim rows) require attention.

---

## Section 4: Multi-Project Isolation

Every query in the Wave 3 attribution pipeline uses `projectId` as a mandatory filter condition.

| Query | Filter applied |
|---|---|
| `ownershipSnapshotsTable` (Step 1 + fallback) | `eq(projectId, projectId)` |
| `ownershipTransfersTable` (Step 3) | `eq(projectId, projectId)` |
| `inheritanceClaimsTable` (blocked partners) | `eq(projectId, projectId)` |
| `claimantParticipationRecordsTable` (blocked partners) | `eq(projectId, projectId)` |
| `governanceOverridesTable` (blocked partners) | `eq(projectId, projectId)` |
| `salesLineItemsTable` (consumed lines) | keyed by `transactionId` which is owned by a single sale → single project |
| `saleEventJournalTable` | `projectId` is a FK column; each event carries its own `projectId` |

**Inheritance claims isolation:** Open claims in Project A have `project_id = A`. `getBlockedPartnerIds(db, B)` never reads Project A rows.

**Governance overrides isolation:** Overrides are project-scoped. Override in Project A does not block any partner in Project B.

**Transfer isolation:** `ownershipTransfersTable` query uses `eq(ownershipTransfersTable.projectId, projectId)`. Transfers executed in Project A are never read when resolving entitlement for Project B.

### Result: PASS — Complete project-level isolation across all queries.

---

## Section 5: Contribution-Model Compatibility

### Attribution Engine is Model-Agnostic

`processOne`, `getConsumedLines`, `resolveBatchEntitlement`, and `getBlockedPartnerIds` do not read `commercialModel` from the `projectsTable`. The engine operates on:
- `ownership_snapshots` (entitlement source)
- `ownership_transfers` (transfer chain)
- `sales_transactions` + `sales_line_items` (revenue source)
- `inheritance_claims`, `governance_overrides`, `claimant_participation_records` (block sources)

None of these tables interact with:

| System | Tables affected | Interaction with Wave 3 |
|---|---|---|
| LCA | `lca_configs`, `lca_ledger`, `lca_payment_events` | None — separate schema, no FK to attribution tables |
| Financial Inputs / Withdrawals | `contributions`, `advances` | None |
| Settlements | `distribution_records`, `fifty_pct` | None |
| Ownership contribution calcs | `burden`, `landowner_accounting` | None |

Wave 3 writes only to: `processed_sale_events`, `revenue_attribution_lines`, `partner_financial_ledger`, `held_distribution_ledger`. None of these tables are read by LCA, burden accounting, or landowner accounting modules.

### Result: PASS — Zero contamination between attribution and contribution-model systems.

---

## Section 6: 50% Revenue Model Compatibility

### fifty_pct.ts Routes

`artifacts/api-server/src/routes/fifty_pct.ts` has **zero** references to `emitSaleRecognized`, `processOne`, `FIN_REVENUE_ATTRIBUTION_ENABLED`, or any Wave 3 attribution construct. The 50% model distribution sessions are entirely isolated from the attribution engine.

### sales.ts and sales_orders_v2.ts — Model Guard Absence

Both `sales.ts` (confirm sale) and `sales_orders_v2.ts` (confirm payment) call `emitSaleRecognized` **without checking `commercialModel`**. If a `fifty_percent_revenue` project has rubber sales recorded via these routes, the attribution engine will be triggered. See **M-1**.

### Result: PASS for fifty_pct routes. M-1 (model guard absence) applies to rubber sales routes.

---

## Section 7: Business Rule Verification Against Wave 3 Design Revision 4

| Requirement (Revision 4) | Implementation | Status |
|---|---|---|
| R10: `retain_with_seller` skips transfer for pre-transfer batches | `if handling === 'retain_with_seller' && KG incomplete → continue` | ✓ Implemented |
| R10: Partial KG split applies `(transferredKg / totalKg) × offeredPct` | `effectivePct = fullPct.mul(transferKg.div(totalKg))` | ✓ Implemented |
| R10: `transfer_to_buyer` and null apply full offeredPct | `effectivePct = fullPct` | ✓ Implemented |
| R11: Drift guard ±0.01% enforced after all transfers applied | `sum.minus(100).abs().greaterThan(new Decimal("0.01"))` | ✓ Implemented |
| R6: Inline synchronous processing on sale confirmation | `emitSaleRecognized` calls `processOne` inline after publish | ✓ Implemented |
| R7: Idempotency claim before any write | `claimSaleEvent` INSERT RETURNING before attribution writes | ✓ Implemented |
| R8: Blocked partners → attribution held, no ledger credit | `isBlocked → attribution(ledgerEntryId=null) + heldDistributionLedger` | ✓ Implemented |
| R9: Deduction split pro_rata_kg | `deductionRatios = consumedQty / totalConsumedQty` | ✓ Implemented |
| R12: Attribution lines write-once | No UPDATE/DELETE routes on `revenue_attribution_lines` | ✓ Enforced |
| SaleCancelled deferred | `categorizeEvent` returns null; `processPending` SQL-excludes it | ✓ Deferred (Wave 5) |

---

## Findings Register

### Medium Findings

---

#### M-1: No commercial model guard on attribution trigger (attribution call sites)

**Severity:** Medium
**Files:** `artifacts/api-server/src/routes/sales.ts:726`, `sales_orders_v2.ts:519`
**Description:** Both sale confirmation routes call `emitSaleRecognized` regardless of the project's `commercialModel`. When `FIN_REVENUE_ATTRIBUTION_ENABLED = ON`:
- An `ownership_contribution` project → attribution succeeds (expected).
- A `fifty_percent_revenue` project → `resolveBatchEntitlement` finds no ownership snapshot → throws `NoSnapshotError` → `processOne` catches it, returns `{ outcome: 'error' }` → a claim row is still inserted into `processed_sale_events` → the event appears "processed" but is actually unanswered.
- Repeated events for `fifty_percent_revenue` projects silently accumulate false-positive claim rows with no financial output.

**Impact:** Operational noise only while flag is OFF (current state). Becomes a data quality issue the moment the flag is enabled in any environment containing `fifty_percent_revenue` projects.

**Recommendation:** Add a `commercialModel` check in `emitSaleRecognized` or in the route before calling it. Skip or log-and-return for `fifty_percent_revenue` projects.

**Staging prerequisite:** Only enable `FIN_REVENUE_ATTRIBUTION_ENABLED` on staging environments whose test projects are exclusively `ownership_contribution` model.

---

#### M-2: held_distribution_ledger has no idempotency protection

**Severity:** Medium
**File:** `artifacts/api-server/src/lib/revenueHandler/processOne.ts:216` (held path), `artifacts/api-server/src/routes/sale_events_admin.ts:131–139` (reprocess)
**Description:** The `heldDistributionLedgerTable` insert uses neither `onConflictDoNothing()` nor a unique constraint on `(sourceId, partnerId)` or `(sourceId, sourceType)`. The admin reprocess endpoint (`POST /:eventId/reprocess`) deletes the `processed_sale_events` claim row and re-runs `processOne`. For an event with blocked partners, a second `held_distribution_ledger` row is created with the same `sourceId` and `sourceType` as the first — a financial duplicate.

**Impact:** Administrative decision-making from `/held-distribution-ledger/summary` (which sums `heldAmount` by project/partner) would double-count amounts for reprocessed events. No duplicate credits are created (those have proper guards), but held amounts would be inflated.

**Recommendation:** Add a `uniqueIndex` on `(source_id, source_type, partner_id)` to `heldDistributionLedgerTable` and add `.onConflictDoNothing()` to the insert in `processOne`. This is a schema change (requires `pnpm --filter @workspace/db run push` in dev).

---

#### M-3: KG consistency not validated at API layer

**Severity:** Medium
**File:** `artifacts/api-server/src/routes/ownership_transfers.ts:200–210` (PATCH validation), `resolveBatchEntitlement.ts:101–103` (engine formula)
**Description:** The engine computes `effectivePct = offeredPct × (transferredKg / totalKg)`. The column `stockEntitlementRetainedKg` is read by the engine into the `SELECT` but is **never used in any calculation** — it is a documentation/audit field only. The ownership_transfers PATCH route accepts `stockEntitlementRetainedKg`, `stockEntitlementTransferredKg`, and `stockEntitlementKg` as independent values with no cross-validation that `retainedKg + transferredKg = totalKg`.

**Concrete risk:** Admin enters totalKg=1000, retainedKg=700, transferredKg=400 (sum=1100). Operator intent: 70% retained, 40% transferred (sum is wrong). Engine computes `offeredPct × 0.4`. The mismatch is invisible to the system.

**Impact:** Incorrect effective percentage applied to the transfer if operators enter inconsistent KG data. No data integrity error raised.

**Recommendation:** Add a server-side validation in the ownership_transfers PATCH/PUT route: when all three KG fields are present and non-null, assert `retainedKg + transferredKg ≤ totalKg + ε` (allow small floating-point tolerance). Log a warning or return a 422 if violated.

---

#### M-4: Failed processing leaves a false-positive claim in processed_sale_events

**Severity:** Medium
**File:** `artifacts/api-server/src/lib/revenueHandler/processOne.ts:114–122` (claim), `:302–305` (catch)
**Description:** `claimSaleEvent` inserts a row into `processed_sale_events` before any attribution write. If processing subsequently fails (e.g. `NoSnapshotError`, DB error), the catch block returns `{ outcome: 'error' }` but the claim row **is not deleted**. The event then appears in the admin status endpoint's `processedByHandler` count despite having produced no output. Subsequent automatic calls to `processOne` for this event return `already_processed` without re-running.

**Impact:**
- `GET /admin/sale-events/status` over-counts `processedByHandler`, under-counts `pending`.
- A failed event requires manual admin reprocess to recover — it will not self-heal.
- An operator scanning status for `pending > 0` will not detect failed events.

**Recommendation:**
- Option A: Add a `status` column to `processed_sale_events` (`'success' | 'error'`) and update it in the catch block. Admin status endpoint filters on `status = 'success'`.
- Option B: Delete the claim row on error so the event re-appears as pending. Risk: infinite retry if the error is persistent.

Option A is strongly preferred and aligns with a future Wave 9 audit dashboard.

---

### Low Findings

---

#### L-1: holdReason hardcoded to 'inheritance_pending' for all block sources (NBG-3 — documented)

**Severity:** Low
**File:** `processOne.ts:226`
**Description:** `holdReason: "inheritance_pending"` is inserted for every blocked partner regardless of which source triggered the block (disputed prematurity succession, governance override, or actual inheritance claim). The `held_distribution_ledger.holdReason` column supports five values; only one is ever used by the attribution engine.

**Impact:** Reporting by `holdReason` (`/held-distribution-ledger/summary`) is semantically incorrect for non-inheritance blocks. Admin UI shows all holds as "inheritance pending" even for succession disputes.

**Recommendation:** Map block source to the correct `holdReason` value in `getBlockedPartnerIds` (return `Map<partnerId, reason>` instead of `Set<partnerId>`) and pass it through to `processOne`.

---

#### L-2: processPending loads all claimed event IDs into application memory

**Severity:** Low
**File:** `artifacts/api-server/src/lib/revenueHandler/processPending.ts:64–69`
**Description:** `processPending` queries ALL claimed rows for the handler into an in-memory array, then passes it as a `notInArray` exclusion list. For a large journal (thousands of events), this creates a large WHERE IN clause and may degrade query performance or hit memory limits.

**Impact:** Negligible while flag is OFF and journal is empty. Becomes a performance concern at scale.

**Recommendation:** Replace with a LEFT JOIN or NOT EXISTS subquery to compute pending events entirely in SQL.

---

#### L-3: Attribution error details not logged in the inline emission path

**Severity:** Low
**File:** `artifacts/api-server/src/lib/revenueHandler/index.ts:160`
**Description:** `emitSaleRecognized` logs `{ outcome: processResult.outcome }` but not `processResult.errorMessage`. When attribution fails inline (e.g. `NoSnapshotError`), the server log contains only `outcome: 'error'`. An operator cannot determine root cause without calling the admin reprocess endpoint.

**Impact:** Diagnostic friction only. No data loss.

**Recommendation:** Log `{ outcome, errorMessage: processResult.errorMessage }` in the `emitSaleRecognized` log line.

---

#### L-4: Feature flags are read once at process startup

**Severity:** Low
**File:** `artifacts/api-server/src/lib/featureFlags.ts:54`
**Description:** `finFlags` is a frozen object populated at module load time. `getFinFlag()` reads from this snapshot, never from `process.env` again. Enabling `FIN_REVENUE_ATTRIBUTION_ENABLED` requires an API server restart to take effect.

**Impact:** Operational requirement — not a bug. Must be documented in the staging runbook.

**Recommendation:** Add this requirement to the staging flag-enable checklist. No code change required.

---

#### L-5: Unbatched line items bypass the transfer chain entirely

**Severity:** Low
**File:** `artifacts/api-server/src/lib/entitlement/resolveBatchEntitlement.ts:205`
**Description:** Step 3 (transfer chain application) is guarded by `if (batchCreatedAt !== null)`. Line items where `salesLineItemsTable.batchId = null` call `resolveBatchEntitlement` with `batchCreatedAt = null`, which bypasses Step 3 entirely. These items always use the snapshot-at-recognizedAt entitlement with no retain_with_seller logic applied.

**Impact:** If unbatched line items exist in production (sales not linked to a production batch), the retain_with_seller correction has no effect on those items. The seller receives the snapshot-time entitlement regardless of transfer flag.

**Recommendation:** Audit whether unbatched line items are expected in the production data model. If they can occur, document this as an accepted limitation. If they should not occur, add a database constraint or a runtime assertion.

---

### Informational

---

#### I-1: NBG-1 — Release path does not auto-credit partner_financial_ledger (documented)

`POST /held-distribution-ledger/:id/release` updates the hold record's status to `released` or `forfeited` but does not create a `partner_financial_ledger` credit for the released partner. The original `revenue_attribution_lines` row still has `ledgerEntryId = null` and `notes = 'entitlement_held'`. This gap was documented in WAVE3_ENTITLEMENT_FIX_REPORT.md. Since `FIN_LEDGER_ENABLED` is OFF, there is no ledger impact in staging; the gap becomes material only when Wave 4 is enabled.

---

#### I-2: NBG-2 — SaleCancelled reversal deferred to Wave 5 (documented)

`categorizeEvent('SaleCancelled')` returns null. `processPending` also SQL-excludes it. Two layers of deferral. No business-rule violation — the design explicitly defers reversal to Wave 5.

---

#### I-3: SaleCancelled double-filtered (defense in depth, not a bug)

`processPending` filters `SaleCancelled` at the SQL level AND `categorizeEvent` returns null for it. The double filter is harmless and provides defense in depth.

---

#### I-4: Test suite — 59/59 pass

All Wave 3 unit tests pass. Coverage includes all five scenarios (A–E), all KG edge cases (`transferredKg=0`, `retainedKg=0`, `100%` transferred, `null` fields), and cross-scenario sum preservation. No regressions in the 40 pre-existing money library tests.

---

#### I-5: Full workspace typecheck clean

`pnpm run typecheck` passes cleanly across all four artifacts (`api-server`, `plantation-web`, `mockup-sandbox`, `scripts`) and all composite libs.

---

#### I-6: Arithmetic precision confirmed

All money calculations use `decimal.js-light` with `HALF_UP` rounding. The `splitMoney` function guarantees exact-sum splits. The drift guard uses a `Decimal` comparison, not floating-point. `numericFlex` columns receive `number` via `toNum2` / `toNum4` (parseFloat of fixed-string). No floating-point drift risk in the attribution core.

---

## Findings Summary Table

| ID | Severity | Title | Action required before staging? |
|---|---|---|---|
| M-1 | **Medium** | No commercial model guard on attribution trigger | Yes — constrain staging to ownership_contribution projects |
| M-2 | **Medium** | held_distribution_ledger missing idempotency protection | Recommended before staging; acceptable with admin awareness |
| M-3 | **Medium** | KG consistency not validated at API layer | Recommended; low likelihood in controlled staging |
| M-4 | **Medium** | Failed processing leaves false-positive claim row | Acceptable for staging; document in runbook |
| L-1 | Low | holdReason hardcoded to inheritance_pending | Backlog — reporting accuracy only |
| L-2 | Low | processPending memory scaling | Backlog — no impact while journal is small |
| L-3 | Low | Error details not logged in emission path | Fix before production |
| L-4 | Low | Flags read at startup, restart required | Document in runbook |
| L-5 | Low | Unbatched line items bypass transfer chain | Clarify data model intent |
| I-1 | Info | NBG-1 release path missing ledger credit | Wave 4 scope |
| I-2 | Info | NBG-2 SaleCancelled deferred | Wave 5 scope |
| I-3 | Info | SaleCancelled double-filtered | No action |
| I-4 | Info | 59/59 tests pass | No action |
| I-5 | Info | Workspace typecheck clean | No action |
| I-6 | Info | Arithmetic precision confirmed | No action |

No **Blocking** or **High** findings were identified.

---

## Final Recommendation

### ✅ READY FOR STAGING FLAG TESTING

Wave 3 is ready to be enabled in a staging environment under the following conditions:

### Pre-Staging Prerequisites

**Required:**
1. **Restrict staging scope to `ownership_contribution` projects only** (M-1). Do not enable `FIN_REVENUE_ATTRIBUTION_ENABLED` in any environment containing `fifty_percent_revenue` projects until the model guard is added. This is the only prerequisite that affects data correctness for staging.
2. **Restart the API server** after setting `FIN_REVENUE_ATTRIBUTION_ENABLED=true` (L-4). The flag is read at startup.

**Recommended (before staging):**
3. Add `onConflictDoNothing()` and a unique index to `held_distribution_ledger` (M-2) — protects hold-amount integrity if any admin reprocess is performed during staging.

**Acceptable for staging, fix before production:**
4. Add `{ errorMessage }` to the `emitSaleRecognized` log line (L-3) — operational diagnostic quality.
5. Verify staging data model for unbatched line items (L-5) — confirm whether they can occur and document accordingly.

### Post-Flag-Enable Monitoring

- Watch `GET /api/admin/sale-events/status` for `pending > 0` after sales confirmations.
- Check for `outcome: 'error'` in server logs — requires admin reprocess if found (M-4 awareness).
- Confirm `revenue_attribution_lines` rows are written for each sale and that partner percentages sum correctly.
- Confirm `held_distribution_ledger` rows appear for any partner with an open inheritance claim in the test project.

### Flags in Scope for Staging

| Flag | Set? | Notes |
|---|---|---|
| `FIN_SALE_EVENT_EMISSION_ENABLED` | Yes — enable first | Journals events without processing |
| `FIN_REVENUE_ATTRIBUTION_ENABLED` | Yes — enable second | Enables Wave 3 attribution engine |
| `FIN_LEDGER_ENABLED` | **No** | Wave 4 scope — keep OFF |

Enabling `FIN_LEDGER_ENABLED` OFF during staging is correct and by design. Attribution lines will be written but no `partner_financial_ledger` credits will be created, enabling full dry-run verification of the attribution math before financial writes are enabled.

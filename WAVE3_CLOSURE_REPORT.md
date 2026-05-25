# NPF Partner Financial Ledger V3 — Wave 3 Closure Report

**Wave:** 3 — Revenue Attribution Infrastructure
**Design Revision:** Revision 4 (R1–R10), approved prior to implementation
**Typecheck:** PASS (all 4 workspace packages clean)
**DB push:** Applied (both Wave 3 partial-unique indexes confirmed in DB)
**Flags at close:** All OFF (no production behavior change)

---

## Objective

Implement the complete revenue attribution infrastructure: entitlement resolution,
sale_revenue_handler, revenue_attribution_lines population, revenue_credit ledger
generation, held entitlement creation, admin processing endpoints, and single-event
emission integration at both sale confirmation routes.

---

## Files Created

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/entitlement/errors.ts` | Typed error classes: `EntitlementError`, `OwnershipDriftError`, `NoSnapshotError` |
| `artifacts/api-server/src/lib/entitlement/blockedPartners.ts` | Three-source block resolver (inheritance claims, prematurity disputes, governance extension point) |
| `artifacts/api-server/src/lib/entitlement/resolveBatchEntitlement.ts` | Ownership snapshot lookup + R10 transfer-chain walker → `Map<partnerId, EntitlementEntry>` |
| `artifacts/api-server/src/lib/entitlement/getConsumedLines.ts` | Per-line-item entitlement aggregator → `PartnerLineAggregate[]` |
| `artifacts/api-server/src/lib/revenueHandler/categorize.ts` | Event type → `revenue_category` + `saleExecutorType` mapping |
| `artifacts/api-server/src/lib/revenueHandler/processOne.ts` | Per-event idempotent handler: claim → resolve → split → write attribution/credit/hold |
| `artifacts/api-server/src/lib/revenueHandler/processPending.ts` | Sweep unprocessed `sale_event_journal` rows through handler |
| `artifacts/api-server/src/lib/revenueHandler/index.ts` | Barrel + `emitSaleRecognized(...)` helper used by confirmation routes |
| `artifacts/api-server/src/routes/sale_events_admin.ts` | `GET /admin/sale-events/status`, `POST /admin/sale-events/process-pending`, `POST /admin/sale-events/:eventId/reprocess` |
| `WAVE3_CLOSURE_REPORT.md` | This document |

---

## Files Modified

| File | Change |
|---|---|
| `lib/db/src/schema/revenue_attribution_lines.ts` | Added partial `UNIQUE` index `ral_sale_partner_category_uq` on `(saleReferenceType, saleReferenceId, partnerId, revenueCategory)` |
| `lib/db/src/schema/partner_financial_ledger.ts` | Added partial `UNIQUE` index `pfl_revenue_credit_uq` on `(referenceType, referenceId, partnerId) WHERE entry_type='revenue_credit' AND referenceId IS NOT NULL` |
| `artifacts/api-server/src/routes/sales.ts` | Added `emitSaleRecognized(...)` call after `writeSaleAudit(...)` at `POST /:id/confirm`; import added |
| `artifacts/api-server/src/routes/sales_orders_v2.ts` | Added bridge-tx lookup + `emitSaleRecognized(...)` call after bridge creation at `POST /:id/confirm-payment`; import added |
| `artifacts/api-server/src/routes/index.ts` | Added `saleEventsAdminRouter` import and mount at `/admin/sale-events` |
| `replit.md` | Added mutability-exception note for Wave 3 `numericFlex` cast pattern |

---

## Database State

Both partial unique indexes were confirmed present in the live database:
- `ral_sale_partner_category_uq` — idempotency guard on attribution lines
- `pfl_revenue_credit_uq` — idempotency guard on revenue_credit ledger entries

---

## Design Contract Compliance (R1–R10)

| Rule | Implementation |
|---|---|
| R1 — Entitlement resolution per batch | `resolveBatchEntitlement.ts`: snapshot ≤ batchCreatedAt, fallback to recognizedAt |
| R2 — InternalPartnerPurchaseCompleted category | `categorize.ts`: `internal_partner_purchase` category |
| R3 — Held entitlement path | `processOne.ts`: blocked → `attribution.ledger_entry_id=NULL`, `notes='entitlement_held'`, `held_distribution_ledger` row |
| R4 — held_distribution_ledger reuse | `heldDistributionLedgerTable` used as-is; `holdType='revenue_entitlement'`, `sourceType='revenue_attribution'`, `sourceId=attribution.id` |
| R5 — SaleCancelled deferred | `categorizeEvent('SaleCancelled')` returns `null` → handler skips; no rows written |
| R6 — Single-event emission, inline processing | `emitSaleRecognized`: one publish per sale confirm; `processOne` called inline |
| R7 — Deduction split pro_rata_kg | `processOne.ts`: `splitMoney(totalDeductions, [qty_i / totalQty])` |
| R8 — Idempotency two-layer | `processed_sale_events` claim + DB-level `ON CONFLICT DO NOTHING` on both tables |
| R9 — Flag gates | `FIN_SALE_EVENT_EMISSION_ENABLED` gates emit; `FIN_REVENUE_ATTRIBUTION_ENABLED` gates handler; `FIN_LEDGER_ENABLED` gates ledger writes |
| R10 — Chronological transfer chain | `resolveBatchEntitlement.ts`: transfers applied in `effectiveDate` ASC order |

---

## Key Design Decisions

**numericFlex insert type:** `numericFlex` has `data: number` (not `string`) — all inserts into
`revenueAttributionLinesTable` and `partnerFinancialLedgerTable` amount columns use
`parseFloat(d.toFixed(N))` helpers (`toNum2`, `toNum4`). Standard `numeric(p,s)` columns
(in `heldDistributionLedgerTable`) accept `string` and use `fromMoney()` directly.

**Pre-generated UUIDs:** Attribution line IDs are pre-generated with `crypto.randomUUID()`
before `INSERT ... ON CONFLICT DO NOTHING` so the held path can reference `attrId` without
needing `.returning()` on the conflict-aware insert.

**Drift tolerance:** Ownership share sum must equal 100.00 ± 0.01. On drift,
`OwnershipDriftError` is thrown and the event remains unprocessed (available for admin reprocess).

**Emission is fire-and-forget:** Route confirmation handlers call `emitSaleRecognized(...).catch(...)`.
If emission or attribution fails, the sale is already confirmed — the event can be reprocessed
via `POST /admin/sale-events/:eventId/reprocess`.

---

## Out of Scope (deferred to later waves)

- Cost allocation debit entries (Wave 5)
- Reimbursement credits (Wave 6)
- Distribution ledger integration (Wave 7)
- Closure snapshots (Wave 8)
- Dashboard consumption of V3 view (Wave 9)
- `SaleCancelled` reversal handler (Wave 5)
- Alternative held-release paths beyond `original_partner`

---

## Flags Required to Activate

Set in environment to enable Wave 3 behavior:

```
FIN_SALE_EVENT_EMISSION_ENABLED=true
FIN_REVENUE_ATTRIBUTION_ENABLED=true
FIN_LEDGER_ENABLED=true              # optional: OFF = attribution-only dry-run mode
```

All flags remain OFF at Wave 3 close. No production behavior has changed.

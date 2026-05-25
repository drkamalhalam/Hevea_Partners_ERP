# Wave 3 Medium Findings Remediation Plan

**Date:** 2026-05-25
**Scope:** Read-only analysis — no code changes
**Source:** WAVE3_FINAL_READINESS_AUDIT.md (M-1 through M-4)
**Purpose:** Exact fix design for each medium finding before implementation

---

## Implementation Order (Summary)

| Order | Finding | Reason |
|---|---|---|
| **1st** | M-3 | Application-only. No schema. Closes data quality hole at entry point. |
| **2nd** | M-1 | Application-only. No schema. Prevents journal pollution before any flag is enabled. |
| **3rd** | M-2 | Schema + application. Unique index is additive, low risk. Must precede staging flag enable. |
| **4th** | M-4 | Schema + application. Most invasive. Changes `processPending` query logic. |

M-3 and M-1 can be implemented together in one pass (both are pure application code). M-2 and M-4 each require a schema migration and should be separate PRs.

---

## M-1: No Commercial Model Guard on Attribution Trigger

### Root Cause

`emitSaleRecognized` (the single integration point between sale confirmation and the Wave 3 attribution engine) does not check the project's `commercialModel` before publishing an event. When `FIN_REVENUE_ATTRIBUTION_ENABLED = ON`:

- `fifty_percent_revenue` projects do not have `ownership_snapshots` rows — `resolveBatchEntitlement` throws `NoSnapshotError`.
- `processOne` catches the error and returns `{ outcome: 'error' }` but the claim row is already inserted into `processed_sale_events`.
- The event appears processed to all subsequent calls (`already_processed`), permanently hiding it from the pending sweep without any attribution output.
- Every future sale confirmation for the same project adds another stuck event.

The 50% model uses `fifty_pct` distribution sessions for revenue attribution — a completely separate mechanism. The Wave 3 engine is inapplicable to this model by design.

### Exact Affected Files

| File | Line | Issue |
|---|---|---|
| `artifacts/api-server/src/lib/revenueHandler/index.ts` | 73–168 | `emitSaleRecognized` — no model check before publish |
| `artifacts/api-server/src/routes/sales.ts` | 726–732 | Call site 1 — no `commercialModel` context |
| `artifacts/api-server/src/routes/sales_orders_v2.ts` | 519–525 | Call site 2 — no `commercialModel` context |

### Why the Call Sites Cannot Be the Fix Point

In `sales.ts`, the confirm handler fetches `salesTransactionsTable` with `db.select()` (all columns, line 606–610). This gives `tx.projectId` but **not** `commercialModel` — that column is on `projectsTable`. Adding the guard at both call sites requires changing two files and risks being missed by future call sites. Centralizing in `emitSaleRecognized` is the correct architectural choice.

### Proposed Fix: Guard Inside `emitSaleRecognized`, Outcome `inapplicable_model`

**Insertion point:** Immediately after the `FIN_SALE_EVENT_EMISSION_ENABLED` flag check and before the sale transaction load, add a single project lookup:

```typescript
// NEW: Skip attribution for non-ownership-contribution projects.
// fifty_percent_revenue projects use distribution sessions, not this engine.
const [project] = await db
  .select({ commercialModel: projectsTable.commercialModel })
  .from(projectsTable)
  .where(eq(projectsTable.id, projectId))
  .limit(1);

if (!project) {
  log.warn({ saleTxId, projectId }, "emitSaleRecognized: project not found");
  return { emitted: false, eventId: null, attributed: false, reason: "project_not_found" };
}

if (project.commercialModel !== "ownership_contribution") {
  // Correct behavior: skip silently. 50% model has its own distribution mechanism.
  return { emitted: false, eventId: null, attributed: false, reason: "inapplicable_model" };
}
```

This guard:
- Prevents **event emission** for `fifty_percent_revenue` projects — no journal row is written at all.
- Never reaches `publishSaleEvent` or `processOne` — no claim rows, no stuck events.
- Returns `emitted: false` — the sale confirmation route treats this as non-fatal (both call sites already have a `try/catch` around the emit call).
- Adds one indexed PK lookup (`projectsTable.id` is UUID PK) — negligible overhead.

**Why skip, not error:**  
`fifty_percent_revenue` projects have legitimate rubber sales; sale confirmation must succeed. The Wave 3 engine is simply not applicable. A hard error would break the sale flow. A skip is correct and silent.

**`EmitSaleRecognizedResult` interface change needed:** Add `'inapplicable_model' | 'project_not_found'` to the `reason` union. No caller currently inspects the `reason` value beyond logging.

### Schema Change Required: No
### Migration Required: No
### Risk Level: Low

The only behavioral change is: `emitSaleRecognized` returns early for `fifty_percent_revenue` projects. These projects currently fail with `NoSnapshotError` anyway — the new behavior (clean skip) is strictly better.

---

## M-2: Duplicate held_distribution_ledger on Admin Reprocess

### Root Cause

The admin reprocess endpoint (`POST /api/admin/sale-events/:eventId/reprocess`) deletes the `processed_sale_events` claim row and re-runs `processOne`. When a reprocessed event has blocked partners:

1. `revenueAttributionLinesTable`: safe — `onConflictDoNothing()` + unique index `ral_sale_partner_category_uq` prevents duplicate rows.
2. `partnerFinancialLedgerTable`: safe — `onConflictDoNothing()` + unique index `pfl_revenue_credit_uq` prevents duplicates.
3. **`heldDistributionLedgerTable`: unsafe** — no `onConflictDoNothing()`, no unique constraint. A second row is inserted with the same `sourceId`, `sourceType`, and `partnerId`.

The `sourceId` column is the UUID of the `revenueAttributionLinesTable` row (`attrId`). On reprocess, `attrId` is regenerated via `randomUUID()` each time — so even if a unique constraint existed on `sourceId` alone, the new UUID would bypass it. The idempotency guard must include `partnerId` as well.

However: on reprocess, the `revenueAttributionLinesTable` insert uses `onConflictDoNothing()` and returns nothing. The pre-generated `attrId` (from `randomUUID()`) is then used as the `sourceId` for the `heldDistributionLedgerTable` insert — but since the attribution row already exists (from the first run), the `attrId` is a **new, unused UUID** pointing to no row. The held entry's `sourceId` FK points to nothing meaningful after reprocess.

This creates two problems:
- A duplicate held entry with an orphaned `sourceId`
- The `heldAmount` sum in `/held-distribution-ledger/summary` is doubled for the reprocessed partner

### Exact Affected Files

| File | Line | Issue |
|---|---|---|
| `artifacts/api-server/src/lib/revenueHandler/processOne.ts` | 194–229 | Held path — no `onConflictDoNothing()` on `heldDistributionLedgerTable` insert |
| `lib/db/src/schema/held_distribution_ledger.ts` | 28–94 | Table schema — no unique index on `(source_id, source_type, partner_id)` |
| `artifacts/api-server/src/routes/sale_events_admin.ts` | 131–139 | Reprocess endpoint — deletes claim then re-runs `processOne` without held-entry dedup guard |

### Proposed Fix: Two-Part — Schema Index + Application Guard

#### Part A: Schema — Partial Unique Index

Add a partial unique index to `heldDistributionLedgerTable`:

```typescript
// In heldDistributionLedgerTable table definition (Drizzle):
(t) => ({
  // Existing PK only; add:
  uniqueAttributionHold: uniqueIndex("hdl_attribution_hold_uq")
    .on(t.sourceId, t.sourceType, t.partnerId)
    .where(sql`${t.sourceId} IS NOT NULL AND ${t.holdType} = 'revenue_entitlement'`),
})
```

This constraint:
- Only applies to attribution-driven holds (`holdType = 'revenue_entitlement'`, `sourceId IS NOT NULL`)
- Manual holds (`sourceId = null`) and non-attribution hold types remain unconstrained
- The `sourceId` here is the `revenueAttributionLinesTable.id` — which is deduplicated by `ral_sale_partner_category_uq`. Therefore, the same `(sourceId, sourceType, partnerId)` triple always identifies the same logical held event

#### Part B: Application — Resolve the Reprocess sourceId Problem

The core issue is that on reprocess, `attrId = randomUUID()` generates a new UUID that is unused (the attribution insert conflicted and wrote nothing). The held insert then uses this orphaned UUID as `sourceId`.

**Fix:** Resolve the canonical `attrId` from the already-existing attribution row before inserting the held entry:

```typescript
// After the attribution insert (which may conflict/do-nothing):
const [existingAttr] = await db
  .select({ id: revenueAttributionLinesTable.id })
  .from(revenueAttributionLinesTable)
  .where(
    and(
      eq(revenueAttributionLinesTable.saleReferenceType, journalRow.saleReferenceType),
      eq(revenueAttributionLinesTable.saleReferenceId, saleReferenceId),
      eq(revenueAttributionLinesTable.partnerId, partner.partnerId),
      eq(revenueAttributionLinesTable.revenueCategory, revenueCategory),
    ),
  )
  .limit(1);

const canonicalAttrId = existingAttr?.id ?? attrId;

// Use canonicalAttrId as sourceId in heldDistributionLedgerTable insert:
await db.insert(heldDistributionLedgerTable).values({
  ...
  sourceId: canonicalAttrId,
  ...
}).onConflictDoNothing();
```

This ensures:
- `sourceId` always points to the real attribution row
- The unique index `hdl_attribution_hold_uq` on `(sourceId, sourceType, partnerId)` correctly deduplicates reprocess attempts
- The one additional SELECT hit `ral_sale_partner_category_uq` index — negligible cost

#### Handling Existing Rows (Pre-Migration)

Before adding the unique index, run a deduplication check:
```sql
SELECT source_id, source_type, partner_id, COUNT(*) 
FROM held_distribution_ledger 
WHERE source_id IS NOT NULL AND hold_type = 'revenue_entitlement'
GROUP BY source_id, source_type, partner_id
HAVING COUNT(*) > 1;
```
Since `FIN_REVENUE_ATTRIBUTION_ENABLED` has never been enabled in production, this will return zero rows. The index can be added safely.

### Schema Change Required: Yes — unique index on `held_distribution_ledger`
### Migration Required: Yes — `pnpm --filter @workspace/db run push` (dev); SQL migration for production
### Risk Level: Low — partial index affects only `revenue_entitlement` hold rows with a non-null `sourceId`

---

## M-3: stockEntitlementKg Consistency Not Validated at API Layer

### Root Cause

The `ownership_transfers` route accepts three KG fields independently:
- `stockEntitlementKg` — total stock at transfer date
- `stockEntitlementRetainedKg` — portion seller retains
- `stockEntitlementTransferredKg` — portion buyer receives

These three fields share a mathematical invariant: `retained + transferred = total`. Neither the `createTransferSchema` nor `patchTransferSchema` enforces this relationship. Each field is validated individually (`z.number().nonnegative()`) but no cross-field check exists.

The attribution engine uses only `transferredKg / totalKg` to compute `effectivePct`. The `retainedKg` field is written to the DB for audit purposes and is never read in any calculation. When `retained + transferred ≠ total`, the engine silently uses the `transferred / total` fraction, which may not match operator intent.

**Concrete example of silent error:** Admin enters `totalKg=1000`, `retainedKg=600`, `transferredKg=500`. Operator intends 60% retained, 40% transferred. Engine computes `effectivePct = offeredPct × 0.5` (50% shift) rather than `0.4`. No error is raised. Attribution is wrong.

### Exact Affected Files

| File | Lines | Issue |
|---|---|---|
| `artifacts/api-server/src/routes/ownership_transfers.ts` | 183–207 | `createTransferSchema` — no cross-field KG validation |
| `artifacts/api-server/src/routes/ownership_transfers.ts` | 350–374 | `patchTransferSchema` — no cross-field KG validation |

Both schemas are defined in the same file. The fix applies to both independently.

### Proposed Fix: Zod `.superRefine()` on Both Schemas

Add a `.superRefine()` validator after the field definitions. Two variants are needed:

#### Variant A — Create Schema (all three fields must be consistent when all provided)

```typescript
const createTransferSchema = z.object({
  // ... existing fields ...
  stockEntitlementKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementRetainedKg: z.number().nonnegative().optional().nullable(),
  stockEntitlementTransferredKg: z.number().nonnegative().optional().nullable(),
  // ...
}).superRefine((data, ctx) => {
  const { stockEntitlementKg, stockEntitlementRetainedKg, stockEntitlementTransferredKg } = data;
  // Only validate when all three are non-null (partial spec is allowed)
  if (
    stockEntitlementKg != null &&
    stockEntitlementRetainedKg != null &&
    stockEntitlementTransferredKg != null
  ) {
    const sum = stockEntitlementRetainedKg + stockEntitlementTransferredKg;
    const TOLERANCE = 0.001; // 1g tolerance for floating-point arithmetic
    if (Math.abs(sum - stockEntitlementKg) > TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `stockEntitlementRetainedKg (${stockEntitlementRetainedKg}) + stockEntitlementTransferredKg (${stockEntitlementTransferredKg}) must equal stockEntitlementKg (${stockEntitlementKg}). Got sum ${sum}.`,
        path: ["stockEntitlementRetainedKg"],
      });
    }
    // Also validate neither component exceeds total
    if (stockEntitlementRetainedKg > stockEntitlementKg + TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `stockEntitlementRetainedKg cannot exceed stockEntitlementKg`,
        path: ["stockEntitlementRetainedKg"],
      });
    }
    if (stockEntitlementTransferredKg > stockEntitlementKg + TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `stockEntitlementTransferredKg cannot exceed stockEntitlementKg`,
        path: ["stockEntitlementTransferredKg"],
      });
    }
  }
});
```

#### Variant B — Patch Schema (same logic, same guard: all three present in the request)

The same `.superRefine()` block applies. Since PATCH sends only changed fields, the validation fires only when the caller includes all three KG fields in one request — which is exactly the case where they must be consistent.

**Limitation acknowledged:** If a caller patches only `stockEntitlementTransferredKg` without providing the other two, the invariant cannot be checked without reading the existing DB row. Variant B covers the most common admin workflow (set all KG fields at once). Full merge-validation (read existing + merge partial) is a future enhancement.

#### Additional Business Rule: Handling Requires KG or Neither

When `stockEntitlementHandling = 'retain_with_seller'` is set, either:
- All KG fields should be provided (for partial KG split), or
- None (for full retain)

Setting `handling = 'retain_with_seller'` with only `stockEntitlementKg` and no `stockEntitlementTransferredKg` leads to the full-retain path in the engine (which is correct behavior), but the intent may be ambiguous. A warning or documentation note is sufficient here; a hard error is not recommended.

### Schema Change Required: No
### Migration Required: No
### Risk Level: Very Low — adds validation that returns HTTP 400 for previously-invalid inputs that would have caused silent calculation errors. No previously-correct request is rejected.

---

## M-4: False-Positive Claim Row When Processing Fails

### Root Cause

`processOne` claims the event before entering the processing `try` block:

```
claimSaleEvent(INSERT INTO processed_sale_events ... RETURNING id)
   ↓ claimed = true
try {
   ... attribution writes ...
   return { outcome: 'processed' }
} catch (err) {
   return { outcome: 'error', errorMessage: msg }   ← claim row NOT removed
}
```

When the catch fires, the claim row remains in `processed_sale_events` with handler `'sale_revenue_handler'`. The event is now permanently excluded from `processPending`'s pending sweep (which uses `notInArray(claimedEventIds)`). The only recovery path is the admin reprocess endpoint.

**Three-part operational problem:**
1. `GET /admin/sale-events/status` reports `processedByHandler = N` for the handler, including failed events — the count is inflated and misleading.
2. Operators scanning for `pending > 0` will not detect failed events — they appear processed.
3. Failed events have no distinguishing marker in the DB; only the absence of `revenue_attribution_lines` rows reveals the failure, requiring cross-table investigation.

### Detailed Flow Review

#### `claimSaleEvent` (claim.ts)
```sql
INSERT INTO processed_sale_events (event_id, processed_by_handler, notes)
VALUES ($1::uuid, $2, $3)
ON CONFLICT (event_id, processed_by_handler) DO NOTHING
RETURNING id
```
Returns `claimed = true` if the row was inserted, `false` if it already existed. **No status column. No error state.** The row is either present or absent.

#### `processOne` error path
The `try` block can throw from:
- `getConsumedLines` → `resolveBatchEntitlement` → `NoSnapshotError` (most likely in staging for `fifty_percent_revenue` projects or projects without a baseline snapshot)
- `OwnershipDriftError` (ownership percentages don't sum to 100)
- Any DB insert failure inside the processing loop

None of these are currently distinguishable from a successful processed event by inspecting `processed_sale_events` alone.

#### `processPending` claim exclusion
```typescript
const claimedRows = await db
  .select({ eventId: processedSaleEventsTable.eventId })
  .from(processedSaleEventsTable)
  .where(eq(processedSaleEventsTable.processedByHandler, HANDLER_NAME));

const claimedEventIds = claimedRows.map((r) => r.eventId);
// ... notInArray(saleEventJournalTable.eventId, claimedEventIds)
```
This excludes ALL claimed events regardless of success/failure.

#### `sale_events_admin.ts` reprocess path
```typescript
await db.delete(processedSaleEventsTable).where(
  sql`event_id = $1::uuid AND processed_by_handler = $2`,
);
const result = await processOne(db, eventId);
```
Admin explicitly deletes the claim before reprocessing. This is the only recovery path and is correct — but requires admin awareness that the event failed.

### Proposed Fix: Add `outcomeStatus` and `lastErrorMessage` to `processed_sale_events`

This is a **schema-change fix**. The claim row gains two new columns:

```typescript
// In processed_sale_events schema:
outcomeStatus: text("outcome_status").notNull().default("success"),
// Values: 'success' | 'error' | 'processing'
lastErrorMessage: text("last_error_message"),
```

**Updated `claimSaleEvent`:** Insert with `outcome_status = 'processing'` to represent an in-flight claim. Returns `claimed = true` if inserted. If the prior claim has `outcome_status = 'error'`, return `claimed = false` (existing behavior — admin must reprocess).

Wait — if we keep `claimed = false` for error rows, then `processOne` returns `already_processed` for failed events, which is semantically wrong. The fix needs to allow `processOne` to be called again for error events without admin intervention, OR keep requiring admin intervention but make the failure visible.

**Two sub-options:**

**Sub-option B1 — Error events excluded from auto-retry, but visible (recommended)**

The simplest safe fix:
- `claimSaleEvent`: no change (still returns `claimed = false` if row exists)
- `processOne` catch block: **update** the existing claim row: `SET outcome_status = 'error', last_error_message = $msg WHERE event_id = $id AND processed_by_handler = $handler`
- `processPending` query: no change needed (error events are still excluded from auto-sweep — they require admin reprocess, same as today, but now the failure is visible)
- Admin status endpoint: change query from `COUNT(DISTINCT event_id)` to `COUNT(*) FILTER (WHERE outcome_status = 'success')` for processed count, plus `COUNT(*) FILTER (WHERE outcome_status = 'error')` for the error count

**Admin reprocess flow remains identical:** delete the claim row (which has any `outcome_status`), then re-run `processOne`.

```
Timeline for B1:
1. processOne called → claim INSERT → outcome_status = 'success' (default)
2. try block executes
   a. SUCCESS: claim row stays with outcome_status = 'success'  ✓
   b. ERROR: catch block runs UPDATE SET outcome_status = 'error',
             last_error_message = msg  ✓
3. processPending: notInArray still excludes all claimed rows
   → error events require admin reprocess (same as today, now visible)
4. Admin status endpoint: distinguishes success vs error
5. Admin reprocess: DELETE claim, re-run processOne  (unchanged)
```

**Sub-option B2 — Error events auto-retried by processPending**

- `processPending` query: exclude only `outcome_status = 'success'` rows. Error rows re-enter the pending sweep automatically.
- Adds auto-recovery for transient errors (DB hiccup, timeout).
- Risk: Persistent errors (e.g. `NoSnapshotError` — unfixable without data change) will be retried on every `processPending` sweep indefinitely, creating log noise. Needs a `retryCount` cap.

**Recommendation: Sub-option B1.** Keeps the current operational model (errors require admin attention) while making failures visible. Does not introduce auto-retry complexity. After M-1 is fixed, the primary cause of `NoSnapshotError` (fifty_percent_revenue projects) is eliminated — remaining errors are genuinely exceptional and should require admin awareness.

### Detailed Change Set for B1

#### Schema change (processed_sale_events.ts)
```typescript
outcomeStatus: text("outcome_status").notNull().default("success"),
lastErrorMessage: text("last_error_message"),
```

#### processOne.ts — catch block change
```typescript
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  // Update claim to record failure (best-effort — if this UPDATE fails,
  // the claim still exists with default 'success', which is acceptable
  // since admin reprocess will clear it anyway).
  try {
    await db.execute(sql`
      UPDATE ${processedSaleEventsTable}
      SET outcome_status = 'error', last_error_message = ${msg}
      WHERE event_id = ${eventId}::uuid
        AND processed_by_handler = ${HANDLER_NAME}
    `);
  } catch {
    // Swallow — claim UPDATE failure is non-fatal; admin can still reprocess
  }
  return { outcome: "error", eventId, errorMessage: msg };
}
```

#### sale_events_admin.ts — status endpoint change
```typescript
// Change the processedTotal query to:
const [statusCounts] = await db
  .select({
    success: sql<number>`COUNT(*) FILTER (WHERE outcome_status = 'success')::int`,
    error: sql<number>`COUNT(*) FILTER (WHERE outcome_status = 'error')::int`,
    processing: sql<number>`COUNT(*) FILTER (WHERE outcome_status = 'processing')::int`,
  })
  .from(processedSaleEventsTable)
  .where(eq(processedSaleEventsTable.processedByHandler, "sale_revenue_handler"));
```

#### processPending.ts — no change required
Keeping `notInArray(claimedEventIds)` exclusion unchanged preserves the current behavior: error events are excluded from auto-retry and require admin reprocess. This is intentional under B1.

### Schema Change Required: Yes — two new columns on `processed_sale_events`
### Migration Required: Yes — `pnpm --filter @workspace/db run push` (dev); SQL migration for production. Both columns have safe defaults (`'success'` / `NULL`) — no backfill needed for existing rows.
### Risk Level: Medium — changes the admin status endpoint query; all other components are additive. The catch-block UPDATE is wrapped in try/catch so a secondary DB failure cannot break the primary error return.

---

## Cross-Finding Analysis

### Do any fixes interact with each other?

| Pair | Interaction |
|---|---|
| M-1 + M-4 | M-1 eliminates the most common cause of M-4 errors (`NoSnapshotError` for `fifty_percent_revenue` projects). Implementing M-1 first reduces the urgency of M-4. |
| M-2 + M-4 | Both concern reprocess safety. M-2 fixes duplicate held rows; M-4 fixes claim row visibility. They are independent — fix in either order. |
| M-3 + M-2 | No interaction. M-3 is at the data-entry layer; M-2 is at the processing layer. |
| M-3 + M-1 | No interaction. |

### Do any fixes require the others to be done first?

No hard dependencies. M-1 should precede M-4 implementation because M-1 eliminates the dominant class of persistent errors, making M-4's retry/status design simpler to reason about.

---

## Final Verdict

**Can all four fixes be completed without changing Wave 3 business rules?**

**Yes — unconditionally.**

Each fix addresses infrastructure safety, input validation, or operational observability. None alters:
- The attribution formula (`effectivePct = offeredPct × transferredKg / totalKg`)
- The retain_with_seller / transfer_to_buyer branching logic
- The drift guard tolerance (±0.01%)
- The deduction split method (pro_rata_kg)
- The blocked partner detection sources (inheritance claims, succession disputes, governance overrides)
- The event types handled or deferred (SaleCancelled remains Wave 5)
- The held vs credit branching in `processOne`
- The `FIN_LEDGER_ENABLED` dry-run mode
- Any schema column used by the attribution engine itself

The fixes are:
- **M-1:** A guard that prevents the engine from being invoked for the wrong commercial model. Business rules inside the engine are unchanged.
- **M-2:** An idempotency constraint that prevents data duplication. The first held row's content is identical; subsequent attempts are discarded.
- **M-3:** Input validation that rejects inconsistent data before it reaches the DB. The validation enforces the mathematical relationship that the business rules already assume.
- **M-4:** An observability enhancement that records failure state. No processing logic changes; the catch block adds a status update.

All four can be implemented in a single Wave 3.1 patch without any Wave 3 design document revision.

---

## Appendix: File Change Summary

| File | M-1 | M-2 | M-3 | M-4 |
|---|---|---|---|---|
| `artifacts/api-server/src/lib/revenueHandler/index.ts` | ✏️ Add model guard | — | — | — |
| `artifacts/api-server/src/lib/revenueHandler/processOne.ts` | — | ✏️ Resolve canonical attrId + onConflictDoNothing | — | ✏️ Add catch-block UPDATE |
| `artifacts/api-server/src/routes/ownership_transfers.ts` | — | — | ✏️ Add superRefine to both schemas | — |
| `artifacts/api-server/src/routes/sale_events_admin.ts` | — | — | — | ✏️ Update status query |
| `lib/db/src/schema/held_distribution_ledger.ts` | — | ✏️ Add partial unique index | — | — |
| `lib/db/src/schema/processed_sale_events.ts` | — | — | — | ✏️ Add outcomeStatus + lastErrorMessage |

Total files changed: 6. No changes to `resolveBatchEntitlement.ts`, `getConsumedLines.ts`, `blockedPartners.ts`, `categorize.ts`, `processPending.ts` (processOnePending query unchanged), or any lib/api-spec or lib/api-zod generated files.

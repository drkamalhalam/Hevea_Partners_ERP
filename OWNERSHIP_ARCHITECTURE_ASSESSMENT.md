# Ownership Architecture Assessment

**Date:** May 2026  
**Scope:** Deep-dive on all ownership mechanics — tables, formulas, workflows, dependencies, conflict analysis  
**Instruction:** Analysis only. No code modified.

---

## 1. Ownership-Related Tables

### 1.1 Primary Ownership Tables

| Table | File | Purpose | Write Pattern |
|---|---|---|---|
| `contributions` | `contributions.ts` | Source-of-truth for all financial inputs that drive ownership | Append + soft-delete |
| `contribution_verification_events` | `contribution_verification_events.ts` | Immutable audit trail for every verification state change | Append-only |
| `ownership_snapshots` | `ownership_snapshots.ts` | Point-in-time JSONB snapshots of computed ownership positions | Append-only |
| `project_ownership_freezes` | `ownership_freeze.ts` | Permanent freeze record tied to maturity declaration | One record per project (unique on projectId) |
| `partner_ownership_states` | `partner_ownership_state.ts` | Breakdown of each partner's stake into sub-states (transferable, locked, disputed, reserved) | Upsert |
| `ownership_transfers` | `ownership_transfers.ts` | Full lifecycle of a share transfer event (internal or third-party) | State-machine rows |
| `transfer_rofr_offers` | `transfer_rofr_offers.ts` | Right-of-First-Refusal offers sent to existing partners | Append |
| `transfer_otp_events` | `transfer_otp.ts` | OTP challenges used as cryptographic gates on transfers | Append-only |
| `transfer_audit_events` | `transfer_audit.ts` | Append-only journal of every transfer-related admin action | Append-only |
| `inheritance_claims` | `inheritance.ts` | Succession workflow when a partner dies or exits | State-machine rows |
| `inheritance_claimant_shares` | `inheritance.ts` | Proposed/approved percentage splits among claimants | Rows per claimant |
| `inheritance_documents` | `inheritance.ts` | Documents attached to inheritance claims | Append |
| `inheritance_ownership_history` | `inheritance_history.ts` | Write-once record of every inheritance settlement executed | Append-only |
| `valuation_profit_records` | `valuations.ts` | Annual net profit inputs for the valuation formula | Append |
| `valuation_runs` | `valuations.ts` | Recorded runs of the Present Value Annuity formula | Append |

### 1.2 Supporting Tables with Ownership Dependencies

| Table | Ownership Role |
|---|---|
| `agreements` | Stores `ownershipShareLandowner` — contractual ownership split used as the fallback baseline |
| `partners` | Identity anchor for ownership percentages (`partnerId` FK from contributions) |
| `person_master` | Person identity behind partners |
| `projects` | Holds `commercialModel`, `activationStatus`, `lifecycleStatus`, `governanceLocked` — all gate ownership operations |
| `landowner_ledger` | Stores `ownershipPct` used at time of each distribution — creates the financial entitlement trail |
| `distribution_records` | Stores computed partner entitlements derived from ownership % |
| `distribution_previews` | Resolves which ownership snapshot to use for the next settlement |
| `prematurity_succession` tables | OTP-verified claimant participation records with `inheritedSharePct` |

---

## 2. Ownership Calculation Formula

### 2.1 Core Formula (`ownership.ts` — `computeOwnership(projectId)`)

```
Step 1 — Fetch eligible rows from contributions:
  WHERE projectId = ?
    AND contributionType IN ('land_notional', 'economic_investment')
    AND verificationStatus = 'verified'
    AND affectsOwnership = true
    AND deletedAt IS NULL

Step 2 — Group by identity:
  Primary key:  partnerId (UUID) — used when not null
  Fallback key: partnerName (text) — used when partnerId IS NULL

Step 3 — Per partner:
  landTotal     = SUM(amount WHERE contributionType = 'land_notional')
  economicTotal = SUM(amount WHERE contributionType = 'economic_investment')
  partnerTotal  = landTotal + economicTotal

Step 4 — Project total:
  totalRecognizedAmount = SUM(partnerTotal) across all partners

Step 5 — Ownership percentage per partner:
  ownershipPct = ROUND((partnerTotal / totalRecognizedAmount) × 10000) / 100
  (4 decimal places internal, 2 decimal places in output)

Step 6 — Individual amounts rounded to 2dp:
  landTotal    = ROUND(landTotal × 100) / 100
  economicTotal = ROUND(economicTotal × 100) / 100
```

### 2.2 Distribution Resolution Priority (`distribution_previews.ts`)

When a distribution is being computed, the ownership % source is resolved in this priority order:

```
1. Manual override (admin-entered percentage)
2. Specific snapshot (linkedSnapshotId on the distribution)
3. Latest snapshot for this project
4. Agreement-level share (ownershipShareLandowner from agreements table)
```

### 2.3 Valuation Formula (`valuations.ts`)

Used to price ownership transfers — does not alter ownership % itself:

```
ProjectGrossValue = I × [1 − (1 + r)^−N] / r

  I = Average annual net profit (up to 3 most recent post-maturity years)
  r = 0.20 (fixed 20% discount rate)
  N = max(1, 25 − postMaturityYears)   [25-year horizon from maturity date]

Net Profit (per year) = Gross Revenue − Operational Cost − LCA Amount

Share Value = ProjectGrossValue × (partnerOwnershipPct / 100)
```

---

## 3. Ownership Update Triggers / Events

These are the events that change the live ownership position:

| Event | Mechanism | Effect on Ownership |
|---|---|---|
| **Contribution verified** | Admin sets `verificationStatus = 'verified'` on a contribution | Next `computeOwnership()` call will include this contribution — live % changes |
| **Contribution disputed** | Admin sets `verificationStatus = 'disputed'` | Excluded from calculation — live % changes |
| **Contribution deleted** | Soft-delete sets `deletedAt` | Excluded from calculation |
| **Ownership snapshot created** | Manual (admin) or automatic trigger | Captures current computed % into `ownership_snapshots` JSONB |
| **Ownership freeze** | Triggered at maturity declaration | Creates `project_ownership_freezes` record — locks the snapshot used for distributions |
| **Transfer executed** | Admin finalises an `ownership_transfer` | Does NOT modify the contributions table — creates a new snapshot reflecting the transfer |
| **Inheritance settled** | Claim reaches `settled` status | Writes a record to `inheritance_ownership_history` — does NOT modify contributions table |
| **Prematurity succession OTP confirmed** | Claimant OTP verified | Creates a `claimantParticipationRecord` with `inheritedSharePct` — affects live calculation only if integrated back into contributions |
| **Manual adjustment contribution** | Admin records a `manual_adjustment` type contribution | Directly modifies the `computeOwnership()` result if `affectsOwnership = true` |

### 3.1 What Does NOT Trigger a Recalculation

- Changing the partner name
- Updating the project lifecycle
- Changing the LCA amount
- Adding operational costs
- Executing a distribution

---

## 4. Contribution Types Currently Affecting Ownership

### 4.1 Full Contribution Type Enum

| `contributionType` | `affectsOwnership` default | Included in `computeOwnership()`? | Notes |
|---|---|---|---|
| `land_notional` | `true` | **YES** | Directly counted in `landTotal` |
| `economic_investment` | `true` | **YES** | Directly counted in `economicTotal` |
| `recoverable_advance` | `true` | **NO** — not in the `inArray` filter | `affectsOwnership = true` by default but the `computeOwnership` SQL filter only includes `land_notional` and `economic_investment` |
| `manual_adjustment` | `true` | **NO** — not in the `inArray` filter | Same — flag exists but type excluded from core formula |
| `operational_cost` | `false` (hard-coded) | **NO** | Expense type, never ownership-forming |

> **Critical finding:** The `contributions` table schema supports `affectsOwnership = true` on `recoverable_advance` and `manual_adjustment`, but the actual `computeOwnership()` SQL query hard-codes `inArray(contributionType, ["land_notional", "economic_investment"])`, meaning those types are **silently ignored** even when flagged as affecting ownership. This is a latent data inconsistency risk.

### 4.2 `reimbursementFlag`

A boolean column `reimbursementFlag` exists on the `contributions` table (default `false`). It is stored but the `computeOwnership()` function does not filter on it — it is not used in the ownership calculation. Its purpose appears to be accounting-side classification only.

---

## 5. Transfer Ownership Workflow

### 5.1 State Machine

```
draft
  ↓ (submitted by transferor)
pending_rofr
  ↓ (ROFR period: 14 days. Existing partners given first refusal)
  │── rofr_accepted → internal transfer path
  └── rofr_expired / rofr_declined → third-party transfer path
pending_approval
  ↓ (admin approves)
approved
  ↓ (admin executes + OTP verification)
executed
  [or at any point]
cancelled
```

### 5.2 Transfer Rules

| Rule | Enforcement |
|---|---|
| Project must be in `mature_production` lifecycle | Route guard in `ownership_transfers.ts` |
| Project ownership must be frozen (`project_ownership_freezes` record exists) | Route guard |
| `offeredPercentage` cannot exceed transferor's current snapshot share | Validation against `linkedSnapshotId` |
| Third-party transfers require minimum `offeredValue` of ₹1,00,000 | Business rule in route |
| ROFR window: 14 calendar days | `rofrDeadline` set on creation |
| OTP required on execution step | `transfer_otp_events` gate |
| All events logged | `transfer_audit_events` (append-only) |

### 5.3 What Execution Does (and Does Not Do)

**Does:**
- Changes the transfer `status` to `executed`
- Creates a new `ownership_snapshot` reflecting the post-transfer position
- Records to `transfer_audit_events`
- Handles stock entitlement split (if `stockEntitlementHandling` is set)

**Does NOT:**
- Modify the `contributions` table — the source-of-truth contributions are never altered
- Create any new contribution records
- Directly update `partner_ownership_states`

> **Gap:** The executed transfer creates a snapshot, but `computeOwnership()` will still return the pre-transfer result if re-run from scratch against contributions. The snapshot is the canonical post-transfer record, not a contributions entry. This means the live formula and the executed transfer state can diverge.

---

## 6. Inheritance Ownership Workflow

### 6.1 State Machine

```
open
  ↓ (admin review begins)
under_review
  ↓ (developer approves)
developer_approved
  ↓ (documents verified: death cert, legal heir cert, etc.)
documents_verified
  ↓ (admin approves)
approved
  ↓ (settlement executed)
settled
  [or at any point]
rejected
```

### 6.2 Inheritance Documents Required

| Document Type | Stage Required |
|---|---|
| Death certificate | `documents_verified` transition |
| Legal heir certificate | `documents_verified` transition |
| Court succession order | Optional per claim |
| Custom documents | Admin-uploadable |

### 6.3 What Inheritance Settlement Does

- Writes a permanent row to `inheritance_ownership_history` (write-once, no UPDATE)
- Fields recorded: `fromPartnerId`, `claimantId`, `relationship`, `sharePercentage`, `effectiveDate`
- Does **not** create new `contributions` records
- Does **not** modify existing `contributions` records
- Does **not** call `computeOwnership()` — the history table is the only record of the transfer

> **Gap:** Like ownership transfers, inheritance settlement creates a history record but does not feed back into the `contributions` table. The live `computeOwnership()` formula will not reflect an inheritance settlement unless a new contribution is manually added or a snapshot is taken and referenced.

### 6.4 Prematurity Succession

- Activated when a developer dies **before** maturity
- Three pathways: Death-based, Living Handover, Missing Developer (45-day wait)
- Creates `claimantParticipationRecord` with `inheritedSharePct`
- OTP-verified contributions from claimants are recorded separately
- The `disputedAccumulationLedgerTable` holds disputed shares without blocking operations
- Contributions from verified claimants **do** enter the main `contributions` table as new records (OTP-confirmed), which **does** affect `computeOwnership()`

---

## 7. Distribution Ownership Dependencies

### 7.1 How Ownership % Feeds Distribution

```
Distribution Preview request
       ↓
resolveOwnershipShares(projectId, options)
       ↓
  Priority resolution:
  1. Manual override percentage
  2. Specific linkedSnapshotId
  3. Latest ownership_snapshot for project
  4. ownershipShareLandowner from agreements table
       ↓
distributionEngine.compute(grossRevenue, opCost, lcaAmount, ownershipShares)
       ↓
  Contribution model:
    partnerEntitlement = (grossRevenue - opCost - lcaAmount) × ownershipPct
       ↓
distribution_records row → landowner_ledger row (stores ownershipPct used)
```

### 7.2 Landowner Ledger Net Position Formula

```
Net Position =
  + Revenue Entitlement  (SUM of revenue_entitlement ledger entries)
  - Operational Burden   (SUM of operational_burden ledger entries)
  + Recoverable Adjustments
  + LCA Receivable
  + Other Credits
  - Other Debits
```

The `ownershipPct` value stored in each `landowner_ledger` entry is a **snapshot at time of distribution** — it is not recalculated if ownership subsequently changes.

### 7.3 50% Revenue Model Distribution

In the `fifty_percent_revenue` model, ownership % is **not used** for the main revenue split:

```
Landowner Side = Gross Revenue × 0.50 (or configured split)
EPP Side       = Gross Revenue × 0.50

Landowner Net  = Landowner Side - Operational Cost - LCA Amount

EPP Distribution = EPP Side ÷ verified economic participation %
                   (land_notional excluded from EPP calculation)
```

Here, EPP allocation uses **economic_investment contributions only** — land contributions are excluded from EPP, so the `computeOwnership()` formula is partially reused but filtered differently.

### 7.4 Ownership Freeze Dependency

- Distributions reference the frozen snapshot
- `project_ownership_freezes` is checked before any distribution preview or confirmation
- If no freeze exists, the system falls back to the latest snapshot or the agreement share
- Freeze is one-way — cannot be unfrozen without a governance override

---

## 8. Commercial Model Dependencies

| Ownership Mechanic | `ownership_contribution` model | `fifty_percent_revenue` model |
|---|---|---|
| `land_notional` contributions allowed | YES | **NO** — blocked at route level |
| `economic_investment` contributions allowed | YES | YES (but `affectsOwnership` forced to `false`) |
| `affectsOwnership` flag honoured | YES | **NO** — forced `false` on all contributions |
| `computeOwnership()` used for distribution | YES | **Partially** — EPP uses economic % only |
| LCA eligible | YES | **NO** — LCA blocked for this model |
| Ownership snapshots | YES | Not meaningful — no ownership equity |
| Inheritance workflow | YES | **NO** — no ownership equity to inherit |
| Transfer workflow | YES | **NO** — no ownership equity to transfer |
| Valuation engine | YES | **NO** — no ownership equity to value |
| Freeze required for distribution | YES | Not applicable |

> The `commercialModel` field on `projects` is the **master behavioral controller**. It is immutable once a project is `active`. All financial and ownership modules check it before executing.

---

## 9. Ownership Snapshot Generation

### 9.1 Snapshot Schema

```jsonb
ownership_snapshots.entries = [
  {
    partnerId: uuid | null,
    partnerName: string,
    landTotal: number,
    economicTotal: number,
    totalRecognizedAmount: number,
    ownershipPercentage: number,    // 0–100, 4dp
    role: 'landowner' | 'developer' | 'investor' | null
  },
  ...
]
```

Plus header fields: `totalRecognizedAmount`, `landTotal`, `economicTotal`, `lifecycleStatus`, `snapshotType`, `snapshotAt`.

### 9.2 Snapshot Types (`ownershipSnapshotTypeEnum`)

| Type | When Generated |
|---|---|
| `manual` | Admin clicks "Take Snapshot" in OwnershipGuidance UI |
| `pre_transfer` | Auto-generated before executing an ownership transfer |
| `post_transfer` | Auto-generated after executing an ownership transfer |
| `pre_freeze` | Generated at the moment of ownership freeze (maturity) |
| `inheritance_settlement` | Generated after inheritance claim is settled |
| `system` | System-triggered (e.g., lifecycle transition) |

### 9.3 Snapshot Limitations

- Snapshots are computed from the live `computeOwnership()` formula **at the time of generation**
- They do NOT backfill if a prior contribution is later verified or disputed
- Post-transfer snapshots represent the **intended** post-transfer state, but the `contributions` table still shows the pre-transfer inputs
- No automated reconciliation between snapshot history and live formula output
- No integrity check ensuring snapshot entries sum to 100%

---

## 10. Ownership Reports and Dashboards

| Page | Route | What It Shows | Data Source |
|---|---|---|---|
| **Ownership Guidance** | `/ownership` | Live ownership %, partner rankings, land vs economic split, trend graph | `GET /api/ownership/:projectId` → `computeOwnership()` live |
| **Ownership Archive** | `/ownership-archive` | Historical snapshots, snapshot diffs, lifecycle status at capture | `ownership_snapshots` table |
| **Ownership Transfers** | `/ownership-transfers` | Transfer pipeline, ROFR status, execution timeline, wizard | `ownership_transfers`, `transfer_rofr_offers` |
| **Ownership State Manager** | `/ownership-state-manager` | Per-partner stake breakdown: transferable/locked/disputed/reserved | `partner_ownership_states` |
| **Valuation Engine** | `/valuations` | Share value estimates, profit history, formula runs | `valuation_runs`, `valuation_profit_records` |
| **Ownership Analytics** | `/ownership-analytics` | Global KPIs, contribution distribution charts, transfer volume, inheritance stats | `/api/ownership-analytics/*` via `useAuthFetch` |
| **Inheritance Claims** | `/inheritance-claims` | Claim pipeline, document status, claimant share splits | `inheritance_claims`, `inheritance_claimant_shares` |
| **Prematurity Succession** | `/prematurity-succession` | Pre-maturity claimant participation, OTP-verified contributions | `prematurity_succession` tables |
| **Project Details (Contributions tab)** | `/projects/:id` | Per-project contribution list with verification status | `contributions` table |

---

## 11. Conflict Analysis with Target Architecture

The target architecture requires that ownership be derived **only** from these six input types:

| Target Input Type | Description |
|---|---|
| Land Notional Contribution | Value of land contributed |
| Financial Inputs | Direct capital investments |
| Task Expenditures | Project task/work-based expenditures contributing to equity |
| Imported Contributions | Bulk-imported historical contribution records |
| Withdrawal Adjustments | Negative adjustments reducing a partner's ownership basis |
| Reimbursement Adjustments | Credit adjustments for reimbursed costs restoring ownership basis |

### 11.1 Direct Mappings (No Conflict)

| Target Type | Current Equivalent | Mapping Status |
|---|---|---|
| **Land Notional Contribution** | `contributionType = 'land_notional'` | **Direct match** — already in formula, already ownership-forming |
| **Financial Inputs** | `contributionType = 'economic_investment'` | **Direct match** — already in formula, already ownership-forming |

### 11.2 Partial Mappings (Refactor Required)

| Target Type | Current Situation | Gap |
|---|---|---|
| **Withdrawal Adjustments** | No dedicated type exists. Closest is `manual_adjustment` with a negative amount, but it is **excluded** from `computeOwnership()` SQL filter | The `manual_adjustment` type exists in the enum and has `affectsOwnership = true` by default, but the core SQL query never includes it. A withdrawal must be a first-class negative-value contribution type included in the formula. |
| **Reimbursement Adjustments** | `reimbursementFlag = true` exists as a boolean column on contributions — but it is **not used** in `computeOwnership()` at all. It is a metadata flag with no formula effect | Reimbursement adjustments need to be a distinct contribution type (or a signed amount variant) that is explicitly included in the ownership formula |

### 11.3 Missing Types (New Implementation Required)

| Target Type | Current Situation | What Is Needed |
|---|---|---|
| **Task Expenditures** | No equivalent exists. Operational costs (`operational_cost` type) are explicitly blocked from ownership. Task-based expenditures that should form equity have no pathway | A new `contributionType` value (e.g., `task_expenditure`) with `affectsOwnership = true`, included in the `computeOwnership()` SQL filter, and separate routes/UI for recording project task work as equity-forming inputs |
| **Imported Contributions** | No import pathway exists. All contributions are entered manually through the UI. There is no bulk import, CSV ingest, or legacy migration pathway | A new import workflow is needed: file upload → validation → staging → admin review → bulk `verified` insertion into `contributions` table. The `contributionType` for imported records may need a new enum value (e.g., `imported`) or reuse of existing types with an `importBatchId` reference column |

### 11.4 Structural Conflicts

Beyond missing types, the following structural patterns conflict with the target:

| Conflict | Current Behaviour | Target Requirement | Severity |
|---|---|---|---|
| **Transfer execution does not write to contributions** | Executed transfers create a snapshot but do not update the `contributions` table. `computeOwnership()` run fresh will return the pre-transfer result. | The target likely requires that ownership transfers produce audit-traceable contribution adjustments so the formula always derives the correct position from data rows — not just snapshots | **High** |
| **Inheritance settlement does not write to contributions** | Settled inheritance creates an `inheritance_ownership_history` row but not a new contribution. The formula does not reflect the succession. | Inheritance outcomes must produce `contributions`-table adjustments (withdrawal from decedent + land notional or financial input for heir) so that `computeOwnership()` stays canonical | **High** |
| **`manual_adjustment` excluded from formula despite `affectsOwnership = true`** | Schema says this type affects ownership; formula ignores it | If Withdrawal and Reimbursement Adjustments are to be formula inputs, the SQL `inArray` filter must be expanded | **Medium** |
| **`recoverable_advance` flagged as ownership-affecting but excluded from formula** | Same as above — the column is set but the formula ignores it | Clarify: should recoverable advances affect equity? If they map to Financial Inputs or Withdrawal Adjustments in the target, the formula must include them | **Medium** |
| **No negative-amount guard on contributions** | Amount column is `real` with no `CHECK (amount > 0)` constraint — negative withdrawals are theoretically storable but have no formula pathway | Withdrawal Adjustments require negative amounts to reduce the ownership basis. Needs both: a DB-level CHECK allowing negatives only for adjustment types, and formula logic to include them | **Medium** |
| **`affectsOwnership` flag is not the actual formula gate** | The formula only uses `inArray(contributionType, ["land_notional", "economic_investment"])` — the `affectsOwnership` boolean is redundant for most types. It would be meaningless for new types unless the SQL filter is changed to use the flag instead | The target architecture needs the SQL filter to include all contribution types where `affectsOwnership = true`, not a hard-coded type list | **Medium** |
| **Snapshot-based distribution can diverge from live formula** | If ownership changes after a snapshot is taken, the distribution uses stale data until a new snapshot is manually created | The target presumably requires consistent derivation from live formula inputs. Automated snapshot-before-distribution is not enforced | **Low–Medium** |
| **`partnerName` string fallback in identity resolution** | If `partnerId` is null, ownership is grouped by the text string `partnerName`. Two identical names = merged equity; one character difference = split equity | The target architecture's ownership inputs should always be tied to a `personId` (Person Registry) or `partnerId`, never a raw name string | **Medium** |
| **50% EPP calculation excludes `land_notional`** | In the 50% revenue model, EPP is distributed based on economic participation only, explicitly excluding land. This is intentional for that model. | No conflict with target for this model — but any new contribution types (Task Expenditures, Imported) need explicit EPP eligibility flags | **Low** |

---

## 12. Summary: Gap Map

```
TARGET TYPE                 CURRENT STATE           ACTION REQUIRED
─────────────────────────────────────────────────────────────────────
Land Notional Contribution  land_notional ✓         None — direct match
Financial Inputs            economic_investment ✓   None — direct match
Task Expenditures           ✗ Does not exist        Add new contributionType + formula inclusion
Imported Contributions      ✗ No import pipeline    Add import workflow + batch-id tracking
Withdrawal Adjustments      Partial (manual_adj.)   Expand formula filter; allow negative amounts
Reimbursement Adjustments   Partial (flag only)     Promote from flag to first-class type in formula
─────────────────────────────────────────────────────────────────────

STRUCTURAL CHANGES ALSO REQUIRED:
  1. Switch computeOwnership() from hard-coded type list
     to affectsOwnership = true filter (type-agnostic formula)
  2. Transfer execution must produce contributions-table adjustments
  3. Inheritance settlement must produce contributions-table adjustments
  4. Remove/deprecate partnerName string fallback — require partnerId
  5. Add DB CHECK allowing negative amounts only on adjustment types
  6. Add uniqueness/idempotency to import batches
```

---

*Assessment complete. No code was modified.*

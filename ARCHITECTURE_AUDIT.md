# Hevea Partners ERP — Architecture Audit Report

**Date:** May 2026  
**Scope:** Full-stack audit of existing codebase  
**Purpose:** Assess current state, identify reuse/refactor/archive candidates, document risks

---

## 1. System Overview

| Dimension | Detail |
|---|---|
| Frontend | React 18 + Vite, Tailwind CSS, shadcn/ui, Wouter routing, TanStack Query |
| Backend | Express 5, Clerk JWT auth, pino logging, esbuild bundled |
| Database | PostgreSQL, Drizzle ORM, 100 schema files |
| Auth | Clerk (Replit-managed whitelabel) |
| File Storage | Replit Object Storage (GCS-backed sidecar) |
| API Contract | OpenAPI spec → Orval codegen → React Query hooks + Zod schemas |
| Deployment | Replit (pnpm monorepo, three workflow services) |

**Scale:**
- 100 database schema files → ~65 active tables, 20+ audit/ledger tables, remainder indexes/enums/views
- 80+ API route files totalling ~56,000 lines of server code
- 132 frontend page components
- 25 pages still using raw `useAuthFetch` (not yet on generated hooks)

---

## 2. Database Assessment

### 2.1 Identity Layer

| Table | Purpose | Status |
|---|---|---|
| `users` | System auth accounts, Clerk ID ↔ local UUID | **Reusable** |
| `person_master` | Single authoritative identity registry (physical persons) | **Reusable** |
| `person_role_assignments` | Maps persons to operational roles across projects | **Reusable** |
| `person_master_audit` | Immutable audit trail for identity changes | **Reusable** |
| `partners` | External legal entities (landowner/developer/investor) | **Reusable** |
| `claimants` | Claimants attached to partners (succession, inheritance) | **Reusable** |
| `project_participants` | KYC/legal identity for developer+landowner role on a project | **Reusable** |
| `project_witnesses` | Witnesses to agreement signings | **Reusable** |

**Assessment:** Identity is properly separated — `person_master` (physical person) is decoupled from `users` (login account) and `partners` (legal entity). This is a clean architecture. Person ↔ Partner ↔ User are linked via optional FKs, not hard joins.

### 2.2 Project & Governance Layer

| Table | Purpose | Status |
|---|---|---|
| `projects` | Master project record, lifecycle, commercial model | **Reusable** |
| `lifecycle` | Forward-only lifecycle state history | **Reusable** |
| `project_closure_workflow` | Structured closure checklist | **Reusable** |
| `project_creation_otps` | OTP verification during project setup | **Reusable** |
| `nominees` | Nominee designations per project/developer | **Reusable** |
| `nominee_activation_workflow` | Three-pathway succession activation state | **Reusable** |
| `missing_developer` | GD-entry tracking for missing developer pathway | **Reusable** |
| `timeline` | Human-readable project event log | **Reusable** |
| `governance_meetings` | Governance meeting records | **Reusable** |
| `governance_overrides` | Admin override audit trail (write-once) | **Reusable** |
| `disputes` | Dispute filings | **Reusable** |
| `legal_evidence_archive` | Evidence objects linked to disputes | **Reusable** |
| `partner_ownership_state` | Cached/snapshotted ownership positions | **Needs Review** |
| `ownership_freeze` | Freeze events blocking ownership modification | **Reusable** |
| `stubs` | Appears to be placeholder/scaffolding | **Archive** |

### 2.3 Financial Layer

| Table | Purpose | Status |
|---|---|---|
| `contributions` | Central ledger for all capital and operational contributions | **Reusable** |
| `contribution_verification_events` | Immutable verification history | **Reusable** |
| `agreements` | Legal contracts between landowners and developers | **Reusable** |
| `agreement_variables` | Per-agreement variable overrides | **Reusable** |
| `agreement_activation` | Activation/signing workflow state | **Reusable** |
| `agreement_accounting` | Accounting profile linked to each agreement | **Reusable** |
| `generations` | Immutable agreement document snapshots | **Reusable** |
| `lca_configs` | LCA escalation config per project/year | **Reusable** |
| `lca_ledger` | LCA yearly obligation ledger | **Reusable** |
| `lca_payment_events` | Append-only LCA payment history | **Reusable** |
| `expenditures` | Daily expense entries | **Reusable** |
| `expenditure_verification` | Two-step verification state for expenditures | **Reusable** |
| `burden` | Burden rules per project | **Reusable** |
| `burden_recovery` | Recoverable advance tracking | **Reusable** |
| `imbalance_ledger` | Tracks burden imbalances (who paid vs who should have) | **Reusable** |
| `landowner_accounting` | Per-(project, partner) financial position ledger | **Reusable** |
| `distribution_records` | Partner payable per settlement period | **Reusable** |
| `distribution_payment_events` | Append-only payment event log | **Reusable** |
| `distribution_previews` | Cached preview of pending distributions | **Reusable** |
| `held_distribution_ledger` | Distributions held pending governance resolution | **Reusable** |
| `fifty_pct` | 50/50 revenue session state | **Reusable** |
| `loss_absorption` | Loss absorption events | **Reusable** |
| `payable` | Partner payable summaries | **Reusable** |
| `post_maturity_payments` | Post-maturity payment events | **Reusable** |
| `settlement_overrides` | Settlement governance overrides | **Reusable** |
| `payment_transactions` | Payment transaction records | **Reusable** |
| `payment_receiver_accounts` | Bank/UPI account details per partner | **Reusable** |
| `central_payment_accounts` | Project-level payment accounts | **Reusable** |
| `money_custody_ledger` | Custody tracking for held funds | **Reusable** |
| `advances` | Recoverable advance records | **Reusable** |
| `valuations` | LNV valuation records | **Reusable** |

### 2.4 Operations Layer

| Table | Purpose | Status |
|---|---|---|
| `production` | Tapping session header records | **Reusable** |
| `production_log` | Daily production collection entries | **Reusable** |
| `collection_entries` | Granular collection records per tree/zone | **Reusable** |
| `store_entries` | Physical goods received at store | **Reusable** |
| `inventory` | Current stock positions per project/type | **Reusable** |
| `inventory_reservations` | Stock reserved for pending sales | **Reusable** |
| `multi_store` | Multi-store location and zone tracking | **Reusable** |
| `production_employee_assignments` | Collector assignment (legacy, pre-Person Registry) | **Needs Refactor** |
| `observation_assignments` | Observer assignment (legacy, pre-Person Registry) | **Needs Refactor** |
| `workforce` | NEW: Person Registry-backed workforce assignments | **Reusable** |
| `sales` | Sale transaction header | **Reusable** |
| `sales_orders` | Sales order management | **Reusable** |
| `sales_invoices` | Invoice generation | **Reusable** |
| `sale_audit` | Audit trail for sales changes | **Reusable** |
| `sale_documents` | Documents attached to sales | **Reusable** |
| `buyers` | Buyer registry | **Reusable** |
| `project_sales_permissions` | Per-user sales access control | **Reusable** |
| `transfer_audit` | Stock transfer audit log | **Reusable** |
| `transfer_otp` | OTP verification for stock transfers | **Reusable** |
| `transfer_rofr_offers` | Right-of-first-refusal transfer offers | **Needs Review** |

### 2.5 Succession & Inheritance Layer

| Table | Purpose | Status |
|---|---|---|
| `inheritance` | Inheritance claim records | **Reusable** |
| `inheritance_history` | Write-once ownership history audit | **Reusable** |
| `prematurity_succession` | Pre-maturity succession records | **Reusable** |
| `ownership_snapshots` | Point-in-time ownership state snapshots | **Reusable** |
| `ownership_transfers` | Ownership transfer events | **Reusable** |

### 2.6 System / Audit Layer

| Table | Purpose | Status |
|---|---|---|
| `activity` | General activity log | **Reusable** |
| `audit` | Structured system audit log | **Reusable** |
| `financial_audit` | Financial operation audit trail | **Reusable** |
| `operational_access_logs` | Access logs for operational modules | **Reusable** |
| `operational_alerts` | Alert queue for operational anomalies | **Reusable** |
| `operational_tasks` | Task queue for operational workflows | **Reusable** |
| `document_access_logs` | Document access audit | **Reusable** |
| `record_snapshots` | Versioned snapshots of any record | **Reusable** |
| `field_event_queue` | Queue for offline/mobile field events | **Needs Review** |
| `backup` | Backup job tracking | **Reusable** |
| `user_sessions` | User session tracking | **Reusable** |
| `report_export_jobs` | Report generation job queue | **Reusable** |
| `report_access_audit` | Audit who accessed which report | **Reusable** |
| `analytics_saved_views` | Saved filter states for analytics | **Reusable** |
| `notifications` | In-app notification queue | **Reusable** |
| `documents` | Document storage metadata | **Reusable** |
| `templates` | Agreement template registry | **Reusable** |

### 2.7 Enums

Defined in `enums.ts`:
- `project_status`: `planning`, `developing`, `maturing`, `tapping`, `completed`, `missing_developer`
- `lifecycle_status`: `prematurity`, `mature_production`, `closed`
- `commercial_model`: `ownership_contribution`, `fifty_percent_revenue`
- `contribution_type`: `land_notional`, `economic_investment`, `operational_cost`, etc.
- `person_kyc_status`: `pending`, `verified`, `rejected`
- `role`: `admin`, `developer`, `landowner`, `investor`, `employee`, `operational_staff`

**No PostgreSQL stored procedures, triggers, or named views** — all logic lives in Drizzle queries and route handlers.

---

## 3. Module Inventory

| Group | Module | Route | Completeness | Reuse Potential |
|---|---|---|---|---|
| Core | Dashboard | `/dashboard` | Complete | High |
| Core | Projects | `/projects` | Complete | High |
| Core | Project Details | `/projects/:id` | Complete | High |
| Core | Project Creation Wizard | `/projects/create` | Complete | High |
| Core | Person Registry | `/person-registry` | Complete | High |
| Core | Person Profile | `/person-registry/:id` | Complete | High |
| Core | My Portfolio | `/my-portfolio` | Complete | High |
| Finance | Agreements | `/agreements` | Complete | High |
| Finance | Agreement Details | `/agreements/:id` | Complete | High |
| Finance | Templates | `/templates` | Complete | High |
| Finance | Generate Agreement | `/generate-agreement` | Complete | High |
| Finance | Activation Tasks | `/activation` | Complete | High |
| Finance | Contributions | `/contributions` | Complete | High |
| Finance | LCA Config | `/lca/config` | Complete | High |
| Finance | LCA Ledger | `/lca/ledger` | Complete | High |
| Finance | LNV Governance | `/lnv-governance` | Complete | High |
| Finance | Landowner Account | `/landowner-account` | Complete | High |
| Finance | Expenditure | `/expenditure` | Complete | High |
| Finance | Burden Accounting | `/burden` | Complete | High |
| Finance | Recoverable Advances | `/advances` | Complete | Medium |
| Finance | Post-Maturity Payments | `/post-maturity-payments` | Complete | Medium |
| Operations | Field Operations | `/field-ops` | Complete | High |
| Operations | Production Log | `/production-log` | Complete | High |
| Operations | Inventory | `/inventory` | Complete | High |
| Operations | Multi-Store | `/multi-store` | Complete | High |
| Operations | Store Entries | `/store-entries` | Complete | High |
| Operations | Collection Entries | `/collection-entries` | Complete | High |
| Operations | Sales Orders | `/sales-orders` | Complete | High |
| Operations | Sales Audit | `/sales-audit` | Complete | High |
| Operations | Distribution Workflow | `/distribution` | Complete | High |
| Operations | Workforce Assignments | `/employee-assignments` | Complete (refactored) | High |
| Analytics | Analytics Hub | `/analytics-hub` | Complete | High |
| Analytics | Global Analytics | `/global-analytics` | Complete | High |
| Analytics | Project Analytics | `/project-analytics` | Complete | High |
| Analytics | Financial Reports | `/financial-reports` | Complete | High |
| Analytics | Ownership Analytics | `/ownership-analytics` | Complete | High |
| Analytics | Settlement Analytics | `/settlement-analytics` | Complete | High |
| Analytics | Operational Analytics | `/operational-analytics` | Complete | High |
| Analytics | Financial Analytics | `/financial-analytics` | Complete | High |
| Analytics | Documents | `/documents` | Complete | High |
| Governance | Governance Center | `/governance` | Complete | High |
| Governance | Inheritance Claims | `/inheritance-claims` | Complete | High |
| Governance | Nominee Succession | `/nominee-succession` | Complete | High |
| Governance | Succession Workflow | `/prematurity-succession` | Complete | High |
| Governance | Settlement Governance | `/settlement-governance` | Complete | High |
| Settlement | 50% Revenue | `/fifty-pct-settlement` | Complete | High |
| Settlement | Partner Payable | `/partner-payable` | Complete | Medium |
| Settlement | Loss Absorption | `/loss-absorption` | Complete | Medium |
| Settlement | Final Settlement | `/final-settlement` | Complete | Medium |
| Settlement | Distribution Records | `/distribution-records` | Complete | High |
| System | Admin | `/admin` | Complete | High |
| System | Governance Reports | `/governance-audit-reports` | Complete | High |
| System | Override History | `/governance-overrides` | Complete | High |
| System | Disputes | `/disputes` | Complete | High |
| System | Evidence Archive | `/evidence-archive` | Complete | High |
| System | Report Exports | `/report-exports` | Complete | High |
| System | Data Health | `/data-health` | Complete | High |
| System | Audit Logs | `/audit-logs` | Complete | High |

**Placeholder modules (UI shell, no meaningful data yet):**
- `/reports` — stub page, no backend implementation

---

## 4. Authentication Assessment

### 4.1 Authentication Flow

```
Browser → Clerk → JWT → requireAuth middleware
         ↓
   getAuth(req)
   clerkUserId → usersTable lookup → req.dbUserId, req.userRole, req.userProjectIds
         ↓
   Route handler → canAccessProject(req, projectId) | requireRole(...) | requireFinancialRole
```

**Status: Solid.** The two-step auth (Clerk JWT → local DB lookup) is correct. 401 is returned if Clerk ID is absent or user not in local DB.

### 4.2 Role System

| Role | Access Scope | Can Access All Projects |
|---|---|---|
| `admin` | All modules, all operations | Yes |
| `developer` | All modules, all operations | Yes |
| `landowner` | Assigned projects, financial views | No |
| `investor` | Assigned projects, financial views | No |
| `employee` | Assigned projects, operational views | No |
| `operational_staff` | Assigned projects, operations only | No |

**Authoritative source:** `usersTable.role` column — not Clerk metadata.

**Frontend caching:** Role is cached in `localStorage` (`hevea_role_{userId}`) to prevent UI flicker. Server always wins on conflict.

### 4.3 Identified Permission Issues

| Issue | Location | Severity |
|---|---|---|
| Hard-coded `role !== "admin" && role !== "developer"` | `ExpenditureAnalytics.tsx` | Low — works, but not using the central `ROLE_PERMISSIONS` map |
| Hard-coded admin/dev check | `FinancialAuditLog.tsx`, `OperationalAccessLog.tsx` | Low |
| Default role `"employee"` for unknown Clerk users | `auth.ts` | Medium — silent fallback could expose data if a Clerk user is not provisioned in the local DB |
| Duplicate permission models | `permissions.ts` (frontend) + `requireRole` (backend) | Medium — two independent enforcement systems must be kept in sync manually |
| No rate limiting on auth endpoints | `requireAuth` middleware | Medium |

### 4.4 Session Handling

- Sessions are stateless (JWT-based via Clerk). No server-side session store.
- `user_sessions` table exists in schema — appears to be a supplemental activity tracker, not required for auth.

---

## 5. Project Architecture Assessment

### 5.1 Lifecycle State Machine

```
prematurity → mature_production → closed
```

- Forward-only — no rollback.
- Transitions enforced in `POST /projects/:id/lifecycle`.
- History tracked in `projectLifecycleHistoryTable`.
- `activationStatus` governs whether operations are permitted: only `active` projects may run.

### 5.2 Commercial Model Immutability

- `commercialModel` is immutable once a project is `active` — enforced in `PATCH /projects/:id`.
- Governance override required to change it (logged in `governance_overrides`).
- `projectCode` is write-once once set.

### 5.3 Model Behavioral Divergence

| Capability | `ownership_contribution` | `fifty_percent_revenue` |
|---|---|---|
| LCA | Enabled | Disabled |
| Ownership equity | Enabled | Disabled |
| Land Notional Value | Enabled | Disabled |
| Inheritance | Enabled | Disabled |
| Contribution tracking | Enabled | Disabled |
| 50% revenue waterfall | Disabled | Enabled |
| EPP distribution | Disabled | Enabled |

Both API routes and frontend UI gate on `commercialModel` — consistent enforcement.

---

## 6. Document System Assessment

### 6.1 Architecture

```
Templates (DOCX in GCS)
       ↓
templateLibrary API → signed download URL
       ↓
variableResolver.ts → resolves 16+ built-in {{TOKENS}} from DB
       ↓
documentGenerator.ts (docxtemplater) → ZIP XML replacement
       ↓
generations table (immutable snapshot) + signed upload to GCS
```

### 6.2 Variable Resolution Hierarchy

1. `overrideValue` (per-agreement manual override)
2. `resolvedValue` (auto-resolved from DB: partner name, dates, amounts)
3. Empty string (never crashes — renders `[PENDING: VARIABLE_NAME]`)

### 6.3 Capabilities

- DOCX template modification: **Full**
- PDF direct generation: **Not supported** — DOCX only; PDF requires external conversion
- Template versioning: **Supported** (immutable `generations` snapshots)
- Variable parser: Regex `{{[A-Z0-9_]+}}` with Indian legal formatting (`formatters.ts`)

### 6.4 Gaps / Risks

| Issue | Risk |
|---|---|
| No PDF generation server-side | Users must convert DOCX → PDF externally |
| No template schema validation | If a template has a typo in a `{{TOKEN}}`, it silently falls back to empty string |
| GCS sidecar dependency | If `REPLIT_SIDECAR_ENDPOINT` is unavailable, all file operations fail |

---

## 7. Ownership Assessment

### 7.1 Ownership Calculation

```
Ownership % = Partner's verified contributions / Total verified contributions
             (land_notional + economic_investment types only, affects_ownership = true)
```

Identity is unified by `partnerId` first, `partnerName` as fallback — potential data quality risk if names differ slightly.

### 7.2 Ownership Modification Workflows

1. **Contribution verification** — admin verifies contribution → recalculates ownership
2. **Ownership transfer** — OTP-verified two-party transfer with ROFR offers
3. **Inheritance claim** — post-maturity legal succession, write-once history
4. **Prematurity succession** — pre-maturity participation transfer
5. **Governance freeze** — `ownership_freeze` blocks any modification when active

### 7.3 Risks

| Risk | Severity |
|---|---|
| Partner identity fallback to `partnerName` string | High — duplicate names could silently merge ownership positions |
| No formula version history | Medium — if calculation logic changes, old snapshots may not be reproducible |
| `partner_ownership_state` table is a cached view | Medium — could go stale if sync logic has a bug |
| No ceiling/floor validation on ownership % totals | Medium — should always sum to 100%; no DB constraint enforces this |

---

## 8. Financial Assessment

### 8.1 Financial Data Model

```
Contributions (verified) → Ownership Equity
Production → Inventory → Sales → Gross Revenue
Gross Revenue - OpCost - LCA = Distributable Pool
Distributable Pool × Ownership% = Partner Entitlement
Entitlement - Burden - Recoverable Advances = Net Payable → distribution_records
```

### 8.2 LCA Engine

- Compounded escalation: `baseAmount × (1 + escalationPct/100)^yearOffset`
- Carry-forward for unpaid years
- Sequential — must be applied in year order
- Applies only to `ownership_contribution` + `mature_production` projects

### 8.3 Burden Engine

- Matches expenditures to burden rules by `bearerType`: `developer`, `landowner`, `shared`, `proportional`
- Creates `imbalance_ledger` entries when actual payer ≠ expected bearer
- Imbalances become `recoverable_advances`

### 8.4 50% Revenue Waterfall

```
Gross Revenue ÷ 2 = Landowner Side (50%) + EPP Side (50%)
Landowner Side − OpCost − LCA = Landowner Net
EPP Side (never reduced by costs) ÷ EPP participants = Individual EPP share
```

### 8.5 Financial Risks

| Risk | Severity |
|---|---|
| No double-entry accounting ledger | High — financial positions are computed views, not ledger debits/credits |
| Distribution engine has no idempotency key | High — if called twice, could create duplicate distribution records |
| Settlement can be created without requiring linked sales | Medium — revenue figures could be manually entered |
| `analytics_hub` queries failing (500 errors observed in logs) | Medium — `project_participants` join may be broken |

---

## 9. Inventory Assessment

### 9.1 Stock Flow

```
Production batch → inventory_stock_movements (direction: in)
Sales dispatch   → inventory_stock_movements (direction: out)
Stock transfer   → inventory_stock_movements (transfer between stores, no net change)
```

### 9.2 Stock Types

- `latex` — raw tapped latex
- `rubber_sheet` — processed sheets
- `rubber_scrap` — processing residue

### 9.3 Multi-Store Architecture

- `multi_store` tracks physical locations (Zone/Rack system)
- `capacityKg` enforced at store level
- No operations permitted on `closed` projects

### 9.4 Inventory Risks

| Risk | Severity |
|---|---|
| No negative stock prevention at DB level | High — a DB constraint would prevent stock going below zero; currently only enforced in app code |
| `inventory_reservations` and live stock not atomically reconciled | Medium — race condition possible on high-volume dispatch |
| Production employee assignments (`production_employee_assignments`) use old identity model | Medium — not linked to Person Registry |

---

## 10. UI Assessment

### 10.1 Navigation Structure

Five-tier sidebar hierarchy: **Core → Finance → Operations → Analytics → Governance → Settlement → System**

Total routed pages: **132 components**

### 10.2 Duplicate / Overlapping Screens

| Concern | Pages | Recommendation |
|---|---|---|
| Two workforce assignment entry points | `EmployeeAssignments.tsx` (global) + `WorkforceTab.tsx` (in ProjectDetails) | Intentional — global is for admin bulk view, project tab for project-scoped view. Keep both. |
| Analytics split across 8 pages | `AnalyticsHub`, `GlobalAnalytics`, `ProjectAnalytics`, `FinancialAnalytics`, `OwnershipAnalytics`, `SettlementAnalytics`, `OperationalAnalytics`, `FinancialReports` | Functional, but high cognitive load. Consider consolidation into Analytics Hub with sub-tabs. |
| Two contribution entry points | `Contributions.tsx` + `EconomicContributions.tsx` | Review for overlap |
| Settlement split | `FiftyPctSettlement`, `FinalSettlement`, `SettlementGovernance`, `DistributionRecords`, `DistributionWorkflow` | Five screens for one business process — correct for the workflow steps but navigation is complex |

### 10.3 Screens Using Legacy `useAuthFetch`

25 pages still use raw `useAuthFetch` instead of generated hooks from `@workspace/api-client-react`. These pre-date the Orval codegen setup and lack type safety on API responses.

**Highest-value candidates to migrate:**
- `AnalyticsHub.tsx`
- `Dashboard.tsx`
- `FieldOperations.tsx`
- `Expenditure.tsx`

### 10.4 Known DOM Issue

A `<div> cannot appear as a child of <tbody>` warning exists in the browser console — originates from a Radix UI tooltip/popover component being rendered inside a table row in a legacy component. Non-fatal but produces React hydration warnings.

---

## 11. API Assessment

### 11.1 Route Count by Category

| Category | Approximate Route Count |
|---|---|
| Project & Governance | 15 |
| Financial (LCA, Burden, Distribution) | 18 |
| Operations (Production, Inventory, Sales) | 16 |
| Analytics & Reporting | 10 |
| Identity (Users, Partners, Person) | 8 |
| Document & Template | 5 |
| Succession & Inheritance | 6 |
| System & Admin | 10 |

**Total: ~88 route files**

### 11.2 Unused / Legacy Endpoints

| Endpoint | Status |
|---|---|
| `/api/production-assignments` | Legacy — pre-Person Registry collector assignment; superseded by `/workforce-assignments` |
| `/api/observation-assignments` | Legacy — pre-Person Registry; superseded by `/workforce-assignments` |
| `/dev/*` routes | Dev-only internal routes — must be gated in production |
| `/api/backup` | Exists but no confirmed UI consumer |

### 11.3 Analytics Hub Failure (Active Bug)

`/api/analytics-hub/search` and `/api/analytics-hub/meta` are returning 500 errors. Root cause: SQL queries in `analytics_hub.ts` reference `project_participants` table in a join that appears to be mismatched with the current schema. This is actively breaking the Analytics Hub module.

---

## 12. Security Assessment

### 12.1 Strengths

- All routes except `/health` require Clerk JWT verification
- Role-based access enforced at both API and UI layers
- Write-once audit tables prevent tampering with history
- Object storage uses signed URLs — API server never proxies file content
- No `console.log` in server code (pino structured logging throughout)
- All PKs are UUIDs — no enumerable integer IDs

### 12.2 Risks

| Risk | Severity | Location |
|---|---|---|
| Default role `"employee"` for unprovisioned Clerk users | **High** | `auth.ts` — a user who signs up via Clerk but is not yet in the DB gets `employee` access silently |
| `/dev` routes must be disabled in production | **High** | `routes/index.ts` — no `NODE_ENV` guard observed |
| Duplicate permission enforcement (frontend + backend can drift) | **Medium** | `permissions.ts` vs `requireRole` |
| No rate limiting | **Medium** | All API routes |
| Sensitive financial data in query params (project IDs in URLs) | **Low** | Standard pattern, acceptable |
| `transfer_rofr_offers` logic and access control | **Low** | Needs review — ROFR is a legally sensitive operation |
| Aadhaar numbers stored in plaintext | **Medium** | `person_master.aadhaar_number` — should be encrypted at rest or hashed |

---

## 13. Technical Debt Assessment

### 13.1 Dead / Legacy Code

| Item | Status |
|---|---|
| `production_employee_assignments` table + routes | Legacy identity model — superseded by Person Registry + `workforce` table |
| `observation_assignments` table + routes | Legacy identity model — superseded |
| `stubs.ts` schema file | Appears to be scaffolding placeholder |
| `field_event_queue` table | Unclear current usage — mobile offline sync feature that may not be fully implemented |
| 25 pages on `useAuthFetch` | Pre-codegen pattern — should migrate to generated hooks for type safety |

### 13.2 Incomplete Implementations

| Item | Notes |
|---|---|
| `/reports` page | UI shell only — no backend implementation |
| PDF generation | No server-side PDF conversion; users must convert DOCX manually |
| `field_event_queue` | Mobile offline queue exists in schema but no confirmed processor |
| Analytics Hub 500 errors | Active bug in `analytics_hub.ts` SQL joins |

### 13.3 Structural Observations

- **No DB-level constraints on ownership % sum** — should sum to 100%, not enforced
- **No idempotency keys on distribution creation** — risk of duplicate runs
- **`partner_ownership_state` is a cached computed view** — stale risk if sync fails
- **Two separate permission systems** (frontend `permissions.ts` + backend `requireRole`) — must be manually kept in sync

---

## 14. Reuse Candidates

All of the following are production-grade and should be carried forward as-is:

- Entire Clerk auth middleware chain (`requireAuth`, `resolveActor`, `canAccessProject`)
- `person_master` identity registry and `PersonMasterSelector` UI component
- Agreement template system (docxtemplater + variable resolver)
- LCA engine
- Burden/imbalance engine
- Distribution + 50% revenue waterfall engines
- Landowner accounting ledger
- Multi-store inventory system
- Governance state machine (nominee, inheritance, succession)
- OpenAPI → Orval codegen pipeline
- All write-once audit tables
- Object storage layer (`objectStorage.ts`, signed URL pattern)
- `WorkforceTab` / `EmployeeAssignments` (just rebuilt on Person Registry)

---

## 15. Refactor Candidates

| Item | Recommended Refactor |
|---|---|
| `production_employee_assignments` | Deprecate; migrate consumers to `workforce` table |
| `observation_assignments` | Deprecate; migrate consumers to `workforce` table |
| 25 `useAuthFetch` pages | Migrate to generated React Query hooks (type safety + caching) |
| Hard-coded role checks in components | Centralise through `useCanAccess` / `ROLE_PERMISSIONS` map |
| Analytics Hub SQL joins | Fix broken `project_participants` join causing 500 errors |
| Default `"employee"` fallback for unknown Clerk users | Return 401 or 403 instead of silent permission grant |
| Analytics module navigation (8 pages) | Consolidate into Analytics Hub with sub-tabs |

---

## 16. Archive Candidates

| Item | Reason |
|---|---|
| `stubs.ts` | Scaffolding placeholder — no live usage |
| `/dev` routes (without production guard) | Internal tooling — should be removed or properly gated |
| Old `production_employee_assignments` DB + API routes | After workforce migration is complete |
| Old `observation_assignments` DB + API routes | After workforce migration is complete |

---

## 17. High-Risk Areas

| Risk | Priority |
|---|---|
| **Analytics Hub 500 errors** (active bug) | Immediate |
| **Default `"employee"` for unprovisioned Clerk users** | Immediate |
| **`/dev` routes exposed in production** | Immediate |
| **No idempotency on distribution creation** | High |
| **Ownership % no DB-level sum constraint** | High |
| **Aadhaar numbers stored in plaintext** | High |
| **No negative stock prevention at DB level** | Medium |
| **Legacy assignment tables still active** while new workforce system exists | Medium |
| **`partner_ownership_state` cache staleness** | Medium |

---

## 18. Migration Recommendations

### Phase 1 — Immediate (Stability)
1. Fix Analytics Hub SQL join bug causing 500 errors
2. Add `NODE_ENV` production guard to `/dev` routes
3. Change unknown Clerk user fallback from `employee` to 401

### Phase 2 — Short Term (Quality)
4. Migrate 25 `useAuthFetch` pages to generated hooks
5. Add DB-level `CHECK` constraint ensuring ownership % sums to 100%
6. Add idempotency token to distribution creation
7. Deprecate `production_employee_assignments` and `observation_assignments` routes (migrate remaining consumers to `workforce`)

### Phase 3 — Medium Term (Security & Compliance)
8. Encrypt/hash Aadhaar numbers at rest
9. Add rate limiting to API routes
10. Add DB-level `CHECK` constraint preventing negative inventory stock
11. Unify permission model — single source of truth serving both frontend and backend checks

### Phase 4 — Long Term (UX Consolidation)
12. Consolidate 8 analytics pages into Analytics Hub with sub-tabs
13. Implement server-side PDF generation
14. Build field event queue processor for offline mobile support
15. Implement the `/reports` placeholder module

---

*Audit complete. No code was modified during this phase.*

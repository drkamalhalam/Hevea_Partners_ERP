# Hevea Partners — Multi-Project Plantation ERP

A full-stack ERP-style web platform for a multi-project natural rubber (Hevea brasiliensis) plantation joint-venture business in Tripura, India. Features a public marketing landing page and a private partner portal with role-based access across 6 user roles and 13 planned modules.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/plantation-web run dev` — run the frontend (port 23087)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18 + Vite + Tailwind CSS + shadcn/ui + wouter + @tanstack/react-query
- API: Express 5 + Clerk JWT middleware (`@clerk/express`)
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk (Replit-managed whitelabel)
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (contract-first: OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)
- Charts: Recharts

## Where things live

- `artifacts/plantation-web/src/pages/` — all page components (13 modules + Home)
- `artifacts/plantation-web/src/components/layout/` — Layout, Sidebar (ERP dark), Navbar (header)
- `artifacts/plantation-web/src/components/shared/` — ModulePlaceholder (reusable under-construction template)
- `artifacts/plantation-web/src/contexts/RoleContext.tsx` — role + project assignment context (uses `string[]` UUIDs)
- `artifacts/plantation-web/src/contexts/ProjectFilterContext.tsx` — project filter state (`string | null` UUID)
- `artifacts/plantation-web/src/components/auth/CanAccess.tsx` — RBAC guard (`project?: string` UUID)
- `artifacts/api-server/src/routes/` — API routes (me, users, projects, partners, agreements, dashboard, production, stock)
- `artifacts/api-server/src/routes/me.ts` — GET/PUT /me (current user profile + role)
- `artifacts/api-server/src/routes/users.ts` — GET /users, PUT /users/:id/role, POST /users/:id/projects
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/db/src/schema/` — Drizzle DB schema (source of truth for DB)
  - `users.ts` — usersTable (UUID PK, clerkUserId, role, soft delete, audit cols); exports `userRolesTable` alias
  - `assignments.ts` — userProjectAssignmentsTable (userId UUID FK → users.id)
  - `projects.ts`, `partners.ts`, `agreements.ts`, `production.ts`, `activity.ts`, `notifications.ts`, `audit.ts`, `stubs.ts`
  - `enums.ts` — shared pgEnum definitions
- `lib/api-client-react/` — generated React Query hooks (do not edit manually)
- `lib/api-zod/src/index.ts` — only exports Zod schemas (not types) to avoid name conflicts

## User Roles

Six roles stored in `user_roles` table:
- `admin` — full access to all modules and all projects
- `developer` — full access to all projects
- `landowner` — access only to assigned projects
- `investor` — access only to assigned projects
- `employee` — access only to assigned projects
- `operational_staff` — access only to assigned projects

Admin and developer roles have `canAccessAllProjects = true`. Others are restricted to `userProjectAssignments`.

## Sidebar Modules (13 total, grouped)

| Group | Module | Route | Status |
|---|---|---|---|
| Core | Dashboard | /dashboard | Live |
| Core | Projects | /projects | Live |
| Finance | Agreements | /agreements | Live |
| Finance | Contributions | /contributions | Placeholder |
| Finance | Expenditure | /expenditure | Placeholder |
| Operations | Inventory | /inventory | Placeholder |
| Operations | Sales | /sales | Placeholder |
| Operations | Distribution | /distribution | Placeholder |
| Analytics | Reports | /reports | Placeholder |
| Analytics | Documents | /documents | Placeholder |
| Governance | Governance | /governance | Placeholder |
| Governance | Notifications | /notifications | Placeholder |
| System | Admin | /admin | Live (admin only) |

Also live: Production & Sales (/production), Stock Register (/stock), Partners, My Portfolio.

## Architecture Decisions

- Contract-first API: OpenAPI spec → Orval codegen → React Query hooks + Zod schemas used in both client and server
- **All PKs are UUID** (`gen_random_uuid()` default). No serial/integer IDs anywhere in DB, API, or frontend.
- Clerk auth proxy only enabled in production. `proxyUrl` is `undefined` in development (set dynamically in `app.ts`).
- Server uses `getAuth(req)` from `@clerk/express` to extract userId from JWT (Clerk middleware registered in app.ts)
- Auth middleware does two-step user lookup: clerkUserId → users.id (UUID) → project assignments
- Role context: `RoleContext` calls `/api/me` on load, auto-upserts first-time users as "employee"
- All protected routes use the `ProtectedRoute` wrapper (Clerk `Show when="signed-in"`)
- `lib/api-zod/src/index.ts` only exports Zod schemas from `api.ts` (not types barrel) to avoid duplicate name conflicts when inline body schemas are used
- `assignedProjectIds` throughout frontend is `string[]` (UUID strings), `canAccessProject(id: string)`

## Claimant System

Multiple claimants per partner, project-wise (each claimant is scoped to a specific project stake). Foundation data only — no inheritance settlement logic is implemented.

- DB table: `partnerClaimantsTable` (`lib/db/src/schema/claimants.ts`) — UUID PK, partnerId FK (cascade), projectId FK (cascade), claimantName, relationship, phone, address, claimDocumentsUrl (placeholder), status (`claimantStatusEnum`: registered/pending_verification/verified/disputed), notes, isActive, createdBy
- `claimantStatusEnum` added to `lib/db/src/schema/enums.ts`
- API endpoints: `GET /partners/:id/claimants?projectId=`, `POST /partners/:id/claimants`, `PATCH /partners/:id/claimants/:claimantId`, `DELETE /partners/:id/claimants/:claimantId` in `artifacts/api-server/src/routes/partners.ts`
  - GET supports optional `?projectId=` filter
  - PATCH/POST available to admin+developer; DELETE is admin-only (soft-archive)
- Frontend: `PartnerClaimants` (`artifacts/plantation-web/src/pages/PartnerClaimants.tsx`) — project-wise grouped list with Add/Edit/Remove UI, status badges, and governance disclaimer. Embedded in `PartnerDetails.tsx`.
- Generated hooks: `useListPartnerClaimants`, `useAddPartnerClaimant`, `useUpdatePartnerClaimant`, `useRemovePartnerClaimant`

## Nominee Management System

Every Project Developer must register a governance continuity nominee per project. Nominee details include name, relationship, phone, address, and optional ID document URL. This is **NOT** ownership transfer — it is operational governance continuity only.

- DB table: `projectNomineesTable` (`lib/db/src/schema/nominees.ts`) — UUID PK, projectId FK, nominatedBy FK, nomineeName, relationship, phone, address, idDocumentUrl, isActive, activationStatus (pending/activated/revoked), activationNotes, activatedAt, activatedBy, replacedAt, replacedBy
- API endpoints: `GET/POST/PATCH/PUT/DELETE /projects/:id/nominee` in `artifacts/api-server/src/routes/projects.ts`
  - POST: 409 if active nominee already exists (use PUT to replace)
  - PUT: soft-archives old nominee (isActive=false, replacedAt set), inserts new one
  - DELETE: admin only; soft-archives (isActive=false)
- Frontend: `ProjectNomineeSection` (`artifacts/plantation-web/src/pages/ProjectNominee.tsx`) — Add/Edit/Replace/Remove UI embedded in `ProjectDetails.tsx`
- Profile completeness: `GET /me` returns `profileComplete: boolean` + `missingNomineeProjectIds: string[]` for developers who have not nominated for all their developer-role project assignments. `MyProfile.tsx` shows an amber banner with clickable project links when completeness is false.

## Project Lifecycle System

Forward-only lifecycle state machine for rubber plantation projects. Separate from the operational `status` field — lifecycle tracks the biological/business maturity phase.

**Phases (forward-only, irreversible):**
```
prematurity → mature_production → closed
prematurity → closed  (skip allowed)
```

- **Prematurity** (default for all projects): trees planted and growing, pre-tapping phase
- **Mature Production** (irreversible): trees are mature and actively producing latex
- **Closed** (terminal): project concluded, no further transitions possible

**DB:**
- `projectLifecycleStatusEnum` in `lib/db/src/schema/enums.ts`
- `lifecycleStatus` column on `projectsTable` (default: `"prematurity"`)
- `projectLifecycleHistoryTable` (`lib/db/src/schema/lifecycle.ts`) — UUID PK, projectId FK (cascade), fromStatus (text, nullable), toStatus (enum), remarks (text, nullable), changedBy FK (set null), changedByName (denormalized), changedAt

**API:**
- `GET /projects/:id/lifecycle` — returns `{ projectId, currentStatus, history[] }` (any authenticated user)
- `POST /projects/:id/lifecycle` — `{ toStatus, remarks? }` — admin/developer only; validates forward-only; creates audit history entry + activity log

**Frontend components (`artifacts/plantation-web/src/`):**
- `components/lifecycle/LifecycleBadge.tsx` — colored pill badge (sky=prematurity, emerald=mature, gray=closed); `size="sm"|"md"`
- `components/lifecycle/LifecycleTimeline.tsx` — 3-step horizontal stepper (check=past, filled-circle=current, lock=future) with transition dates
- `pages/ProjectLifecycleSection.tsx` — full card: current badge + timeline + history list + `TransitionDialog` (admin/developer only, with warning for irreversible actions)
- Embedded in `pages/ProjectDetails.tsx` above Participants section

**Scalable architecture notes:**
- `LIFECYCLE_TRANSITIONS` map in `projects.ts` is the single point of truth for valid transitions — add new states by extending the map
- `fromStatus` text column (not enum) allows future states without migrations
- History table designed for future approval workflows: add `approvedBy`/`approvedAt`/`workflowId` columns without breaking existing data

**Generated hooks:** `useGetProjectLifecycle`, `useTransitionProjectLifecycle`, `getGetProjectLifecycleQueryKey`

## Role-Specific Dashboard System

Five separate dashboard functions rendered dynamically based on the logged-in user's role. Root router in `Dashboard.tsx` dispatches by role directly (`role === "admin"` etc.) — no longer uses `canAccessAllProjects` as the branch condition.

| Role | Dashboard Function | Key Sections |
|---|---|---|
| `admin` | `AdminDashboard` | 6 KPIs (projects/partners/agreements/users/governance issues/stock), Governance Alert Panel, System Users role breakdown, Revenue chart, Pending Approvals + Tasks, Full project table |
| `developer` | `DeveloperDashboard` | 5 KPIs (projects/gov issues/at-risk/production/stock), Governance Alert Panel, `ProjectHealthPanel` (per-project governance status sorted by severity), Pending Approvals, Project Performance chart, Compact project table, Activity |
| `landowner` | `LandownerDashboard` | 4 KPIs (projects/active agreements/pending verification/land), Conditional Pending Verifications section (amber, only when agreements have non-active status), Agreements table, Activity, Compact project table |
| `investor` | `InvestorDashboard` | 4 KPIs (projects/agreements/land portfolio/total ownership), Participation Overview (agreement cards with ownership %), Revenue chart (real data or placeholder), Compact project table, Activity |
| `employee` | `EmployeeDashboard` | 3 KPIs, Quick Actions, Recent Production records, Activity |
| `operational_staff` | `StaffDashboard` | 3 KPIs, Quick Actions, Stock Register overview, Activity |

- `ProjectHealthPanel` — reusable helper component in `Dashboard.tsx`, sorts projects by worst governance status (attention_required first), uses `GovernanceStatusBadge xs` inline, links to project detail pages
- `AdminDashboard` user stats: derives role breakdown via `useMemo` from `useListUsers()` response, shows colored role pills + counts
- `LandownerDashboard` pending verifications: `agreements.filter(a => a.status !== "active")` — shows amber warning block only when non-empty

## Governance Status System

Real-time governance completeness tracking for projects, user profiles, and partners. Four status levels: `complete`, `pending`, `incomplete`, `attention_required`.

- API endpoint: `GET /governance/summary` — returns `GovernanceSummary` with three alert buckets
- Access: admin and developer see project + partner alerts for all visible projects; all roles see their own profile alerts
- **Project checks** (admin/developer only): `MISSING_NOMINEE` (attention_required), `NO_PARTICIPANTS` (incomplete), `NO_AGREEMENTS` (incomplete)
- **Profile checks**: `INCOMPLETE_PROFILE` (incomplete) for missing displayName/phone/address; `MISSING_NOMINEE` (attention_required) for developer role with unregistered nominees
- **Partner checks** (admin/developer only): `INCOMPLETE_PARTNER` (incomplete) for missing phone/address; `NO_CLAIMANTS` (incomplete) for partner with no claimants
- Server route: `artifacts/api-server/src/routes/governance.ts` — uses batched DB queries for efficiency (no N+1 queries)
- Components in `artifacts/plantation-web/src/components/governance/`:
  - `GovernanceStatusBadge` — reusable inline badge, `size="sm"` or `"xs"`, accepts all 4 status values
  - `GovernanceAlertPanel` — full panel with three-column issue grid (projects/profile/partners), shown on admin/developer dashboard
- `Dashboard.tsx`: `GovernanceAlertPanel` inserted between KPI cards and analytics charts for admin/developer role
- `Projects.tsx`: per-project governance badge shown in each project card header for admin/developer roles (uses cached React Query data from governance summary)
- Generated hook: `useGetGovernanceSummary()` from `@workspace/api-client-react`
- Generated types: `GovernanceSummary`, `ProjectGovernanceStatus`, `PartnerGovernanceStatus`, `GovernanceAlert` — importable from `@workspace/api-client-react`

## Agreement Template Management System

Master agreement template library with secure GCS-backed file storage. Admin and Developer roles can upload, manage, version, preview, and archive templates.

**Supported formats:** DOCX (Word) and PDF. Exact wording, formatting, and legal structure are preserved — only designated placeholder variables change per agreement.

**Storage:** Replit Object Storage (GCS) via presigned URL upload flow. Files stored in `PRIVATE_OBJECT_DIR`. Served via `GET /api/storage/objects/{objectPath}`.

**DB table:** `agreementTemplatesTable` (`lib/db/src/schema/templates.ts`) — UUID PK, name, description, version, fileObjectPath, fileFormat (docx/pdf), mimeType, fileSizeBytes, status (active/archived), isActive, uploadedBy FK, uploadedByName (denormalized), archivedAt, archivedBy FK

**API endpoints** (`artifacts/api-server/src/routes/templates.ts`):
- `GET /templates?status=active|archived` — list templates (all authenticated)
- `POST /templates` — create template record post-upload (admin/developer)
- `GET /templates/:id` — get single template
- `PATCH /templates/:id` — update name/description/version (admin/developer)
- `POST /templates/:id/archive` — archive (admin/developer)
- `POST /templates/:id/restore` — restore archived template (admin only)

**Storage endpoints** (`artifacts/api-server/src/routes/storage.ts`):
- `POST /storage/uploads/request-url` — request presigned GCS upload URL (two-step upload flow)
- `GET /storage/objects/{objectPath}` — serve uploaded file (auth required)
- `GET /storage/public-objects/{filePath}` — serve public assets

**Frontend:** `artifacts/plantation-web/src/pages/TemplateLibrary.tsx` — split-panel layout: template library list (active/archived tabs + search) on the left, inline preview panel on the right. PDF files previewed in `<iframe>`, DOCX files show metadata + download link. Upload dialog with drag-and-drop file picker. Archive confirmation dialog. Edit metadata dialog.

**Sidebar:** "Templates" added to Finance group (admin/developer only), route `/templates`.

**Generated hooks:** `useListTemplates`, `useCreateTemplate`, `useGetTemplate`, `useUpdateTemplate`, `useArchiveTemplate`, `useRestoreTemplate`, `useRequestUploadUrl`

**Codegen fix:** `lib/api-spec/package.json` codegen script now auto-patches `lib/api-zod/src/index.ts` after Orval runs to only export from `./generated/api` (prevents TS2308 duplicate name errors from inline body schemas).

**Object storage env vars:** `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` (set by Replit sidecar auth, auto-configured)

## Agreement Variable Replacement Engine

Dynamic placeholder substitution system for agreement templates. Replaces `{{VARIABLE_NAME}}` tokens in DOCX/PDF templates with real data from the linked project, partners, and agreement record. No business calculations — pure field-read architecture.

**Placeholder format:** `{{UPPERCASE_WITH_UNDERSCORES}}` (e.g. `{{PROJECT_NAME}}`, `{{LANDOWNER_NAME}}`)

**14 built-in variables across 5 groups:**

| Group | Variables |
|---|---|
| Project | `PROJECT_NAME`, `PROJECT_LOCATION` |
| Parties | `LANDOWNER_NAME`, `DEVELOPER_NAME`, `LANDOWNER_ADDRESS`, `DEVELOPER_ADDRESS` |
| Dates & Place | `DATE`, `EXECUTION_PLACE` |
| Financial | `TERM_YEARS`, `LAND_AREA`, `OWNERSHIP_SHARE`, `DEVELOPER_OWNERSHIP_SHARE`, `LAND_VALUE_PER_UNIT`, `NOTIONAL_LAND_VALUE`, `YEARLY_ESCALATION`, `AMOUNT_IN_WORDS` (auto-computed), `REVENUE_MODEL` |

**All 16 variables are now auto-resolved** — `AMOUNT_IN_WORDS` is computed from `NOTIONAL_LAND_VALUE` using `formatRupeesLegal()` (e.g. `Rs. 1,25,000/- (Rupees One Lakh Twenty-Five Thousand Only)`). No variable requires `dataSource: "manual"` any longer; all can still be overridden via the variable panel.

**Server libs** (`artifacts/api-server/src/lib/`):
- `variableRegistry.ts` — `VARIABLE_REGISTRY` typed map: name, label, description, dataSource, fieldPath, example, group
- `formatters.ts` — pure legal formatting utilities: `amountInWords`, `formatRupeesLegal`, `formatINR`, `legalDate`, `ownershipShareLegal`, `landAreaLegal`, `escalationLegal`, `formatPercent`
- `placeholderParser.ts` — `parsePlaceholders(text)` returns `{ all, known, unknown }`; `replacePlaceholders(text, values, fallback)` for substitution
- `variableResolver.ts` — `resolveAgreementVariables(agreement)` fetches project/partner rows, applies legal formatters to all values
- `documentGenerator.ts` — DOCX generation engine: loads template from GCS, builds variable map from DB, renders via docxtemplater, returns Buffer

**DB table:** `agreementVariableValuesTable` (`lib/db/src/schema/agreement_variables.ts`) — UUID PK, agreementId FK (cascade), variableName, resolvedValue (auto), overrideValue (manual precedence), dataSourceType, isAutoResolved, resolvedAt; unique on (agreementId, variableName)

**API endpoints** (in `artifacts/api-server/src/routes/agreements.ts`):
- `GET /agreements/:id/variables` — returns `AgreementVariablesResponse` with full registry + stored values; any authenticated user with project access
- `PUT /agreements/:id/variables` — batch upsert `{ overrides: [{name, value}] }` (admin/developer)
- `POST /agreements/:id/variables/resolve` — auto-resolves all variables from linked DB data, upserts into the table (admin/developer)

**Response shape:** `{ agreementId, variables[], resolvedCount, pendingCount, totalCount }` — each variable has `resolvedValue`, `overrideValue`, `effectiveValue` (override takes precedence), `isAutoResolved`

**Frontend:** `AgreementVariablePanel` (`artifacts/plantation-web/src/pages/AgreementVariablePanel.tsx`) — embedded in `AgreementDetails.tsx`
- Completion progress bar (resolved/total with % label)
- Variables grouped by category (Project / Parties / Dates & Place / Financial)
- Per-row: status dot, label + `{{TOKEN}}` monospace, source badge (colored by type), effective value with override indicator
- Inline editing: hover to reveal pencil → edit draft → Enter/✓ to save, ✗ to cancel; "×" button clears override back to auto-resolved
- "Auto-Resolve from Data" button: calls `POST /resolve`, invalidates query cache
- Tooltips on variable descriptions, override indicator, manual-only hint
- Read-only view for non-admin/developer roles

**Generated hooks:** `useListAgreementVariables`, `useUpdateAgreementVariables`, `useResolveAgreementVariables`, `getListAgreementVariablesQueryKey`

**Extension points:**
- Add new variables: extend `VARIABLE_REGISTRY`, add a case to `resolveVariable()` in `variableResolver.ts`, add a formatter to `formatters.ts` if needed
- Add new data sources (contributions, ownership): create a resolver context and add cases for the new `dataSourceType`

## Agreement Versioning & Snapshot Preservation System

Immutable point-in-time snapshots of every generated agreement document, with full version history, side-by-side comparison, a dedicated viewer page, and a tamper-evident audit trail.

**Core architecture:** All generation records are WRITE-ONCE — no UPDATE or DELETE through the application. Every snapshot preserves the exact state of the agreement at the moment of generation.

**New columns added to `agreement_generations`:**
- `projectId` UUID FK (set null) — for project-scoped querying
- `lifecycleStatusSnapshot text` — project lifecycle stage at generation time
- `agreementStatusSnapshot text` — agreement status at generation time

**New API endpoints:**
- `GET /agreements/:id/generations/:genId` — single snapshot (for the viewer page)
- `GET /agreements/:id/audit-log` — tamper-evident event trail for all generations

**Audit logging:** Every generation `INSERT` writes an entry to `auditLogsTable`. Every variable override (`PUT /variables`) writes an `UPDATE` entry. Fire-and-forget (non-fatal) to avoid blocking the response.

**Frontend pages/panels:**
- `GenerationViewer.tsx` (route `/agreements/:id/generations/:genId`) — immutable snapshot viewer: metadata card (template, generated by, datetime, lifecycle at generation, agreement status), captured variable table, full styled HTML document preview, Print to PDF
- `AgreementComparePanel.tsx` — client-side diff of two snapshots; dropdown selectors for Version A/B; shows changed/added/removed variables in a colour-coded 3-column table with "show unchanged" toggle
- `AgreementAuditLog.tsx` — vertical timeline of all generation events with operation badges, clickable expandable rows, raw data viewer; embedded at the bottom of AgreementDetails
- `AgreementGenerationsPanel.tsx` updated — History/Compare tab switcher, per-row "View" button (→ GenerationViewer), lifecycle+status chips on each row

**Generated hooks:** `useGetAgreementGeneration`, `useListAgreementAuditLog`, `getGetAgreementGenerationQueryKey`, `getListAgreementAuditLogQueryKey`

## Landowner Accounting Engine

Separate landowner-side accounting ledger tracking four financial flows per (project, partner) pair. **Deliberately isolated** from ownership contribution accounting and economic participant pool accounting.

**Four entry types (all stored in `landowner_ledger_entries`):**

| Type | Direction | Purpose |
|---|---|---|
| `revenue_entitlement` | credit | Landowner's gross revenue share for a period |
| `operational_burden` | debit | Operational costs charged against the landowner |
| `recoverable_adjustment` | credit or debit | One-off adjustments; can be netted |
| `lca_credit` | credit | LCA advances paid (informational) |
| `other_credit` / `other_debit` | either | Catch-all entries |

**Net position formula (confirmed entries only):**
```
net = Σ(credits) − Σ(debits) + lca_receivable (from lca_ledger)
```

**Future integration hooks:** `ownershipPct` for ownership model, `revenueModelType` (`contribution` | `fifty_percent_revenue`) for revenue model, `grossRevenue` for auto-population from sales module.

**DB table:** `landowner_ledger_entries` — UUID PK, projectId FK (restrict), partnerId FK (restrict), entryType, direction, periodLabel, periodStart, periodEnd, description, amount (always positive), grossRevenue, ownershipPct, revenueModelType, isRecoverable, recoveredAmount, recoveryStatus (none/partial/full), status (draft/confirmed/disputed/reversed), notes, audit cols

**API endpoints at `/landowner-account`:**
- `GET /summary?projectId&partnerId` — aggregate net position with full breakdown
- `GET /entries?projectId&partnerId&entryType&status` — list entries (project-visibility filtered)
- `POST /entries` — create entry (admin/developer; draft by default)
- `PATCH /entries/:id` — update entry (admin/developer; confirm via status="confirmed")
- `DELETE /entries/:id` — soft-reverse entry (admin only; sets status="reversed")
- `GET /lca-receivable?projectId` — outstanding LCA balances from lca_ledger for landowner

**Frontend page:** `artifacts/plantation-web/src/pages/LandownerAccount.tsx` at `/landowner-account`
- Project + Landowner filter dropdowns
- 5 KPI cards: Revenue Entitlement | Operational Burden | Recoverable Adj | LCA Receivable | Net Position
- Accounting breakdown line showing the net position formula with real values
- Revenue vs Burden bar chart by period (Recharts, confirmed entries only)
- Tabs: All | Revenue | Burden | Adjustments | LCA Receivable
- Entry table with type badge, direction (±), status badge, confirm/edit/reverse actions
- Add Entry dialog: type-aware form (revenue fields shown for revenue_entitlement, recoverable toggle for burden/adj, direction auto-set but overridable for adjustments)
- LCA Receivable tab pulls directly from lca_ledger with outstanding year breakdown

**Sidebar:** "Landowner Account" added to Finance group (admin/developer/landowner); icon: Landmark

**Generated hooks:** `useGetLandownerAccountSummary`, `useListLandownerLedgerEntries`, `useCreateLandownerLedgerEntry`, `useUpdateLandownerLedgerEntry`, `useReverseLandownerLedgerEntry`, `useGetLandownerLcaReceivable`

## LCA Automatic Calculation Engine

Yearly Land Contribution Adjustment (LCA) auto-generation system with sequential escalation, carry-forward tracking, and full payment event history. Applies to `contribution` revenue model projects only; project must be in `mature_production` lifecycle.

**New DB table:** `lca_payment_events` — individual payment transactions (append-only audit trail)
- UUID PK, ledgerEntryId FK (restrict), configId FK (restrict), projectId FK (restrict), year, amountPaid, paymentDate, paymentRef, notes, recordedById (set null), recordedByName, createdAt

**Auto-generate engine (`POST /lca/configs/:id/auto-generate`):**
- Loops from `startYear` → `toYear` (default: current calendar year, max: currentYear+5)
- For each year: computes `escalationFactor = (1 + esc%)^yearOffset`, `grossDue = baseAmount × escalationFactor`
- Carry-forward = prior year's unpaid `balance` (never escalated further — rule enforced in code)
- Skips years that already have ledger entries (non-destructive, idempotent)
- Returns `{ generated[], skippedYears[], generatedCount, totalYears }`

**Payment events endpoints:**
- `GET /lca/ledger/:id/payments` — list payment events for a ledger entry
- `POST /lca/ledger/:id/payments` — record payment (admin/developer); atomically updates ledger `amountPaid`, `balance`, `status` (pending → partial → paid)

**Full ERP ledger endpoint:** `GET /lca/full-ledger?configId=&projectId=`
- Returns config, all entries (sorted by year), per-entry payment events, and totals breakdown (base, escalation, carry-forward, due, paid, balance)

**Frontend page:** `artifacts/plantation-web/src/pages/LCALedger.tsx` at `/lca/ledger`
- Config selector dropdown
- Config info tiles (project, base LCA, escalation %, start year)
- 6 KPI cards (base total, escalation added, carry-forward, total payable, total paid, outstanding)
- ERP journal table: Year | Base LCA | Escalation+ | Gross Due | Carry-Fwd+ | Total Payable | Paid | Balance | Status
- Expandable row per year: escalation breakdown + payment history timeline
- Running totals footer row
- Auto-Generate dialog: year range selector + bullet explanation of rules
- Record Payment dialog: amount, date, reference, notes; auto-updates ledger entry status
- Legend explaining no-escalation-on-carry-forward rule

**Sidebar:** "LCA Config" + "LCA Ledger" entries in Finance group (admin/developer/landowner)

**Generated hooks:** `useAutoGenerateLcaLedger`, `useGetLcaFullLedger`, `getGetLcaFullLedgerQueryKey`, `useListLcaPaymentEvents`, `useRecordLcaPayment`

## Agreement Generation Workflow System

5-step wizard for creating immutable, permanently-stored agreement documents with full generation history.

**Routes:**
- `GET /api/agreements/:id/generations` — list generation history (newest first)
- `POST /api/agreements/:id/generations` — generate, store, and snapshot (admin/developer only)
- `GET /api/agreements/:id/generations/:genId/download` — re-download stored DOCX

**DB table:** `agreementGenerationsTable` (`lib/db/src/schema/generations.ts`) — UUID PK, agreementId FK (restrict on delete), templateId FK (set null on delete), templateName/Version (denormalized snapshot), variableSnapshot JSONB (immutable key→value of all effective values at generation time), fileObjectPath (GCS path), generatedBy FK (set null), generatedByName (denormalized), generatedAt, notes

**Architecture:** Rows in this table are WRITE-ONCE — no UPDATE or DELETE through the application. Each row is a permanent historical record.

**Object storage:** `ObjectStorageService.saveBuffer(buffer, contentType, filename)` — server-side Buffer upload to GCS private dir, returns `/objects/generated/{uuid}/{filename}` path.

**Wizard steps (`artifacts/plantation-web/src/pages/GenerateAgreement.tsx`):**
1. **Select Agreement** — grouped by project, card picker
2. **Select Template** — active DOCX templates only (PDF blocked with explanation)
3. **Review Variables** — inline progress bar + per-variable status + Auto-Resolve button; own CTA (doesn't use shared nav)
4. **Document Preview** — full styled HTML preview of filled agreement (parties, project details, financials, ownership table, signature block); Print to PDF button via `window.print()`
5. **Confirm & Save** — notes input, bullet summary of what will happen, calls `POST /generations`, auto-triggers DOCX download on success

**History panel (`artifacts/plantation-web/src/pages/AgreementGenerationsPanel.tsx`):** Embedded at the bottom of `AgreementDetails.tsx` — lists all generations newest-first with template name, version, timestamp, generated-by name, variables-filled count, and per-row re-download button.

**Sidebar:** "Generate Deed" added to Finance group (admin/developer only), route `/generate-agreement`, icon `Scroll`.

**Generated hooks:** `useListAgreementGenerations`, `useCreateAgreementGeneration`, `getListAgreementGenerationsQueryKey`

## Legal Document Generation Engine

Generates filled DOCX documents from stored templates by substituting `{{VARIABLE_NAME}}` tokens with the agreement's effective variable values. Preserves all original formatting: legal numbering, paragraph structure, tables, signature blocks, witness sections, headers/footers, and page layout.

**Tech:** `docxtemplater` + `pizzip` — operates on the DOCX ZIP XML directly; only tagged tokens change, everything else is untouched.

**Legal formatting utilities** (`artifacts/api-server/src/lib/formatters.ts`):
- `amountInWords(n)` — Indian place-value system: crore / lakh / thousand (e.g. `125000` → `"One Lakh Twenty-Five Thousand"`)
- `formatRupeesLegal(n)` — full legal expression: `"Rs. 1,25,000/- (Rupees One Lakh Twenty-Five Thousand Only)"`
- `formatINR(n)` — figure only: `"Rs. 1,25,000/-"`
- `legalDate(str)` — `"2026-05-13"` → `"13th day of May, 2026"`
- `ownershipShareLegal(pct)` — `85` → `"85.00% (Eighty-Five Percent)"`
- `landAreaLegal(area, unit)` — `"2.50 Kani"`
- `escalationLegal(pct)` — `"5% per annum"`

**Generation flow:**
1. Admin/developer selects a template from the active DOCX template library
2. `POST /agreements/:id/generate-document { templateId }` — server fetches template from GCS, reads all effectiveValues from `agreementVariableValuesTable`, renders via docxtemplater
3. Unresolved variables render as `[PENDING: VARIABLE_NAME]` — visible in the document so the operator knows what still needs filling
4. Response is `application/vnd.openxmlformats-officedocument.wordprocessingml.document` streamed as an attachment download

**PDF templates:** not supported for generation (PDFs cannot be modified in-place). Users should upload DOCX versions for templates that need variable substitution.

**Frontend:** `AgreementGeneratePanel` (`artifacts/plantation-web/src/pages/AgreementGeneratePanel.tsx`) — embedded below `AgreementVariablePanel` in `AgreementDetails.tsx`
- Variable completion progress bar (amber when pending, green when all resolved)
- Warning showing count of `[PENDING]` variables if any
- Template dropdown (active DOCX templates only)
- "Generate & Download DOCX" button — raw `fetch` call, triggers browser file save
- Success confirmation with filename; error display on failure
- Visible to admin/developer only

**API endpoint:** `POST /agreements/{id}/generate-document` → binary DOCX (in `agreements.ts` route, uses `DocumentGenerationError` for typed error responses with HTTP status codes)

## Seeded Data

- Partners: Ramesh Debbarma (developer), Sukumar Tripura (landowner), Birendra Reang (landowner), Dilip Jamatia (investor)
- Projects: Manu Valley Plantation (developing), Gandacherra Block B (planning), Ambassa Northern Plot (maturing)
- Agreements: 3 active agreements linking the above partners to projects
- Production: 6 records across Ambassa Northern Plot and Manu Valley

## Gotchas

- Clerk proxy returns 404 in development — intentional. Clerk JS loads from CDN in dev. Proxy used in production only.
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` to sync schema changes to Postgres
- `pnpm --filter @workspace/db run seed` to re-populate sample data (uses `tsx`, idempotent via onConflictDoNothing)
- `lib/api-zod/src/index.ts` intentionally only re-exports `api.ts` (Zod schemas), NOT `types/` — avoids TS2308 duplicate name errors when inline body schemas are used in OpenAPI
- All route params/IDs are strings in routes (no `parseInt`/`Number()` conversions — UUIDs come as strings from the URL)
- `@clerk/shared/keys` is not bundled — `app.ts` derives publishable key and proxyUrl directly without it

## Economic Contribution Verification Workflow

Counterparty-designated verification system for economic investment contributions. Supports a full approve → reject → re-approve lifecycle with an immutable event audit trail, pending task dashboard, and governance alerts for unresolved rejections.

**DB schema additions:**
- `contributionVerificationEventTypeEnum` in `enums.ts`: `verification_requested | approved | rejected | re_approved | verifier_changed | otp_sent | otp_verified`
- `designatedVerifierId` + `designatedVerifierName` columns added to `contributionsTable`
- `contributionVerificationEventsTable` (`lib/db/src/schema/contribution_verification_events.ts`) — immutable audit trail; UUID PK, contributionId FK (cascade), eventType, actorId/Name, targetUserId/Name, notes, otpSentAt, otpVerifiedAt

**API endpoints** (`artifacts/api-server/src/routes/contributions.ts`):
- `GET /contributions/pending-verification` — pending items for current user (admin/dev: all; others: only their designated items). **Must be registered before `/:id`** to avoid Express path shadowing.
- `POST /contributions/:id/verify` — approve (admin/dev OR designated verifier); writes `approved` or `re_approved` event
- `POST /contributions/:id/reject` — reject (admin/dev OR designated verifier); writes `rejected` event; requires notes
- `POST /contributions/:id/request-verification` — admin/dev only; assign/reassign verifier, auto-advance draft → pending_verification, writes `verification_requested` or `verifier_changed` event
- `GET /contributions/:id/verification-history` — immutable event timeline; accessible to any user with project access OR designated verifier

**Governance extension** (`artifacts/api-server/src/routes/governance.ts`):
- `REJECTED_CONTRIBUTION` added to `GovernanceIssueCode` (severity: `attention_required`)
- Batch query for rejected `economic_investment` contributions per visible project; surfaces as project-level governance alert for admin/developer

**OpenAPI schema additions:**
- `ContributionEntry`: added `designatedVerifierId` (nullable UUID) + `designatedVerifierName` (nullable string)
- `CreateContributionBody`: added `designatedVerifierId` (optional UUID)
- `UserProfile`: added `id` (optional DB UUID) — exposed so frontend can match logged-in user against `designatedVerifierId`
- `me.ts` `buildProfile()` now includes `id: userRow?.id ?? null`

**Frontend** (`artifacts/plantation-web/src/pages/EconomicContributions.tsx`), route `/contributions/economic`:
- 4 KPI cards: total, pending, verified total (INR), rejected
- Red governance alert banner when rejected contributions exist (with rejection remarks preview)
- **Pending Verification tab**: card grid of pending items with Approve / Reject buttons + OTP placeholder block
- **All Economic Contributions tab**: collapsible table rows with inline `VerificationTimeline` showing full event history
- `AssignVerifierDialog`: assign/change the counterparty verifier; filtered user list by DB UUID
- `ApproveRejectDialog`: approve/reject with notes; re-approval warning for previously-rejected; OTP placeholder notice
- `RecordContributionDialog`: full form with optional verifier designation at creation time
- Current user's DB UUID fetched via `useGetMe()` (`.id`) to compare against `designatedVerifierId`

**Sidebar**: "Economic" entry added to Contributions sub-group (roles: admin, developer, landowner, investor)

**Generated hooks:** `useListPendingVerificationContributions`, `useRequestContributionVerification`, `useListContributionVerificationHistory`

## Ownership Guidance Calculation Engine

Dynamic prematurity ownership percentages based on verified land_notional + economic_investment contributions. Guidance only — not legally binding until the maturity declaration freeze.

**Calculation engine:** Groups all verified `land_notional` and `economic_investment` contributions where `affectsOwnership = true` and `deletedAt IS NULL` by partner (uses `partnerId` UUID as key when linked, else `partnerName`). Computes `percentage = partnerTotal / grandTotal * 100` rounded to 2 dp. Sorted by percentage descending.

**Freeze check:** Queries `projectOwnershipFreezesTable` — if a row exists for the project, `isFrozen = true` is surfaced in the response (maturity declaration workflow creates this row).

**DB table:** `ownershipSnapshotsTable` (`lib/db/src/schema/ownership_snapshots.ts`) — UUID PK, projectId FK, snapshotType (manual/auto_on_verification/maturity_declaration enum), lifecycleStatus, totalRecognizedAmount, landTotal, economicTotal, entries (JSONB: `OwnershipSnapshotEntry[]`), notes, triggeredBy FK, triggeredByName, snapshotAt, createdAt. Migrated via raw psql.

**API endpoints** (`artifacts/api-server/src/routes/ownership.ts`):
- `GET /ownership/summary` — live calculation for all visible projects (`?projectId=` optional filter)
- `GET /ownership/:projectId` — live detail for one project
- `GET /ownership/:projectId/snapshots` — paginated snapshot history (`?limit=`)
- `POST /ownership/:projectId/snapshots` — admin/developer only; saves a manual point-in-time snapshot

**Frontend:** `artifacts/plantation-web/src/pages/OwnershipGuidance.tsx`, route `/ownership`
- KPI row (projects, with-contributions, total-recognized, frozen count)
- Project grid: stacked ownership bar + top-3 partner list + freeze badge, click-through to project detail
- Project detail panel (back-navigation): 4 KPIs + 3-tab layout:
  - **Overview**: donut pie chart (Recharts) + ranked partner bar list
  - **Contribution Breakdown**: table with land / economic / total columns + inline mini bar + %
  - **History**: stacked area trend chart across snapshots + snapshot history table with Save Now button
- Save Snapshot dialog (admin/developer): optional notes, calls `POST /snapshots`, invalidates cache
- Amber "guidance only" disclaimer + frozen-project lock badge with tooltip
- Full recalculate button (invalidates React Query cache)

**Sidebar**: "Ownership Guidance" entry in Finance group (roles: admin, developer, landowner, investor), icon `Scale`

**Generated hooks:** `useGetOwnershipSummary`, `getGetOwnershipSummaryQueryKey`, `useGetProjectOwnership`, `getGetProjectOwnershipQueryKey`, `useListOwnershipSnapshots`, `getListOwnershipSnapshotsQueryKey`, `useCreateOwnershipSnapshot`, `useGetOwnershipSnapshot`, `getGetOwnershipSnapshotQueryKey`

## Ownership Record Archive (Foundation)

Historical archive of ownership snapshots. Builds the structural foundation for the future maturity ownership record and freeze workflow. No freeze is triggered here — read-only archive only.

**New enum value:** `maturity_preview` added to `ownershipSnapshotTypeEnum` (DB migration: `ALTER TYPE ownership_snapshot_type ADD VALUE IF NOT EXISTS 'maturity_preview'`). Four types: `manual`, `auto_on_verification`, `maturity_declaration`, `maturity_preview`.

**New API endpoint:**
- `GET /ownership/:projectId/snapshots/:snapshotId` — single snapshot fetch by ID (any authenticated user with project access)

**Frontend:** `artifacts/plantation-web/src/pages/OwnershipArchive.tsx`, route `/ownership/archive`
- Project selector dropdown (all visible projects)
- 4-KPI row: total snapshots, latest snapshot date + type badge, latest total recognized, maturity preview count
- `MaturityArchivePlaceholder` card — dashed amber border, explains what will appear here when the maturity declaration freeze workflow is built
- `OwnershipTimeline` — vertical timeline of all snapshots newest-first; each row shows type badge (color-coded), date, lifecycle status, partner count, total amount, top partner, notes, sequence number; click-to-expand
- `OwnershipSnapshotPreview` — expanded inline panel with full pie chart + partner breakdown table; fetches detail via `useGetOwnershipSnapshot` (lazy, only when expanded)
- Snapshot type reference legend at bottom

**Snapshot type color coding:**
- `manual` → blue (Camera)
- `auto_on_verification` → green (RefreshCw)
- `maturity_declaration` → amber (Star)
- `maturity_preview` → purple (Eye)

**Sidebar:** "Ownership Archive" entry in Finance group (roles: admin, developer, landowner, investor), icon `Archive`, immediately after "Ownership Guidance"

## Prematurity Ownership & Economic Participation Dashboard

Aggregated single-page dashboard at `/contributions/dashboard` combining ownership guidance, contribution data, pending verifications, and alerts. Clearly labelled as **Prematurity Ownership Guidance** throughout.

**Sections:**
- Amber guidance disclaimer banner ("Prematurity Ownership Guidance — not legally binding until maturity declaration freeze")
- Red rejected-contribution alert panel (with inline preview of rejected items, links to Economic page)
- 6-KPI row: Verified Contributions count, Total Verified Amount, Land Notional total, Economic Investment total, Pending Verification count, Active Partners count
- **Ownership Guidance Cards** (per project): expandable stacked ownership bar + partner %, click to expand full breakdown, links to full `/ownership` view
- **Verified by Type** donut chart: land vs economic split
- **Contribution Trend** bar chart: grouped by month × type (verified only, amounts in ₹K)
- **Partner-wise Contribution Table**: aggregated by partner — land / economic / operational columns + verified/pending/rejected sub-totals + % of grand total
- **Pending Verifications Panel**: amber-bordered list of items awaiting action, links to Economic page
- **Contribution History Timeline**: most recent 15 contributions across all types/statuses with status dot timeline

**Data sources:** `useListContributions`, `useListPendingVerificationContributions`, `useGetOwnershipSummary`, `useGetGovernanceSummary`, `useListProjects`

**Sidebar:** "Participation Dashboard" entry in Finance group (roles: admin, developer, landowner, investor), icon `BarChart3`

**Frontend:** `artifacts/plantation-web/src/pages/ParticipationDashboard.tsx`, route `/contributions/dashboard`

**Ownership route fix:** Routes inside `ownershipRouter` use relative paths (`/summary`, `/:projectId`, `/:projectId/snapshots`) — the `/ownership` prefix comes from `router.use("/ownership", ownershipRouter)` in index.ts.

## Operational Burden Accounting Engine

Tracks who was **expected** to bear each operational cost vs who **actually** paid, computes imbalances, and manages recovery. Completely separate from ownership contributions.

**Core concepts:**
- **BurdenRule** — per-project, per-category, per-lifecycle-phase rule specifying who should bear a cost (`developer` / `landowner` / `shared` % split / `proportional` from agreement ownership %). Category-specific rules beat null=all rules. More recently created rules win ties.
- **BurdenRecord** — one record per expenditure. Auto-matched against active rules, computes `expectedDeveloperAmount`, `expectedLandownerAmount`, `actualDeveloperAmount`, `actualLandownerAmount`, imbalance, and `adjustmentStatus`.
- **adjustmentStatus**: `balanced` | `developer_advance` (dev overpaid) | `landowner_advance` (LO overpaid) | `waived`
- **recoveryStatus**: `none` | `pending` | `in_recovery` | `recovered` | `waived`

**DB tables** (`lib/db/src/schema/burden.ts`): `burden_rules`, `burden_records` — 3 enums in `enums.ts`: `burdenBearerTypeEnum`, `burdenAdjustmentStatusEnum`, `burdenRecoveryStatusEnum`

**API endpoints** (`artifacts/api-server/src/routes/burden.ts`), mounted at `/burden`:
- `GET /burden/summary?projectId=` — totals + per-project breakdown
- `GET /burden/rules?projectId=&includeInactive=` — list active rules
- `POST /burden/rules` — create rule (admin/developer)
- `PATCH /burden/rules/:id` — edit or deactivate rule (admin/developer)
- `GET /burden/records?projectId=&adjustmentStatus=&recoveryStatus=&expenditureId=` — list records
- `POST /burden/records { expenditureId }` — analyse expenditure, auto-match rule, compute imbalance (admin/developer/landowner)
- `PATCH /burden/records/:id` — update notes (admin/developer)
- `POST /burden/records/:id/waive { notes? }` — write off imbalance (admin/developer)
- `POST /burden/records/:id/recover { amount, notes? }` — record recovery payment (admin/developer)

**Frontend** (`artifacts/plantation-web/src/pages/Burden.tsx`), route `/burden`:
- **Summary tab** — 4 KPI cards (developer advance / landowner advance / pending recovery / recovered) + per-project breakdown table
- **Ledger tab** — records table with expected vs actual columns, expandable detail rows, waive (✗) and recover (↻) action buttons, filter by adjustment status
- **Rules tab** — card list of active rules with edit/deactivate, "New Rule" form dialog with bearer-type-aware % split fields
- **Imbalances tab** — carry-forward balance dashboard, partner imbalance summary, transaction ledger with running balance; see below

**Sidebar:** "Burden Accounting" in Finance group (admin/developer only), icon `ArrowLeftRight`, route `/burden`

**Generated hooks:** `useGetBurdenSummary`, `useListBurdenRules`, `useCreateBurdenRule`, `useUpdateBurdenRule`, `useListBurdenRecords`, `useCreateBurdenRecord`, `useUpdateBurdenRecord`, `useWaiveBurdenRecord`, `useMarkBurdenRecordRecovered`

## Imbalance Adjustment & Negative Balance Accounting

Double-entry imbalance ledger that accumulates carry-forward balances per project and party. Foundation layer for future settlement engines — this stage is pure accounting structure only.

**Accounting model:**
- Each event creates a mirrored pair of entries (developer + landowner); the two always sum to zero.
- `amount > 0` = this party is owed money (credit); `amount < 0` = this party owes money (debit)
- Running balance = cumulative sum of all prior entries for a given `(projectId, partyRole)`.
- **Balances may be negative.** Negative means a party has a deficit (owes more than it has been credited).

**Auto-generated entry pairs:**
- `burden_imbalance` — when a burden record with non-zero imbalance is created (fire-and-forget, non-fatal)
- `recovery` — when a recovery payment is recorded on a burden record
- `waiver` — when a burden record imbalance is waived

**Entry types:** `burden_imbalance` | `recovery` | `waiver` | `manual` | `carry_forward`

**DB table:** `imbalance_ledger` (`lib/db/src/schema/imbalance_ledger.ts`) — UUID PK, projectId FK (restrict), partyRole text, amount NUMERIC(14,2) signed, entryType text, burdenRecordId FK (set null), period (YYYY-MM), description, notes, isActive, createdById FK (set null), createdByName (denormalized)

**API endpoints** (`artifacts/api-server/src/routes/burden_imbalances.ts`), also mounted at `/burden`:
- `GET /burden/imbalances/summary?projectId=` — current balance per project/party with partner attribution (admin/developer)
- `GET /burden/imbalances/ledger?projectId=&partyRole=&entryType=` — all entries oldest-first, running balance computed in JS, returned newest-first (all roles, project-scoped)
- `GET /burden/imbalances/partner-summary` — partner-centric view: aggregates ledger balances through agreements → partner name (admin/developer)
- `POST /burden/imbalances/entries { projectId, developerAmount, landownerAmount, description, notes?, period? }` — manual adjustment pair (admin only)
- `POST /burden/imbalances/seed` — idempotent backfill from existing burden records; skips already-seeded records; returns `{ seeded, skipped, message }` (admin only)

**Shared helper:** `createImbalanceLedgerPair(...)` exported from `burden_imbalances.ts`, imported and called by `burden.ts`

**Frontend — Imbalances tab (inside `/burden`):**
- **Balance Overview sub-view** — 4 KPI cards (developer total balance, landowner total balance, projects tracked, negative-balance count); per-project table with developer/landowner balance, partner names, negative indicator
- **Partners sub-view** — per-partner accordion cards showing roles, net balance, per-project breakdown; red highlight on negative
- **Ledger sub-view** — chronological table with party badge, entry type badge, signed amount, running balance column (red AlertTriangle icon on negative rows); project + party filters
- **Admin actions** — "Seed from Records" button (idempotent), "Manual Entry" dialog (signed amounts with explanation)

**Generated hooks:** `useGetImbalanceSummary`, `useListImbalanceLedger`, `useGetImbalancePartnerSummary`, `useCreateImbalanceEntry`, `useSeedImbalanceLedger`

**Extension points for future settlement:**
- Add `approvedBy`, `settlementId` columns to `imbalance_ledger` for settlement workflow linking
- Add `carry_forward` entries at period close via a new scheduled/manual endpoint
- Settlement engine queries all entries with `runningBalance != 0` to produce settlement proposals

## Inventory & Stock Management System

Audit-friendly ledger system tracking Latex, Rubber Sheets, and Rubber Scrap across all projects. Every stock change is a permanent movement record — balance is derived, never stored directly.

**Core principle:** Ledger-based. Balance = SUM(confirmed in movements) − SUM(confirmed out movements). No row is ever deleted — only soft-deactivated (admin only).

**Movement types:**

| Type | Direction | Auto-confirmed? |
|---|---|---|
| `opening` | in | Yes |
| `production_in` | in | Yes |
| `purchase_in` | in | Yes |
| `sale_out` | out | Yes |
| `transfer_out` | out | Yes |
| `wastage` | out | Yes |
| `adjustment_in` | in | Admin/developer: yes; staff: pending |
| `adjustment_out` | out | Admin/developer: yes; staff: pending |

**Adjustment workflow:** Non-admin/developer users submit adjustments as `pending`. Admin/developer must confirm (updates balance) or cancel (no effect). This provides a full approval audit trail.

**DB table:** `inventory_stock_movements` — UUID PK, projectId FK (cascade), stockType (latex/rubber_sheet/rubber_scrap), movementType, direction (in/out, denormalized), quantity numeric(12,3), unit (litres/kg), movementDate date, batchId FK → production_batches (set null), referenceId text, referenceType text, notes, status (confirmed/pending/cancelled), confirmedAt/confirmedById/confirmedByName, cancelledAt/cancelledById/cancelledByName, createdById/createdByName, isActive, createdAt/updatedAt

**Indexes:** projectId, stockType, movementDate DESC, status, batchId

**API endpoints at `/api/inventory-stock/`:**
- `GET /balance?projectId=&stockType=` — confirmed balance per (project, type), includes pendingCount/pendingQty
- `GET /summary?projectId=` — dashboard: totalMovements + per-status counts + stockSummary (balance, productionIn, saleOut, wastage per type)
- `GET /movements?projectId=&stockType=&movementType=&status=` — ledger list (newest first)
- `POST /movements` — create movement (admin/developer/employee/operational_staff)
- `POST /movements/:id/confirm` — confirm pending (admin/developer)
- `POST /movements/:id/cancel` — cancel (admin/developer)
- `DELETE /movements/:id` — soft-delete (admin only, sets isActive=false)

**Access control:** Admin/developer see all projects; others see only assigned projects. Any authenticated user can view; only allowed roles can write.

**Frontend page:** `artifacts/plantation-web/src/pages/Inventory.tsx` at `/inventory`
- **Balance strip** (3 columns): per-type balance with low-stock / no-stock warning colours
- **Dashboard tab**: per-type stock cards (balance + totalIn/Out + productionIn/saleOut/wastage breakdown), movement stat pills (total/confirmed/pending/cancelled), bar chart (Prod In / Sale Out / Wastage / Balance by type)
- **Movements tab**: filterable table (by type, movement type, status) with confirm/cancel/delete inline actions for admins/developers
- **Pending tab**: badge count, amber warning banner, confirm/cancel table for pending adjustments
- **Add movement dialog**: stock type button-picker, movement type selector, quantity + unit, date, optional batch link (for production_in), reference number + type, notes; context-aware per tab (in/out/adjustment); adjustment warning text varies by role
- **Confirm/Cancel/Delete alerts**: clear description of consequence before action

**Generated hooks:** `useGetInventoryStockBalance`, `useGetInventoryStockSummary`, `useListStockMovements`, `useCreateStockMovement`, `useConfirmStockMovement`, `useCancelStockMovement`, `useDeleteStockMovement`

**Sidebar:** `/inventory` entry already existed in Operations group — placeholder replaced with full implementation.

## Sales & Buyer Management System

Full rubber sales recording system with buyer registry, multi-product line items, deductions, inventory integration, and project-wise reporting. Sales must be confirmed by admin/developer before they are finalized; confirming auto-creates `sale_out` inventory movements.

**DB tables** (`lib/db/src/schema/`):
- `buyers.ts` — `buyersTable`: UUID PK, name, buyerType, contactPerson, phone, email, address, gstin, notes, isActive, audit cols
- `sales.ts` — `salesTransactionsTable`, `salesLineItemsTable`, `salesDeductionsTable`
  - Transaction: saleNumber (auto-generated `SALE-YYYYMMDD-NNNNN`), projectId FK, buyerId FK (optional), buyerName (denormalized), saleDate, status (draft/confirmed/cancelled), totalGrossRevenue, totalDeductions, totalNetRevenue, distributionId (placeholder for future distribution engine)
  - LineItem: transactionId FK, productType (latex/rubber_sheet/rubber_scrap), quantity, unit, saleRate, grossAmount (computed), optional batchId FK
  - Deduction: transactionId FK, deductionType (transport/commission/tax/processing/weighment/other), description, amount

**API routes**:
- `GET/POST /buyers`, `GET/PATCH /buyers/:id` — buyer CRUD (admin/developer for write)
- `GET /sales?projectId&status&buyerId` — list sales (project-visibility filtered)
- `POST /sales` — create sale with inline line items + deductions (admin/developer)
- `GET /sales/summary?projectId` — project-wise revenue aggregation
- `GET/PATCH /sales/:id` — get detail (with lineItems + deductions), update draft
- `POST /sales/:id/confirm` — confirm sale + auto-create `sale_out` inventory movements (admin/developer)
- `POST /sales/:id/cancel` — cancel sale (admin only)
- `POST/PATCH/DELETE /sales/:id/line-items/:itemId` — line item CRUD on drafts
- `POST/DELETE /sales/:id/deductions/:dedId` — deduction CRUD on drafts

**Frontend page:** `artifacts/plantation-web/src/pages/Sales.tsx` at `/sales`
- **KPI strip**: Net Revenue | Gross Revenue | Confirmed count (+ draft count) | Registered Buyers
- **Transactions tab**: filter by project/status/buyer; expandable rows show inline `SaleDetailPanel` with confirm/cancel buttons, live line-item/deduction add-remove (draft only), revenue summary grid
- **Reports tab**: grouped bar chart (Gross/Deductions/Net per project) + project-wise table with totals footer
- **Buyers tab**: card grid of registered buyers with contact info; Add/Edit dialog (name, type, contact, phone, email, address, GSTIN)
- **New Sale dialog**: project + date + buyer (registry lookup or manual name) + document ref; multi-row line items with product type, batch link (closed batches), quantity, rate; multiple deductions; live net preview
- Buyer dialog resets correctly when switching between add/edit

**Sidebar:** `/sales` already in Operations group; route in App.tsx maps to the new `Sales` component.

**Generated hooks:** `useListBuyers`, `useGetBuyer`, `useCreateBuyer`, `useUpdateBuyer`, `useDeleteBuyer`, `useListSales`, `useGetSale`, `useGetSalesSummary`, `useCreateSale`, `useUpdateSale`, `useConfirmSale`, `useCancelSale`, `useAddSaleLineItem`, `useUpdateSaleLineItem`, `useDeleteSaleLineItem`, `useAddSaleDeduction`, `useDeleteSaleDeduction`

**Distribution engine hook:** `distributionId` UUID column on `salesTransactionsTable` is a FK placeholder — no constraint yet; set when linking to a future distribution record.

## Inventory Analytics System

Comprehensive analytics dashboard for stock valuation, production/sales trends, wastage analysis, and batch summaries. Accessible to admin and developer roles only.

**API endpoint:** `GET /inventory-stock/analytics?projectId=`
- Monthly time-series (last 13 months): production_in, sale_out, wastage per stock type, grouped by calendar month using `date_trunc`
- Per-type stock valuation: current confirmed balance + last sale rate from `sales_line_items` (confirmed only) → estimated portfolio value
- Batch summary: total/open/closed/voided counts + 10 most recent batches with per-batch production totals
- Sales revenue trends: monthly gross + net revenue aggregated from confirmed `sales_transactions`
- Low stock alerts: flags per stock type with threshold checks (latex < 500L, sheet < 200kg, scrap < 100kg); levels: ok/low/critical/empty

**Frontend page:** `artifacts/plantation-web/src/pages/InventoryAnalytics.tsx` at `/inventory-analytics`
- **Header**: sticky project filter dropdown (all projects or specific project)
- **Low-stock alert banner**: amber banner with per-type progress bars + alert level badges (conditional, only when alerts exist)
- **KPI strip** (4 cards): Est. Portfolio Value (INR, formatted lakh/K), Total Batches (+ open count), Confirmed Sales count, Net Sales Revenue
- **Stock Valuation Cards** (3, one per type): balance with color-coded alert level, estimated INR value, last sale rate + date, totalIn/Out/Wastage breakdown, wastage rate %, utilization %
- **Production vs Sales chart**: ComposedChart — stacked bars for production (latex/sheet/scrap), line overlays for sales outflows
- **Sales Revenue Trend**: dual-area chart (gross + net revenue), Y-axis formatted as ₹K/₹L
- **Wastage Analytics**: bar chart by month (3 types) + PieChart breakdown by type (conditional on data)
- **Per-type Stock Flow**: 3 small AreaCharts (one per type) showing Prod In / Sale Out / Wastage over time
- **Batch Summary**: 4 KPI pills + recent-batches table (batchNumber, date, project, status badge, latex/sheet/scrap totals, entry count)
- **Empty state**: shown when no movements or all-zero balances

**Sidebar:** "Inv. Analytics" added to Operations group (admin/developer only), icon: BarChart3, href: `/inventory-analytics`

**Generated types:** `InventoryAnalytics`, `StockValuationItem`, `MonthlyStockTrend`, `MonthlySalesTrend`, `RecentBatch`, `InventoryBatchSummary`, `LowStockAlert`

**Generated hook:** `useGetInventoryAnalytics`, `getGetInventoryAnalyticsQueryKey`

## Sales Document & Audit Tracking System

Full audit trail for all sale mutations, document attachment storage, and governance alerts for suspicious edits. Admin and developer roles only.

**Risk detection (automatic, fire-and-forget):**
- `normal` — no significant change
- `watch` — quantity change ≥20% or rate change ≥15%
- `flag` — quantity change ≥40%, rate change ≥30%, or any edit on an already-confirmed sale

**DB tables:**
- `sale_audit_events` (`lib/db/src/schema/sale_audit.ts`) — UUID PK, transactionId FK, projectId FK, saleNumber, eventType, entityType, entityId, description, fieldChanges (JSONB), riskLevel (normal/watch/flag), riskReason, actorId (set null), actorName, actorRole, createdAt
- `sale_documents` (`lib/db/src/schema/sale_documents.ts`) — UUID PK, transactionId FK (restrict), projectId FK, saleNumber, documentType (invoice/buyer_document/sales_proof/operational_record/other), title, description, fileObjectPath, mimeType, fileSizeBytes, originalFileName, status (active/archived), uploadedById (set null), uploadedByName, archivedAt, archivedById (set null), archivedByName, notes, audit cols

**Server lib:** `artifacts/api-server/src/lib/saleAuditHelper.ts` — `writeSaleAudit(req, event)` fire-and-forget helper; `detectRisk(fieldChanges, saleStatus)` for automatic risk classification. Called from all mutations in `sales.ts` (created, updated, confirmed, cancelled, line_item_added/updated/removed, deduction_added/removed).

**API endpoints** (`artifacts/api-server/src/routes/sales_audit.ts`, mounted as `router.use("/sales", salesAuditRouter)` before `salesRouter`):
- `GET /sales/governance/alerts` — top 50 watch+flag events, admin/developer
- `GET /sales/:id/audit-log` — all audit events for a sale, newest first
- `GET /sales/:id/documents` — list active documents, any authenticated user with project access
- `POST /sales/:id/documents` — attach document post-presigned-upload, admin/developer
- `GET /sales/:id/documents/:docId/download` — stream file from GCS
- `PATCH /sales/:id/documents/:docId` — update title/description/notes, admin/developer
- `DELETE /sales/:id/documents/:docId` — soft-archive, admin only

**Frontend:**
- `SalesAudit.tsx` (route `/sales/audit`) — governance alerts panel (flag/watch buckets with riskReason) + per-sale audit timeline selector with expandable field-change diff (old/new values + % change)
- `SaleDocumentsPanel` (inline in `SaleDetailPanel`, `Sales.tsx`) — collapsible panel, lists active docs with title/type/filename/uploader, download button, admin-only archive; presigned-URL upload form with drag-and-drop file picker
- "View Audit Trail" link at the bottom of every expanded sale detail → `/sales/audit`
- Sidebar: "Sale Audit" added to Operations group (admin/developer only), icon: ShieldCheck, href: `/sales/audit`

**Generated hooks:** `useGetSaleGovernanceAlerts`, `useListSaleAuditLog`, `useListSaleDocuments`, `useCreateSaleDocument`, `useGetSaleDocument`, `useUpdateSaleDocument`, `useArchiveSaleDocument`

**Note:** `History` from lucide-react conflicts with the browser's native `History` API in this React version. Use `ScrollText` or `Clock` instead.

## Operational Task Workflow System

Task assignment and tracking for employee and operational_staff roles. Admin/developer create and assign tasks; workers see only their own tasks and can start/complete them.

**Access rules:**
- `admin` / `developer` — full CRUD on all tasks; see all tasks across all users
- `employee` / `operational_staff` — read + start/complete on own assigned tasks only
- `landowner` / `investor` — no access (403)

**Task types:** `production_entry`, `stock_update`, `inspection`, `general`
**Status flow:** `pending` → `in_progress` → `completed` (or `cancelled` by admin)
**Priority levels:** `urgent`, `high`, `normal`, `low` (colour-coded dots)

**DB:** `operational_tasks` (`lib/db/src/schema/operational_tasks.ts`) — UUID PK, title, description, taskType, status, priority, projectId FK (set null), projectName (denorm), assignedToId FK (set null), assignedToName, assignedToRole, assignedById FK (set null), assignedByName, dueDate, notes, completedAt, completedById FK (set null), completedByName, linkedEntityType, linkedEntityId, isActive, audit cols
**Enums added to `enums.ts`:** `taskTypeEnum`, `taskStatusEnum`, `taskPriorityEnum`

**API endpoints** (`artifacts/api-server/src/routes/tasks.ts`, mounted at `/tasks`):
- `GET /tasks` — list tasks (role-filtered; supports `?status=`, `?projectId=`, `?assignedToId=`, `?taskType=`)
- `GET /tasks/summary` — `{ pending, inProgress, completed, cancelled, urgent, overdue, total }`
- `POST /tasks` — create (admin/developer)
- `GET /tasks/:id` — get single task (workers: own only)
- `PATCH /tasks/:id` — update (admin/developer: all fields; workers: status+notes only)
- `DELETE /tasks/:id` — soft-delete / archive (admin only)

**Frontend:**
- `OperationalTasks.tsx` (route `/tasks`) — mobile-friendly task list with:
  - 4 KPI cards: Pending / In Progress / Urgent / Overdue
  - Filter bar: status dropdown, task type dropdown, search
  - Expandable task cards with priority dot, status badge, quick Start/Complete buttons, due date with overdue highlighting
  - Admin/developer: inline Edit (Pencil) and Delete buttons; full Create/Edit dialog with assignee picker, project picker, due date, description, notes
  - Workers: status-only actions; no management controls visible
- `PendingTasksPanel` — shared dashboard component: shows up to 6 active tasks (in-progress first), priority dot + overdue indicator, links to `/tasks`. Rendered on both EmployeeDashboard and StaffDashboard. Hidden when there are no active tasks.
- Quick Actions panel on Employee and Staff dashboards has "My Tasks" shortcut
- Sidebar: "Tasks" added to Operations group (admin/developer/employee/operational_staff), icon: ListChecks, href: `/tasks`

**Generated hooks:** `useListTasks`, `useGetTaskSummary`, `useCreateTask`, `useGetTask`, `useUpdateTask`, `useDeleteTask`

**Sidebar access summary (employee + operational_staff):**
- Visible: Dashboard, Projects, My Portfolio, My Profile, Production Log, Production (emp only), Inventory, Stock, Tasks, Distribution (staff only), Notifications
- Hidden: all Finance modules, all Analytics modules, Governance, Sale Audit, Admin, Inv. Analytics, Sales

## Operational Governance Alert Monitoring System

ERP-style real-time anomaly detection engine for operational governance and compliance. Runs six independent detectors against live DB data, deduplicates against existing open alerts, and persists new findings. Admin and developer roles only.

**Six alert types detected:**

| Alert Type | Severity | Detection Logic |
|---|---|---|
| `negative_stock` | critical | `SUM(in) − SUM(out) < 0` per project/stockType on confirmed movements |
| `missing_batch_linkage` | warning | `production_in` movements with `batchId IS NULL`; confirmed sale line items with no batch link |
| `inventory_inconsistency` | warning | Closed production batch totals vs. actual `production_in` movement quantities diverge by >1L / >0.5kg |
| `suspicious_adjustment` | warning | `adjustment_in/out` movement >100 kg / >1000 L, or pending adjustment >7 days old |
| `unusual_sales_change` | warning | Sale audit events where `risk_level = 'flag'` |
| `missing_operational_record` | info | Production batch in `open` status for >7 days |

**Alert lifecycle:** `open` → `acknowledged` → `resolved` / `dismissed` (admin can reopen)

**DB table:** `operational_alerts` (`lib/db/src/schema/operational_alerts.ts`) — UUID PK, alertCode (idempotency key), alertType, severity, status, title, description, projectId FK (set null), projectName, entityType, entityId, entityRef, detectedAt, acknowledged/resolved/dismissed audit cols, resolutionNotes, metadata JSONB, isActive
**Enums added to `enums.ts`:** `operationalAlertTypeEnum`, `alertSeverityEnum`, `alertStatusEnum`

**Detection engine idempotency:** Before inserting, fetches all existing `open` alertCodes and skips any that already exist — re-runs are safe to call repeatedly.

**API endpoints** (`artifacts/api-server/src/routes/operational_alerts.ts`, mounted at `/operational-alerts`):
- `GET /operational-alerts/summary` — counts by status, severity, and type (admin/developer)
- `POST /operational-alerts/generate` — runs all 6 detectors, returns `{ generated, skipped, totalDetected }` (admin/developer)
- `GET /operational-alerts` — list with filters: `?status=`, `?severity=`, `?alertType=`, `?projectId=` (admin/developer)
- `GET /operational-alerts/:id` — single alert detail (admin/developer)
- `PATCH /operational-alerts/:id` — `{ action: "acknowledge"|"resolve"|"dismiss"|"reopen", resolutionNotes? }` (reopen: admin only)

**Frontend:** `OperationalAlerts.tsx` (route `/operational-alerts`) — ERP-style monitoring dashboard:
- 4 KPI cards: Critical Active / Warnings Active / Open Alerts / Resolved
- Type breakdown strip: per-alert-type open count pills
- Filter bar: search, status, severity, alert type dropdowns
- Post-generate feedback banner: "N new alerts generated, N duplicates skipped"
- Alert rows: severity-colour-coded, expandable for detail + raw metadata JSON viewer
- Quick actions per row: Acknowledge / Resolve / Dismiss (with dialog + resolution notes) / Reopen (admin)
- Empty state with "Run Detection" call-to-action
- Inventory integrity success banner when no negative stock / inconsistency alerts are open

**Sidebar:** "Op. Alerts" added to Operations group (admin/developer only), icon: ScanSearch, href: `/operational-alerts`

**Generated hooks:** `useGetOperationalAlertSummary`, `useGenerateOperationalAlerts`, `useListOperationalAlerts`, `useGetOperationalAlert`, `useUpdateOperationalAlert`

**Access:** admin and developer only. landowner, investor, employee, operational_staff see a "not available" screen.

## Operational Security & Access Control System

Role-based security enforcement across production, inventory, and sales modules. Implements field-level data protection, project-scoped visibility, and a full operational access audit trail.

### Visibility rules enforced at API level

| Module | admin/developer | employee | operational_staff | landowner/investor |
|---|---|---|---|---|
| Production batches (list/view) | All projects | Assigned projects | Assigned projects | Assigned projects (read-only) |
| Inventory balance/movements | All projects | Assigned projects | Assigned projects | Assigned projects (read-only) |
| Sales transactions (list/view) | All projects, all fields | Assigned projects, no revenue totals | Assigned projects, no pricing | Assigned projects, no pricing |
| Sales analytics (summary) | Full revenue figures | Count only | Count only | Count only |
| Inventory analytics | Full (rates + estimated value + sales trends) | Quantities only | Quantities only | Quantities only |

### Revenue/pricing field protection

**`formatTransaction` (sales.ts):** `totalGrossRevenue`, `totalDeductions`, `totalNetRevenue` → stripped for all roles except admin/developer  
**`formatLineItem` (sales.ts):** `saleRate`, `grossAmount` → stripped for operational_staff, landowner, investor (employees retain access as they enter these values)  
**Inventory analytics:** `lastSaleRate`, `estimatedValue`, `salesTrends` → stripped for non-manager roles. Safe valuation returned with undefined pricing fields.  
**Sales summary:** revenue total aggregates stripped for all non-manager roles (count/confirmed count only visible)

### Operational access audit trail

Every access to production, inventory, and sales records is written to `operational_access_logs` via the `logOperationalAccess()` fire-and-forget utility in `artifacts/api-server/src/lib/accessLog.ts`.

**Logged events:**
- `GET /production-log/batches` → `production_batch / list`
- `GET /production-log/batches/:id` → `production_batch / view`
- `GET /sales` → `sale_transaction / list`
- `GET /sales/:id` → `sale_detail / view`
- `GET /sales/summary` → `sale_summary / summary`
- `GET /inventory-stock/analytics` → `inventory_analytics / analytics`
- `accessDenied: true` entries written on 403 responses

**DB table:** `operational_access_logs` — UUID PK, userId FK (set null), userRole, projectId FK (set null), resourceType, resourceId, resourceRef, action, accessDenied, clientIp, userAgent, accessedAt. Append-only; never updated or deleted.

**API endpoints** (`artifacts/api-server/src/routes/operational_access_logs.ts`, mounted at `/operational-access-logs`):
- `GET /operational-access-logs?userId&projectId&resourceType&action&accessDenied&from&to&limit&offset` — paginated log list (admin/developer)
- `GET /operational-access-logs/summary?from&to` — aggregate counts by role and resource type (admin/developer)

**Frontend:** `OperationalAccessLog.tsx` (route `/operational-access-log`) — audit viewer with:
- 4 KPI cards: Total Events / Denied Access / Active Roles / Resource Types
- Role breakdown strip with clickable filter pills
- Filter bar: search, resource type, action, access status
- Paginated log table with expandable rows (full IDs, IP)
- Color-coded role/action/resource badges

**Sidebar:** "Op. Access Log" added to System group (admin/developer only), icon: ScanSearch

**Generated hooks:** `useListOperationalAccessLogs`, `useGetOperationalAccessLogSummary`

**Schema file:** `lib/db/src/schema/operational_access_logs.ts`  
**Utility:** `artifacts/api-server/src/lib/accessLog.ts` — `logOperationalAccess(params)`, `logDeniedAccess(...)`

## 50% Revenue Model Settlement Engine

Guided settlement workflow for projects on the 50% Revenue sharing model. Gross revenue is split exactly in half: the landowner side bears all operational costs and LCA; the Economic Participant Pool (EPP) is never reduced by costs and is distributed purely by verified economic participation percentages.

**Formula:**
```
Gross Revenue ÷ 2 → Landowner Side (50%) + Economic Participant Pool (50%)
Landowner Net = Landowner Side − Op Costs − LCA  (floored at 0)
EPP per participant = Pool × participationPct / 100
Land contribution EXCLUDED from EPP — only additional economic contributions qualify
```

**DB tables** (`lib/db/src/schema/fifty_pct.ts`):
- `fifty_pct_sessions` — UUID PK, projectId FK, periodLabel, periodStart/End/Year, grossRevenue, revenueSource (sales_records/manual), linkedSaleIds (jsonb), landownerSplit, participantPoolSplit, operationalCost, lcaAmount, lcaSource, landownerNet, eppTotalAllocated, eppRemainder, status (draft/confirmed/archived), calculatedBy/Name, confirmedAt/By/Name, notes
- `epp_entries` — UUID PK, sessionId FK (cascade), projectId FK, participantId (nullable partner FK), participantKey, participantName, participationPct, allocatedAmount, contributionType (economic_only/landowner_additional/external), isLandownerAdditional, notes

**API endpoints** (`artifacts/api-server/src/routes/fifty_pct.ts`), mounted at `/fifty-pct`:
- `GET /fifty-pct?projectId&status` — list sessions
- `POST /fifty-pct` — create draft session (admin/developer)
- `GET /fifty-pct/revenue-lookup?projectId&from&to` — fetch confirmed sales records for linking
- `GET /fifty-pct/lca-lookup?projectId` — fetch outstanding LCA balances
- `GET /fifty-pct/partners-lookup` — list active partners for EPP auto-fill
- `GET /fifty-pct/:id` — session + EPP entries
- `PATCH /fifty-pct/:id` — update draft session; recomputes all EPP allocations if grossRevenue changes (admin/developer)
- `POST /fifty-pct/:id/confirm` — lock session as confirmed (admin/developer)
- `DELETE /fifty-pct/:id` — archive session (admin only)
- `GET /fifty-pct/:id/epp` — list EPP entries + totals
- `POST /fifty-pct/:id/epp` — add EPP participant (admin/developer)
- `PATCH /fifty-pct/:id/epp/:entryId` — update EPP participant (admin/developer)
- `DELETE /fifty-pct/:id/epp/:entryId` — remove EPP participant (admin/developer)
- `GET /fifty-pct/:id/summary` — full waterfall summary with per-participant EPP breakdown and validation warnings

**Frontend:** `artifacts/plantation-web/src/pages/FiftyPctSettlement.tsx` at `/fifty-pct-settlement`
- **Sidebar:** "50% Revenue Settlement" in Settlement group (admin/developer), icon: PieChart
- **5-step wizard** for creating sessions: (1) Project + Period → (2) Gross Revenue (link sales or manual) → (3) Deductions (op cost + LCA from ledger or manual) → (4) Live 50/50 preview + Save → (5) Add EPP Participants
- **List view:** all sessions with project filter, status badge, quick confirm/archive actions
- **Detail view — 4 sub-tabs:**
  - **Revenue Split:** side-by-side 50/50 visual cards + full waterfall ledger
  - **Participant Pool:** EPP entry table with add/edit/remove, participation % validation, unallocated remainder warning
  - **Landowner View:** formal ledger showing gross → deductions → net with principle explanation
  - **Analytics:** horizontal bar charts (gross allocation + per-participant EPP), KPI cards

**Generated hooks:** `useListFiftyPctSessions`, `useCreateFiftyPctSession`, `useUpdateFiftyPctSession`, `useConfirmFiftyPctSession`, `useArchiveFiftyPctSession`, `useGetFiftyPctSession`, `useGetFiftyPctSessionSummary`, `useLookupFiftyPctRevenue`, `useLookupFiftyPctLca`, `useLookupFiftyPctPartners`, `useListEppEntries`, `useCreateEppEntry`, `useUpdateEppEntry`, `useDeleteEppEntry`

## Actual Payable Calculation System

Settlement recommendation engine that synthesises confirmed data across all financial modules into a single advisory "Actual Payable" figure. Final settlement remains manual; no legal or financial obligation is created by a recommendation.

**Formula:**
```
Profit Share (confirmed 50% sessions where partner is landowner)
+ Recoverable Advances Outstanding (advances partner made, not yet recovered)
+ Pending Recoveries (landowner ledger isRecoverable, not fully settled)
+ Pending LCA Balance (outstanding land contribution adjustments)
+ Prior Imbalance Adjustments (net confirmed credit/debit entries)
− Negative Carry Balances (carry-forward deductions)
══════════════════════════════════════════════════════
= Actual Payable Recommendation
```

**DB tables** (`lib/db/src/schema/payable.ts`):
- `payable_adjustments` — UUID PK, projectId/partnerId FK (restrict), adjustmentType (imbalance_adjustment/carry_balance/other_credit/other_debit), direction (credit/debit), amount, periodLabel, description, reference, status (draft/confirmed), confirmedAt/By/Name, notes, isActive, createdBy/Name, audit cols
- `payable_snapshots` — UUID PK, projectId/partnerId FK (restrict), periodLabel, computedAt, profitShareAmount, profitShareSource, recoverableAdvancesAmount, pendingRecoveriesAmount, pendingLcaAmount, priorAdjustmentsAmount, negativeCarryAmount, actualPayable, status (draft/finalized), generatedBy/Name, notes, breakdown (jsonb), isActive, audit cols

**API endpoints** (`artifacts/api-server/src/routes/payable.ts`), mounted at `/payable`:
- `GET /payable/compute?projectId&partnerId` — live computation pulling from five sources (fifty_pct_sessions, recoverable_advances, landowner_ledger_entries, lca_ledger_entries, payable_adjustments); returns full breakdown object per component
- `GET /payable/adjustments?projectId&partnerId&type&status` — list manual adjustments
- `POST /payable/adjustments` — create adjustment (admin/developer; draft by default)
- `PATCH /payable/adjustments/:id` — update draft adjustment (admin/developer)
- `POST /payable/adjustments/:id/confirm` — lock adjustment as confirmed (admin/developer)
- `DELETE /payable/adjustments/:id` — soft-delete (admin only; sets isActive=false)
- `GET /payable/snapshots?projectId&partnerId` — list saved recommendation snapshots
- `POST /payable/snapshots` — save snapshot (re-computes live at save time, stores immutable amounts + breakdown jsonb)
- `GET /payable/snapshots/:id` — single snapshot
- `POST /payable/snapshots/:id/finalize` — finalize snapshot (admin only; status → finalized)

**Frontend:** `artifacts/plantation-web/src/pages/PartnerPayable.tsx` at `/partner-payable`
- **Sidebar:** "Partner Payable" in Settlement group (admin/developer only), icon: Calculator
- **Project + Partner selectors** at top; advisory banner prominently displayed
- **6 KPI cards:** Profit Share | Rec. Advances | Pending Recoveries | Pending LCA | Adjustments | Carry Deduction
- **Formula card:** step-by-step visual formula with per-row amounts and subtitles
- **Horizontal bar chart:** component breakdown (Recharts, non-zero components only)
- **Tabs:**
  - **Breakdown:** expandable sections per component, each with source data tables (sessions, advance records, ledger entries, LCA ledger rows, adjustment entries)
  - **Adjustments:** CRUD for manual imbalance/carry entries; confirm/edit/delete per row; advisory note that only confirmed entries are included in calculation
  - **History:** list of saved snapshots with status (draft/finalized), component breakdown row, finalize action for admin
- **Save Recommendation dialog:** period label + notes, shows live payable preview; creates immutable snapshot

**Generated hooks:** `useComputePayable`, `useListPayableAdjustments`, `useCreatePayableAdjustment`, `useUpdatePayableAdjustment`, `useDeletePayableAdjustment`, `useConfirmPayableAdjustment`, `useListPayableSnapshots`, `useCreatePayableSnapshot`, `useGetPayableSnapshot`, `useFinalizePayableSnapshot`

## Loss Absorption & Negative Balance Adjustment Engine

Advisory-only engine tracking expected vs actual operational burden per (project, partner) pair, carry-forward imbalances, and negative balance positions. No automatic settlements triggered.

**DB tables** (`lib/db/src/schema/loss_absorption.ts`):
- `loss_absorption_records` — period-level burden tracking; derived fields: `burdenImbalance`, `lossAbsorbed`, `netAfterBurden`, `carryForwardAmount` (status: draft → confirmed; carryForwardStatus: none/pending/partial/resolved)
- `negative_balance_entries` — append-only running balance ledger per (project, partner); referenceType classifies source (loss_absorption / lca_shortfall / settlement_deficit / burden_imbalance / manual_adjustment / recovery_credit)

**API** (`artifacts/api-server/src/routes/loss_absorption.ts`, mounted at `/loss-absorption`):
- `GET/POST /records` — list (project/partner/status filter, RBAC-scoped) + create
- `PATCH/DELETE /records/:id` — edit draft / soft-delete (admin only)
- `POST /records/:id/confirm` — lock record (admin/developer)
- `GET/POST /negative-balance` — list entries + create (with auto opening-balance from last closing balance)
- `PATCH /negative-balance/:id` — update description/notes/recoveryStatus
- `GET /settlement-priority?projectId&partnerId` — advisory 3-tier waterfall: Tier 1 = recover past imbalances, Tier 2 = pay pending LCA, Tier 3 = distribute profit
- `GET /summary?projectId&partnerId` — full KPI + recovery + period analytics + recent rows

**Settlement priority waterfall note:** `const { id } = req.params as { id: string }` pattern required for Drizzle `eq()` type resolution (difference from `req.params.id` direct usage).

**Frontend** (`artifacts/plantation-web/src/pages/LossAbsorption.tsx`, route `/loss-absorption`):
- Amber advisory banner at top
- Project + Partner filter dropdowns (sentinel `"__all__"` value for Radix Select compatibility)
- 4 tabs: Overview (6 KPI cards, recovery position, period bar chart) | Loss Records (CRUD table with confirm/edit/delete) | Negative Balances (ledger table with edit) | Settlement Priority (advisory waterfall card)
- Sidebar: Settlement group, icon TrendingDown (admin/developer only)

**Generated hooks:** `useListLossAbsorptionRecords`, `useCreateLossAbsorptionRecord`, `useUpdateLossAbsorptionRecord`, `useConfirmLossAbsorptionRecord`, `useDeleteLossAbsorptionRecord`, `useListNegativeBalanceEntries`, `useCreateNegativeBalanceEntry`, `useUpdateNegativeBalanceEntry`, `useGetSettlementPriority`, `useGetLossAbsorptionSummary`

## Manual Settlement Override & Finalization System

Governance layer that sits above all settlement engines (50% revenue, payable, LCA, loss absorption). System generates recommendations; any partner may override; Project Developer has final authority. Every state change writes an immutable audit event.

**Status machine (forward-only except admin reopen):**
```
draft → recommended → overridden → finalized
              ↘ disputed (from any non-finalized state)
finalized → overridden  (admin reopen only, requires justified remarks)
```

**Authority model:**
- Any authenticated user: `POST /settlement/:id/override` (remarks mandatory, min 5 chars)
- Admin / Developer: create, set-recommendation, finalize, dispute, archive
- Admin only: reopen finalized records, archive

**DB tables** (`lib/db/src/schema/settlement_overrides.ts`):
- `settlement_records` — main record; `settlementType` discriminator links to source engine (fifty_pct / payable / lca / loss_absorption / manual); `sourceReferenceId` UUID back-pointer (unenforced, flexible); stores both `recommendedAmount` + `recommendedBreakdown` (write-once) and `actualAmount` + `actualBreakdown` (editable until finalized); override metadata: `isOverridden`, `overrideCount`, `lastOverriddenBy`, `lastOverriddenByRole`, `overrideRemarks`; finalization: `finalizedAt`, `finalizedBy`, `finalizedByRole`, `finalizationNotes`
- `settlement_override_events` — **IMMUTABLE** audit trail; `eventType` ∈ {created, updated, recommendation_set, overridden, finalized, disputed, reopened, archived}; full before/after snapshot: `previousAmount`, `newAmount`, `previousStatus`, `newStatus`; actor: `performedBy`, `performedByName`, `performedByRole`; `metadata` JSONB for breakdown snapshots

**API** (`artifacts/api-server/src/routes/settlement_overrides.ts`, mounted at `/settlement`):
- `GET /settlement` — list with project/partner/status/type filters (RBAC-scoped)
- `POST /settlement` — create record; if `recommendedAmount` provided, transitions to `recommended` immediately
- `GET /settlement/:id` — full record + all audit events
- `PATCH /settlement/:id` — update period metadata (draft/recommended only)
- `POST /settlement/:id/set-recommendation` — admin/developer sets/updates recommendation; creates `recommendation_set` event
- `POST /settlement/:id/override` — **any authenticated user**; requires `overrideRemarks` ≥ 5 chars; creates `overridden` event with full snapshot
- `POST /settlement/:id/finalize` — admin/developer locks record; creates `finalized` event
- `POST /settlement/:id/dispute` — marks disputed; creates `disputed` event (requires remarks)
- `POST /settlement/:id/reopen` — admin only; requires remarks; creates `reopened` event
- `GET /settlement/:id/audit` — full immutable event trail
- `GET /settlement/:id/comparison` — side-by-side recommended vs actual with delta, override timeline

**Frontend** (`artifacts/plantation-web/src/pages/FinalSettlement.tsx`, route `/final-settlement`):
- Authority banner explaining 3-tier permission model
- 5 KPI cards: Total / Pending / Overridden / Disputed / Finalized
- Filters: project, partner, status, type (all use `"__all__"` sentinel for Radix Select)
- Split layout: records table (left) + detail panel (right, opens on row click or Eye button)
- Detail panel tabs: **Comparison** (side-by-side recommended vs actual, delta card, override timeline) | **Audit Trail** (vertical chronological timeline, expandable metadata)
- Dialogs: Create / Override (mandatory remarks) / Finalize (shows recommended vs actual preview) / Dispute / Reopen (admin-only, justified remarks)
- Sidebar: Settlement group, icon GitCompare (admin/developer only)

**Generated hooks:** `useListSettlementRecords`, `useCreateSettlementRecord`, `useGetSettlementRecord`, `useUpdateSettlementRecord`, `useSetSettlementRecommendation`, `useOverrideSettlement`, `useFinalizeSettlement`, `useDisputeSettlement`, `useReopenSettlement`, `useArchiveSettlementRecord`, `useGetSettlementAudit`, `useGetSettlementComparison`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Distribution Record & Payment History System

Permanent ledger of per-(project, partner, period) distribution events. Records are forward-only and immutable once any payment is recorded (`isPermanentRecord = true`).

**Status machine:** `draft → pending → partial → paid` · `pending/partial → carried_forward` (period close) · `any non-perm → archived` (admin only, draft only)

**DB tables** (`lib/db/src/schema/distribution_records.ts`):
- `distribution_records` — primary record: linked project, partner, accounting period label, period start/end, `linkedSaleIds` (JSONB array), `linkedSettlementId` (back-pointer), `settlementType` discriminator, `grossRevenue`, `settlementRecommendation`, `totalPaid`, `pendingPayable`, `priorCarryForward`, `carryForwardBalance`, `carriedFromRecordId`/`carriedToRecordId` (chain links), `lastPaymentDate`, `lastPaymentRef`, `paymentProofUrl`/`paymentProofNotes` (placeholder), `status`, `isPermanentRecord` (locked once payment recorded), `isActive`
- `distribution_payment_events` — **APPEND-ONLY** event log; eventType ∈ {created, payment_recorded, partial_payment, status_changed, carried_forward, carry_forward_received, proof_attached, archived}; snapshots: `paymentAmount`, `cumulativePaid`, `remainingBalance`, `previousStatus`, `newStatus`; actor: `performedBy`, `performedByName`, `performedByRole`

**API** (`artifacts/api-server/src/routes/distribution_records.ts`, mounted at `/distribution-records`):
- `GET /distribution-records` — list (projectId/partnerId/status/settlementType/periodLabel/includeArchived filters)
- `POST /distribution-records` — create (admin/developer); immediately marks `isPermanentRecord = false`, status `pending`
- `GET /distribution-records/summary` — KPI aggregates: totalGrossRevenue, totalRecommended, totalPaid, totalPending, totalCarryForward, paymentRate, byStatus map
- `GET /distribution-records/pending-payable` — all records with `pendingPayable > 0` + `totalPendingAmount`
- `GET /distribution-records/archive` — complete historical archive, all statuses including inactive
- `GET /distribution-records/partner-history/:partnerId` — full partner payment history across all projects with summary totals
- `GET /distribution-records/:id` — single record + all events
- `PATCH /distribution-records/:id` — update metadata (blocked on archived); recomputes derived pendingPayable + carryForwardBalance
- `POST /distribution-records/:id/record-payment` — records actual payment; atomically updates totalPaid, pendingPayable, status (→ partial or paid); marks `isPermanentRecord = true`; appends payment event
- `POST /distribution-records/:id/carry-forward` — closes period with unpaid balance; status → `carried_forward`; appends event
- `POST /distribution-records/:id/archive` — admin only; 409 if `isPermanentRecord = true` (permanent records cannot be archived ever)
- `GET /distribution-records/:id/events` — immutable event trail for a single record

**Frontend** (`artifacts/plantation-web/src/pages/DistributionRecords.tsx`, route `/distribution-records`):
- Four tabs: **Dashboard** (4 KPI cards + status breakdown pills + Paid/Pending/Carry-Fwd bar chart by period + preservation policy notice) | **Payment History** (records list, click to open split detail panel) | **Pending Payable** (outstanding balance report + total banner) | **Settlement Archive** (all-time historical list with permanent lock indicator)
- Detail panel: financial grid (gross revenue/recommended/carry-fwd/paid), progress bar with % completion, carry-forward alert block, last payment metadata, proof URL link, actions (Record Payment, Carry Forward), append-only event timeline
- Dialogs: Create Record (project/partner/period/financials/settlement type) | Record Payment (amount/date/ref/proof URL/remarks — warns balance + permanent lock) | Carry Forward (balance preview + remarks)
- Preservation policy: `isPermanentRecord` set to `true` on first payment; `POST /:id/archive` returns 409 for permanent records; UI shows lock icon and tooltip
- Sidebar: Settlement group, icon Database (admin/developer only)

**Generated hooks:** `useListDistributionRecords`, `useCreateDistributionRecord`, `useGetDistributionRecord`, `useUpdateDistributionRecord`, `useRecordDistributionPayment`, `useCarryForwardDistributionRecord`, `useArchiveDistributionRecord`, `useListDistributionPaymentEvents`, `useGetDistributionSummary`, `useGetDistributionPendingPayable`, `useGetDistributionArchive`, `useGetPartnerDistributionHistory`

## Settlement Governance & Distribution Monitoring System

Real-time financial monitoring dashboard for distribution and settlement health. Six alert categories with severity scoring, a task center, and discrepancy analysis.

**Six alert categories:**
| Category | Trigger | Severity |
|---|---|---|
| `PENDING_SETTLEMENT` | distribution_records with status pending/partial and pendingPayable > 0 | CRITICAL (≥₹5L), HIGH (≥₹1L), MEDIUM |
| `LARGE_OVERRIDE` | settlement_records where override diff > 20% of recommended | CRITICAL (≥50%), HIGH (≥30%), MEDIUM |
| `UNPAID_LCA` | lca_ledger with status pending/partial and balance > 0 | CRITICAL/HIGH/MEDIUM by balance amount |
| `NEGATIVE_BALANCE` | Latest closingBalance < 0 per (project, partner) from negative_balance_entries | CRITICAL/HIGH by deficit size |
| `MISSING_FINALIZATION` | settlement_records in recommended/overridden state for > 14 days | CRITICAL (≥60 days), HIGH (≥30 days), MEDIUM |
| `UNRESOLVED_DISPUTE` | settlement_records with status = disputed | Always HIGH |

**Health score:** `100 − CRITICAL×25 − HIGH×10 − MEDIUM×5 − LOW×1` (clamped 0–100)

**API endpoints** (`artifacts/api-server/src/routes/settlement_governance.ts`, mounted at `/settlement-governance`):
- `GET /settlement-governance/summary` — aggregate health score + alert counts by severity + category + total financial exposure
- `GET /settlement-governance/alerts` — all alerts sorted CRITICAL→LOW, filterable by category/severity/projectId
- `GET /settlement-governance/tasks` — three queues: pendingPayments (distribution records), pendingFinalizations (settlement records in recommended/overridden), openDisputes
- `GET /settlement-governance/discrepancies` — all overridden settlement_records with diff%, diffFlag (CRITICAL/HIGH/MEDIUM/OK), total discrepancy amount, flag counts

**Frontend** (`artifacts/plantation-web/src/pages/SettlementGovernance.tsx`, route `/settlement-governance`):
- **Overview tab**: health gauge (0–100 with colour), 4 severity KPI cards (click to filter alerts tab), 6-category grid (click to filter), task summary quick-links, all-clear state
- **Alerts tab**: filterable by category + severity; colour-coded alert cards with severity badge, category icon, exposure amount, project/partner labels, action link
- **Task Center tab**: three queues — Pending Payments (amber), Awaiting Finalization (orange), Open Disputes (red) — each with amount, date, clickable row to relevant page
- **Discrepancies tab**: override diff table with Recommended/Actual/Δ columns, diff%, diffFlag badge, override count, total discrepancy banner
- Sidebar: Settlement group, `ShieldAlert` icon, admin/developer only

**Generated hooks:** `useGetSettlementGovernanceSummary`, `useListSettlementGovernanceAlerts`, `useGetSettlementTasks`, `useGetSettlementDiscrepancies`

**OpenAPI schemas:** `SettlementAlert`, `SettlementGovernanceSummary`, `SettlementTaskCenter`, `DiscrepancyReport`

## Settlement Security Layer

Role-based access control and financial audit logging enforced on all settlement, distribution, and analytics endpoints. Implemented as a shared middleware module with three utilities.

**Access Matrix:**
| Role | Settlement Read | Distribution Read | 50% Settlement | Financial Analytics |
|---|---|---|---|---|
| `admin` | Full (all projects) | Full (all projects) | Full (all projects) | Full (all projects) |
| `developer` | Full (all projects) | Full (all projects) | Full (all projects) | Full (all projects) |
| `landowner` | Own projects only | Own projects only (Distribution Records sidebar visible) | Own projects only | Own projects only |
| `investor` | Own projects only | Own projects only | Own projects only (EPP data) | Own projects only |
| `employee` | **BLOCKED (403)** | **BLOCKED (403)** | **BLOCKED (403)** | **BLOCKED (403)** |
| `operational_staff` | **BLOCKED (403)** | **BLOCKED (403)** | **BLOCKED (403)** | **BLOCKED (403)** |

**Middleware file:** `artifacts/api-server/src/middlewares/settlement_security.ts`
- `requireSettlementAccess` — Express middleware; rejects employee + operational_staff with 403
- `getProjectScopeFilter(req)` — returns `null` (admin/developer: see all) or `string[]` (restricted roles: their project UUIDs). If empty array → caller returns empty result immediately
- `logSettlementAccess(req, resource, action, resourceId?, projectId?)` — fire-and-forget write to `financial_access_logs` table. Never throws. Captures userId, userRole, IP, userAgent
- `enforceProjectAccess(req, res, projectId, resource)` — single-record project check; sends 403 and returns false if access denied

**Applied to all GET endpoints in:**
- `settlement_overrides.ts` — GET /, GET /:id, GET /:id/audit, GET /:id/comparison
- `distribution_records.ts` — GET /, GET /summary, GET /pending-payable, GET /archive (admin/developer only), GET /partner-history/:partnerId, GET /:id, GET /:id/events
- `fifty_pct.ts` — GET /, GET /:id, GET /:id/epp, GET /:id/summary
- `financial_analytics.ts` — all 5 analytics endpoints with `scopeFilter()` helper injected into every sub-query

**Project scope filtering pattern:**
```
const projectScope = getProjectScopeFilter(req); // null or string[]
if (projectScope !== null && projectScope.length === 0) return res.json(empty);
// In filter arrays:
if (projectScope !== null) filters.push(inArray(table.projectId, projectScope));
// For analytics with inline ternary conditions:
const scopeFilter = (col) => projectId ? eq(col, projectId) : projectScope !== null ? inArray(col, projectScope) : undefined;
```

**Audit logging:** Every settlement data access (list, view, create, update, finalize, override) writes a row to `financial_access_logs` via `logSettlementAccess`. Readable at `GET /financial-access-logs` (admin: full history; developer: last 7 days).

**Frontend sidebar:** "Distribution Records" expanded to include `landowner` role. All other Settlement group items remain admin/developer only.

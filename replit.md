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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

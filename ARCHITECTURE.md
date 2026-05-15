# Hevea Partners ERP — Architecture Reference

This document describes the system architecture, layer boundaries, storage design, environment configuration, and migration guidance for the Hevea Partners rubber plantation ERP.

---

## Monorepo Structure

```
/
├── artifacts/                     # Deployable applications
│   ├── api-server/                # Express 5 REST API (Node.js)
│   └── plantation-web/            # React + Vite frontend
├── lib/                           # Shared workspace libraries
│   ├── api-spec/                  # OpenAPI contract (source of truth)
│   ├── api-client-react/          # Generated React Query hooks (do not edit)
│   ├── api-zod/                   # Generated Zod schemas (do not edit)
│   ├── db/                        # Drizzle ORM schema + DB client
│   └── object-storage-web/        # Frontend object storage helpers
├── scripts/                       # Utility scripts
├── pnpm-workspace.yaml            # Workspace package discovery + catalog pins
├── tsconfig.base.json             # Shared strict TypeScript defaults
├── tsconfig.json                  # Solution file for composite libs only
├── ARCHITECTURE.md                # This file
└── .env.example                   # All environment variables documented
```

---

## Layer 1 — Frontend (UI)

**Location:** `artifacts/plantation-web/`

**Stack:** React 18 · Vite · TypeScript · Tailwind CSS · shadcn/ui · wouter · @tanstack/react-query

**Key directories:**
```
src/
├── App.tsx                        # Root router (all 80+ routes wired here)
├── pages/                         # One file per ERP module/page
├── components/
│   ├── layout/                    # Layout, Sidebar, Navbar
│   ├── ui/                        # shadcn/ui primitives
│   ├── auth/                      # CanAccess RBAC guard
│   ├── governance/                # GovernanceAlertPanel, GovernanceStatusBadge
│   ├── lifecycle/                 # LifecycleBadge, LifecycleTimeline
│   └── ownership/                 # OwnershipFreezePanel
└── contexts/
    ├── RoleContext.tsx             # Role + project assignments (calls /api/me)
    ├── ProjectFilterContext.tsx    # Global project filter (UUID string | null)
    └── SidebarContext.tsx         # Sidebar collapsed state
```

**Build output:** `artifacts/plantation-web/dist/public/` (static assets, served by proxy in production)

**Environment variables required:**
- `PORT` — dev server port (injected by workflow)
- `BASE_PATH` — URL base prefix (injected by workflow, default `/`)
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk public key for frontend auth
- `VITE_CLERK_PROXY_URL` — (production only) Clerk proxy URL

**Portability notes:**
- All API calls go through relative URLs → routed by the shared proxy
- No direct port-to-port calls; the proxy layer handles all cross-service routing
- `BASE_URL` from `import.meta.env` is prepended to all API paths

---

## Layer 2 — Backend (API)

**Location:** `artifacts/api-server/`

**Stack:** Node.js 24 · Express 5 · TypeScript · Clerk JWT middleware · pino logging · esbuild

**Key directories:**
```
src/
├── app.ts                         # Express app: middleware stack wiring
├── index.ts                       # Server entry: reads PORT, calls app.listen()
├── routes/
│   ├── index.ts                   # Master router — all sub-routers registered here
│   ├── me.ts                      # GET/PUT /me (current user profile)
│   ├── users.ts                   # User management (admin)
│   ├── projects.ts                # Projects CRUD + lifecycle + nominees
│   ├── agreements.ts              # Agreements + variables + generations
│   ├── partners.ts                # Partners + claimants
│   ├── governance.ts              # Governance summary
│   ├── storage.ts                 # Presigned upload URLs + file serving
│   ├── inheritance.ts             # Inheritance claims + dashboard + analytics
│   ├── nominee_succession.ts      # Global nominee succession dashboard
│   ├── nominee_activation.ts      # Per-project nominee activation workflows
│   ├── missing_developer.ts       # Missing developer cases (45-day rule)
│   └── [40+ more route files]     # See routes/index.ts for full list
├── middlewares/
│   ├── auth.ts                    # requireAuth + requireRole(…roles)
│   └── clerkProxyMiddleware.ts    # Clerk FAPI proxy (production only)
└── lib/
    ├── objectStorage.ts           # GCS storage client via Replit sidecar
    ├── objectAcl.ts               # Object-level ACL policies
    ├── documentGenerator.ts       # DOCX template rendering (docxtemplater)
    ├── variableRegistry.ts        # Agreement variable registry (16 built-ins)
    ├── variableResolver.ts        # Auto-resolve variables from DB data
    ├── placeholderParser.ts       # {{TOKEN}} placeholder parsing
    ├── formatters.ts              # Legal formatting utilities (INR, dates, etc.)
    ├── distributionEngine.ts      # 50% revenue split waterfall calculator
    ├── financialAudit.ts          # Financial audit log helpers
    └── logger.ts                  # pino logger singleton
```

**Auth flow:**
1. Clerk middleware validates JWT on every request → sets `req.auth`
2. `requireAuth` middleware rejects unauthenticated requests (401)
3. Route handlers call `getAuth(req)` → destructure `{ userId: clerkUserId }`
4. Two-step lookup: `clerkUserId` → `usersTable.id` (UUID) → project assignments
5. Role stored in `usersTable.role` (6 roles: admin, developer, landowner, investor, employee, operational_staff)

**API contract:**
- All routes prefixed `/api/` by the Express router in `app.ts`
- Contract defined in `lib/api-spec/openapi.yaml` (source of truth)
- Never write routes that deviate from the spec without updating the spec first

**Logging:** Use `req.log` (pino-http) in route handlers. Use `logger` (from `lib/logger.ts`) for non-request code. Never use `console.log`.

**Environment variables required:**
- `PORT` — server port (injected by workflow)
- `DATABASE_URL` — PostgreSQL connection string
- `CLERK_SECRET_KEY` — Clerk server-side secret
- `CLERK_PUBLISHABLE_KEY` — Clerk publishable key (used by middleware)
- `SESSION_SECRET` — session signing secret
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` — GCS bucket ID (Replit sidecar)
- `PRIVATE_OBJECT_DIR` — prefix for private file paths in the bucket
- `PUBLIC_OBJECT_SEARCH_PATHS` — comma-separated public path prefixes
- `REPLIT_SIDECAR_ENDPOINT` — (optional) GCS sidecar URL, defaults to `http://127.0.0.1:1106`

---

## Layer 3 — Database

**Location:** `lib/db/`

**Stack:** PostgreSQL · Drizzle ORM · drizzle-kit (migrations)

**Key directories:**
```
lib/db/src/
├── index.ts                       # DB client (pool + drizzle instance)
├── drizzle.config.ts              # Drizzle Kit config for migrations
└── schema/
    ├── index.ts                   # Barrel export (all tables + enums)
    ├── enums.ts                   # All pgEnum definitions
    ├── users.ts                   # usersTable (UUID PK, clerkUserId, role)
    ├── projects.ts                # projectsTable (lifecycle, status)
    ├── partners.ts                # partnersTable
    ├── agreements.ts              # agreementsTable + agreement_variable_values
    ├── assignments.ts             # userProjectAssignmentsTable (RBAC)
    ├── nominees.ts                # projectNomineesTable
    ├── nominee_activation_workflow.ts
    ├── missing_developer.ts       # missingDeveloperCasesTable
    ├── inheritance.ts             # inheritanceClaimsTable + shares + docs
    ├── inheritance_history.ts     # inheritanceOwnershipHistoryTable (write-once)
    ├── production.ts              # productionTable
    ├── templates.ts               # agreementTemplatesTable
    ├── lifecycle.ts               # projectLifecycleHistoryTable
    ├── claimants.ts               # partnerClaimantsTable
    ├── lca_config.ts              # lcaConfigTable + lca_ledger_entries
    ├── landowner_ledger.ts        # landownerLedgerEntriesTable
    └── [15+ more schema files]
```

**Design rules (must be preserved):**
- All primary keys are UUID (`gen_random_uuid()` default) — never serial/integer IDs
- Soft deletes preferred (`isActive boolean`, `deletedAt timestamp`) over hard deletes
- Audit columns on mutable tables: `createdAt`, `updatedAt`, `createdBy` (FK to users), `createdByName` (denormalized for read performance)
- Write-once tables (audit trails, history, generations) must never have UPDATE/DELETE routes exposed

**Migration workflow (development):**
```bash
# Push schema changes to dev database (non-destructive)
pnpm --filter @workspace/db run push

# For production schema changes, apply manually via SQL
# or use drizzle-kit generate + migrate
pnpm --filter @workspace/db run generate
```

**Connection:**
- `DATABASE_URL` env var — throws at startup if missing
- Connection pool via `pg.Pool` — suitable for both serverless and long-running servers

---

## Layer 4 — Document & File Storage

**Location:** `artifacts/api-server/src/lib/objectStorage.ts`

**Provider (current):** Replit Object Storage (backed by Google Cloud Storage)

**Architecture:**
- All file storage goes through `ObjectStorageService` — never to local disk
- File uploads use a **two-step presigned URL flow**:
  1. Frontend calls `POST /api/storage/uploads/request-url` → receives GCS presigned URL
  2. Frontend uploads directly to GCS using the presigned URL (bypasses the API server)
  3. Frontend stores the returned `objectPath` in the DB record
- File downloads: `GET /api/storage/objects/{objectPath}` — API server streams from GCS to client
- In-memory buffers only for document generation (DOCX rendering) — no temp files written

**Storage paths:**
- Private files (agreements, templates, ID documents): `PRIVATE_OBJECT_DIR/` prefix
- Public assets: `PUBLIC_OBJECT_SEARCH_PATHS` prefix

**Sidecar endpoint:**
- Local Replit GCS sidecar runs at `http://127.0.0.1:1106` (provides GCS tokens)
- Override via `REPLIT_SIDECAR_ENDPOINT` env var for non-Replit deployments

**Migration to a different storage provider:**
To replace Replit Object Storage with AWS S3, Azure Blob, or bare GCS:
1. Replace the `objectStorageClient` initialization in `objectStorage.ts` with your provider's SDK
2. Re-implement the `ObjectStorageService` methods (`upload`, `download`, `getSignedUploadUrl`, `delete`)
3. The rest of the application (routes, frontend) requires no changes — the service interface is stable
4. Update `REPLIT_SIDECAR_ENDPOINT` to point to your credential service, or remove the sidecar entirely and use a service account key

---

## Layer 5 — API Contract & Codegen

**Location:** `lib/api-spec/`

**Workflow:** OpenAPI spec (YAML) → Orval → React Query hooks + Zod schemas

```
lib/api-spec/openapi.yaml          # Master contract (edit this, not generated files)
lib/api-client-react/src/generated/api.ts   # Generated hooks (DO NOT EDIT)
lib/api-zod/src/generated/api.ts            # Generated Zod schemas (DO NOT EDIT)
```

**Codegen command:**
```bash
pnpm --filter @workspace/api-spec run codegen
```

This generates hooks and schemas, then runs `typecheck:libs`. Run this whenever you add or change an OpenAPI path or schema.

**Usage pattern:**
- Frontend: import hooks from `@workspace/api-client-react`
- API server: import Zod schemas from `@workspace/api-zod` for request validation
- Never import directly from the generated files' paths — use the package name

---

## Environment Configuration Summary

| Variable | Required | Who Sets It | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | Replit / DBA | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | Yes | Replit Clerk integration | Clerk server-side secret |
| `CLERK_PUBLISHABLE_KEY` | Yes | Replit Clerk integration | Clerk public key (server) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Replit Clerk integration | Clerk public key (frontend) |
| `SESSION_SECRET` | Yes | Admin | Random 32-byte hex string |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Yes | Replit Object Storage | GCS bucket identifier |
| `PRIVATE_OBJECT_DIR` | Yes | Replit Object Storage | Prefix for private objects |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Yes | Replit Object Storage | Comma-separated public prefixes |
| `PORT` | Yes | Workflow system | Port for each service |
| `BASE_PATH` | Yes | Workflow system | URL base path for frontend |
| `NODE_ENV` | Yes | Workflow system | `development` or `production` |
| `REPLIT_SIDECAR_ENDPOINT` | No | Override for non-Replit | GCS sidecar URL (default: `http://127.0.0.1:1106`) |
| `VITE_CLERK_PROXY_URL` | No | Production only | Clerk proxy URL |

---

## Development Commands

```bash
# Install dependencies
pnpm install

# Start services (normally done via Replit workflows)
pnpm --filter @workspace/api-server run dev      # API server on PORT
pnpm --filter @workspace/plantation-web run dev   # Frontend on PORT

# Type checking
pnpm run typecheck                                # Full: libs + all artifacts
pnpm run typecheck:libs                           # Composite libs only
pnpm --filter @workspace/plantation-web run typecheck

# Database
pnpm --filter @workspace/db run push              # Push schema to dev DB
pnpm --filter @workspace/db run generate          # Generate migration files
pnpm --filter @workspace/db run studio            # Open Drizzle Studio

# API codegen (run after changing openapi.yaml)
pnpm --filter @workspace/api-spec run codegen

# Build (for deployment)
pnpm run build
```

---

## Scalability Considerations

### Large document volumes
- Files are stored in GCS (object storage), not in the database → unlimited scale
- The DB stores only `objectPath` strings pointing to GCS objects
- Presigned URL upload flow means the API server is never a bandwidth bottleneck

### Multiple projects / users
- All project-scoped data uses UUID foreign keys → no cross-project leakage
- RBAC is enforced at the API layer via `requireRole` and project assignment checks
- User roles and project assignments are stored in the DB, not in tokens

### Audit-heavy workflows
- Append-only audit tables (activity_logs, audit_logs, generation records, ownership history) use write-once patterns
- Drizzle ORM with raw SQL where needed for complex reporting queries
- No N+1 queries in reporting endpoints — batched selects used throughout

### Future migration away from Replit
The three Replit-specific dependencies are:
1. **GCS sidecar** (`objectStorage.ts`) → replaceable, see Layer 4 above
2. **Clerk proxy middleware** (`clerkProxyMiddleware.ts`) → only active in production; disable by removing proxy middleware and using Clerk's standard SDK
3. **Vite dev plugins** (`vite.config.ts`) → `@replit/vite-plugin-*` conditionally loaded only when `REPL_ID` is present; they degrade gracefully when absent

Everything else (DB, API, frontend) is standard Node.js/React/PostgreSQL code that runs identically on any VPS, container, or PaaS provider.

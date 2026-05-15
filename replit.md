# Hevea Partners — Multi-Project Plantation ERP

Full-stack ERP for a multi-project natural rubber (Hevea brasiliensis) plantation joint-venture business in Tripura, India. Features a public marketing landing page and a private partner portal with role-based access.

> **Architecture reference:** See `ARCHITECTURE.md` for full layer documentation, storage design, migration guidance, and environment variable reference.
> **Environment variables:** See `.env.example` for all required and optional vars.

---

## Run & Operate

```bash
pnpm --filter @workspace/api-server run dev          # API server (port from PORT env)
pnpm --filter @workspace/plantation-web run dev      # Frontend (port from PORT env)
pnpm run typecheck                                   # Full typecheck (libs + artifacts)
pnpm run build                                       # Typecheck + build all packages
pnpm --filter @workspace/api-spec run codegen        # Regenerate hooks/schemas from OpenAPI spec
pnpm --filter @workspace/db run push                 # Push DB schema changes (dev only)
```

**Required env vars:** `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite · Tailwind CSS · shadcn/ui · wouter · @tanstack/react-query |
| API | Express 5 · Clerk JWT (`@clerk/express`) · pino · esbuild |
| Database | PostgreSQL · Drizzle ORM |
| Auth | Clerk (Replit-managed whitelabel) |
| Storage | Replit Object Storage (GCS-backed via sidecar) |
| Validation | Zod · drizzle-zod |
| API contract | Orval (OpenAPI spec → React Query hooks + Zod schemas) |
| Charts | Recharts |

---

## Where Things Live

```
artifacts/plantation-web/src/pages/          All page components (80+ modules)
artifacts/plantation-web/src/components/layout/   Layout, Sidebar (ERP dark), Navbar
artifacts/plantation-web/src/contexts/       RoleContext, ProjectFilterContext, SidebarContext
artifacts/api-server/src/routes/             API route handlers (50+ files)
artifacts/api-server/src/lib/               Business logic libs (storage, generator, formatters)
lib/api-spec/openapi.yaml                   OpenAPI spec (source of truth — edit first)
lib/db/src/schema/                          Drizzle DB schema (source of truth for DB)
lib/api-client-react/src/generated/         Generated React Query hooks (do not edit)
lib/api-zod/src/generated/                  Generated Zod schemas (do not edit)
```

---

## User Roles

Six roles in `usersTable.role`:

| Role | Access |
|---|---|
| `admin` | All modules, all projects |
| `developer` | All modules, all projects |
| `landowner` | Assigned projects only |
| `investor` | Assigned projects only |
| `employee` | Assigned projects only |
| `operational_staff` | Assigned projects only |

`admin` and `developer` have `canAccessAllProjects = true`. All other roles are restricted to `userProjectAssignments`.

---

## Sidebar Modules

| Group | Module | Route | Status |
|---|---|---|---|
| Core | Dashboard | /dashboard | Live |
| Core | Projects | /projects | Live |
| Finance | Agreements | /agreements | Live |
| Finance | Templates | /templates | Live (admin/dev) |
| Finance | Contributions | /contributions | Live |
| Finance | LCA Config | /lca/config | Live |
| Finance | LCA Ledger | /lca/ledger | Live |
| Finance | Landowner Account | /landowner-account | Live |
| Finance | Expenditure | /expenditure | Live |
| Finance | Burden Accounting | /burden | Live |
| Operations | Inventory | /inventory | Live |
| Operations | Sales | /sales | Live |
| Operations | Distribution | /distribution | Live |
| Operations | Production Log | /production-log | Live |
| Analytics | Reports | /reports | Placeholder |
| Analytics | Documents | /documents | Live |
| Analytics | Financial Analytics | /financial-analytics | Live |
| Governance | Governance | /governance | Live |
| Governance | Inheritance Claims | /inheritance-claims | Live |
| Governance | Nominee Succession | /nominee-succession | Live |
| Governance | Succession Workflow | /prematurity-succession | Live |
| Governance | Settlement Governance | /settlement-governance | Live |
| System | Admin | /admin | Live (admin only) |
| System | Override History | /governance-overrides | Live (admin/dev) |
| System | Disputes & Conflicts | /disputes | Live (admin/dev) |
| System | Activation Tasks | /activation | Live (admin/dev) |

---

## Architecture Decisions

- **Contract-first API:** OpenAPI spec → Orval codegen → React Query hooks + Zod schemas in both client and server
- **All PKs are UUID** (`gen_random_uuid()` default). No serial/integer IDs anywhere
- **Clerk auth proxy** only enabled in production (`proxyUrl` is `undefined` in development)
- **Auth middleware two-step:** `clerkUserId` → `usersTable.id` (UUID) → project assignments
- **Object Storage:** Two-step presigned URL upload (API server is never a bandwidth bottleneck). All files stored in GCS — never on local disk
- **`REPLIT_SIDECAR_ENDPOINT`** env var overrides the GCS sidecar URL (portability hook for non-Replit deployments)
- **Write-once audit tables:** Inheritance history, agreement generations, audit logs — no UPDATE/DELETE routes
- **Logging:** `req.log` in route handlers, `logger` singleton for non-request code. Never `console.log`
- **lib/api-zod/src/index.ts** only exports Zod schemas (not types barrel) to avoid TS2308 duplicate name conflicts

---

## Key Systems Summary

### Project Lifecycle
Forward-only state machine: `prematurity → mature_production → closed`. Managed via `POST /projects/:id/lifecycle`. History tracked in `projectLifecycleHistoryTable`.

### Governance Status
Real-time completeness tracking. `GET /governance/summary` returns project, profile, and partner alerts in four levels: `complete`, `pending`, `incomplete`, `attention_required`.

### Agreement System
Templates (DOCX/PDF) stored in GCS. Variable replacement engine with 16 built-in `{{TOKEN}}` variables auto-resolved from DB. Full versioning with immutable generation snapshots.

### LCA Engine
Yearly Land Contribution Adjustment with sequential escalation, carry-forward, and payment event history. Applies to `contribution` model projects in `mature_production` lifecycle.

### Landowner Accounting
Per-(project, partner) ledger: `revenue_entitlement`, `operational_burden`, `recoverable_adjustment`, `lca_credit`. Net position = credits − debits + LCA receivable.

### 50% Revenue Settlement
Distribution sessions splitting gross revenue 50/50 between Economic Participant Pool and landowner. Full waterfall with EPP entry CRUD.

### Nominee Succession
Three activation pathways: Death-Based (death cert + admin verification), Living Handover (declaration deed + OTP), Missing Developer (GD entry + 45-day wait). Transfers governance authority only — not ownership. Global dashboard at `/nominee-succession`.

### Inheritance Claims
Post-maturity ownership inheritance workflow: claim filing, claimant verification, share division, documents. Dashboard + analytics. Ownership history audit trail (write-once).

### Prematurity Succession
Pre-maturity participation and contribution tracking with OTP-verified contribution records.

---

## User Preferences

- All PKs must be UUID — never integer IDs
- Never use `console.log` in server code — use `req.log` or `logger`
- Write-once audit tables must have no UPDATE/DELETE routes
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- Always run `pnpm --filter @workspace/db run push` after changing schema files
- Frontend `assignedProjectIds` is `string[]` (UUID strings) throughout

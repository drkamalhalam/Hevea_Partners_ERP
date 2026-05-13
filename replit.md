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

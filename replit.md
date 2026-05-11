# Hevea Partners

A full-stack web platform for a natural rubber (Hevea brasiliensis) plantation joint-venture business in Tripura, India. It features a public marketing landing page and a private partner portal where landowners, project developers, and investors can log in, view 35-year partnership agreements, track ownership shares, and management can oversee all plantations.

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
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk (Replit-managed whitelabel)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Charts: Recharts

## Where things live

- `artifacts/plantation-web/src/pages/` — all page components (Home, Dashboard, Projects, Partners, Agreements, etc.)
- `artifacts/plantation-web/src/components/layout/` — Layout, Sidebar, Navbar
- `artifacts/api-server/src/routes/` — API routes: projects, partners, agreements, dashboard
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/db/src/schema/index.ts` — Drizzle DB schema (source of truth for DB)
- `lib/api-client-react/` — generated React Query hooks (do not edit manually)

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → React Query hooks + Zod schemas used in both client and server
- Clerk auth proxy only enabled in production (dev instances don't support proxying). `clerkProxyUrl` is `undefined` in development.
- All protected routes use the `ProtectedRoute` wrapper (Clerk `Show when="signed-in"`)
- The 35-year deed model is stored in the `agreements` table with fields matching the actual Tripura deed template (land boundaries, notional value, LCA, yearly escalation, revenue model)

## Product

- **Public landing page**: Marketing page explaining the plantation partnership model, stats, and CTAs
- **Partner portal** (authenticated):
  - Dashboard: KPI cards (projects, partners, agreements, land area) + revenue chart + activity feed
  - Projects: List/create/delete rubber plantation projects with status tracking
  - Partners: Register landowners, developers, and investors
  - Agreements: Create and view 35-year partnership deeds with full boundary and financial details
  - My Portfolio: Personal view of agreements linked to the logged-in user
  - Admin: Management overview of all data + recent activity log

## Seeded Data

- Partners: Ramesh Debbarma (developer), Sukumar Tripura (landowner), Birendra Reang (landowner), Dilip Jamatia (investor)
- Projects: Manu Valley Plantation (developing), Gandacherra Block B (planning), Ambassa Northern Plot (maturing)
- Agreements: 3 active agreements linking the above partners to projects

## Gotchas

- Clerk proxy returns 404 in development — that's intentional. Clerk JS loads directly from CDN in dev. The proxy is only used in production.
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` to sync schema changes to Postgres

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

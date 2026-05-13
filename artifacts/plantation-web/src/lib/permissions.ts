import type { UserRole } from "@/contexts/RoleContext";

// ── Named feature permissions ─────────────────────────────────────────────

export type Permission =
  | "manage:users"
  | "manage:projects"
  | "manage:agreements"
  | "manage:partners"
  | "log:production"
  | "view:contributions"
  | "verify:expenditure"
  | "view:sales"
  | "view:finance_summary"
  | "view:analytics"
  | "view:governance";

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    "manage:users",
    "manage:projects",
    "manage:agreements",
    "manage:partners",
    "log:production",
    "view:contributions",
    "verify:expenditure",
    "view:sales",
    "view:finance_summary",
    "view:analytics",
    "view:governance",
  ],
  developer: [
    "manage:projects",
    "manage:agreements",
    "manage:partners",
    "log:production",
    "view:contributions",
    "verify:expenditure",
    "view:sales",
    "view:finance_summary",
    "view:analytics",
    "view:governance",
  ],
  landowner: ["verify:expenditure"],
  investor: ["view:analytics"],
  employee: ["log:production"],
  operational_staff: [],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// ── Route-level access ────────────────────────────────────────────────────

export const ROLE_ACCESSIBLE_ROUTES: Record<UserRole, string[]> = {
  admin: ["*"],
  developer: [
    "/dashboard",
    "/projects",
    "/my-portfolio",
    "/agreements",
    "/contributions",
    "/expenditure",
    "/production",
    "/inventory",
    "/stock",
    "/sales",
    "/distribution",
    "/reports",
    "/documents",
    "/governance",
    "/notifications",
  ],
  landowner: [
    "/dashboard",
    "/projects",
    "/my-portfolio",
    "/agreements",
    "/expenditure",
    "/distribution",
    "/stock",
    "/documents",
    "/notifications",
  ],
  investor: [
    "/dashboard",
    "/projects",
    "/my-portfolio",
    "/agreements",
    "/reports",
    "/documents",
    "/notifications",
  ],
  employee: [
    "/dashboard",
    "/projects",
    "/my-portfolio",
    "/production",
    "/inventory",
    "/stock",
    "/notifications",
  ],
  operational_staff: [
    "/dashboard",
    "/projects",
    "/my-portfolio",
    "/stock",
    "/inventory",
    "/distribution",
    "/notifications",
  ],
};

export function canAccessRoute(role: UserRole, route: string): boolean {
  const allowed = ROLE_ACCESSIBLE_ROUTES[role];
  if (!allowed) return false;
  if (allowed[0] === "*") return true;
  return allowed.some((r) => route === r || route.startsWith(r + "/"));
}

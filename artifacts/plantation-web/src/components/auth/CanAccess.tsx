import { ReactNode } from "react";
import { useRole } from "@/contexts/RoleContext";
import type { UserRole } from "@/contexts/RoleContext";
import type { Permission } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";

// ── Types ─────────────────────────────────────────────────────────────────

interface CanAccessProps {
  children: ReactNode;
  /** If provided, only renders children if the current user has one of these roles */
  roles?: UserRole[];
  /** If provided, only renders children if the current user has this permission */
  permission?: Permission;
  /** If provided, only renders children if the user can access this project ID */
  project?: string;
  /** Rendered when access is denied. Defaults to null. */
  fallback?: ReactNode;
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * Renders children only when the current user passes all provided checks.
 *
 * Usage:
 *   <CanAccess roles={["admin", "developer"]}>…</CanAccess>
 *   <CanAccess permission="manage:users">…</CanAccess>
 *   <CanAccess project={projectId} fallback={<Redirect to="/" />}>…</CanAccess>
 */
export function CanAccess({
  children,
  roles,
  permission,
  project,
  fallback = null,
}: CanAccessProps) {
  const { role, canAccessProject } = useRole();

  if (roles && !roles.includes(role)) return <>{fallback}</>;
  if (permission && !hasPermission(role, permission)) return <>{fallback}</>;
  if (project !== undefined && !canAccessProject(project)) return <>{fallback}</>;

  return <>{children}</>;
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the current user passes all provided checks.
 *
 * Usage:
 *   const canEdit = useCanAccess({ roles: ["admin"] });
 *   const canLog  = useCanAccess({ permission: "log:production" });
 */
export function useCanAccess({
  roles,
  permission,
  project,
}: {
  roles?: UserRole[];
  permission?: Permission;
  project?: string;
}): boolean {
  const { role, canAccessProject } = useRole();
  if (roles && !roles.includes(role)) return false;
  if (permission && !hasPermission(role, permission)) return false;
  if (project !== undefined && !canAccessProject(project)) return false;
  return true;
}

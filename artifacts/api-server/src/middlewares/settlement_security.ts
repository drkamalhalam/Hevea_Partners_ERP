/**
 * settlement_security.ts
 *
 * Shared security layer for all settlement and distribution modules.
 *
 * Access Matrix:
 *   admin           — full read/write, all projects
 *   developer       — full read/write, all projects
 *   landowner       — read-only, own assigned projects only
 *   investor        — read-only, own assigned projects only (EPP/participation data)
 *   employee        — BLOCKED (403) from all settlement modules
 *   operational_staff — BLOCKED (403) from all settlement modules
 *
 * Provides three exports:
 *   requireSettlementAccess — Express middleware that blocks employee/operational_staff
 *   getProjectScopeFilter   — Returns null (all) or string[] (restricted project IDs)
 *   logSettlementAccess     — Fire-and-forget write to financial_access_logs
 */

import { Request, Response, NextFunction } from "express";
import { db, financialAccessLogsTable } from "@workspace/db";
import { requireRole, canAccessProject } from "./auth";

export { canAccessProject };

/** Roles permitted to access any settlement data (read or write). */
export const SETTLEMENT_ALLOWED_ROLES = [
  "admin",
  "developer",
  "landowner",
  "investor",
] as const;

/**
 * requireSettlementAccess
 * Middleware — rejects employee and operational_staff with 403.
 * Must be used after requireAuth (relies on req.userRole).
 */
export const requireSettlementAccess = requireRole(
  "admin",
  "developer",
  "landowner",
  "investor",
);

/**
 * getProjectScopeFilter
 *
 * Returns:
 *   null      — user has access to all projects (admin / developer)
 *   string[]  — list of project UUIDs the user is allowed to read
 *               (empty array = user has no project assignments → return empty result)
 *
 * Callers should:
 *   if (projectScope !== null && projectScope.length === 0) return empty response
 *   if (projectScope !== null) add inArray(table.projectId, projectScope) to filters
 */
export function getProjectScopeFilter(req: Request): string[] | null {
  if (req.canAccessAllProjects) return null;
  return req.userProjectIds ?? [];
}

/**
 * logSettlementAccess
 *
 * Fire-and-forget write to financial_access_logs.
 * Non-blocking — never throws, never awaited.
 *
 * @param req        — current Express request (provides actor identity + IP)
 * @param resource   — human-readable resource name e.g. "settlement_records"
 * @param action     — "list" | "view" | "create" | "update" | "delete" | "override" | "finalize"
 * @param resourceId — UUID of specific record (for single-record views/writes)
 * @param projectId  — project UUID context if known
 */
export function logSettlementAccess(
  req: Request,
  resource: string,
  action: string,
  resourceId?: string | null,
  projectId?: string | null,
): void {
  const userId = req.dbUserId ?? null;
  const userRole = req.userRole ?? "unknown";
  const ipAddress =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    null;
  const userAgent = (req.headers["user-agent"] as string) ?? null;

  db.insert(financialAccessLogsTable)
    .values({
      userId,
      userRole,
      resource,
      resourceId: resourceId ?? null,
      projectId: (projectId as `${string}-${string}-${string}-${string}-${string}`) ?? null,
      action,
      ipAddress,
      userAgent,
    })
    .catch((err: unknown) => {
      req.log?.warn({ err }, "settlement_security: failed to write financial access log");
    });
}

/**
 * enforceProjectAccess
 *
 * Inline helper for single-record routes.
 * Returns true if user can access the given project.
 * Callers should send 403 and return if this is false.
 */
export function enforceProjectAccess(
  req: Request,
  res: Response,
  projectId: string | null | undefined,
  resource: string,
): boolean {
  if (!projectId) return true; // no project constraint — allow
  if (req.canAccessAllProjects) return true;
  const allowed = (req.userProjectIds ?? []).includes(projectId);
  if (!allowed) {
    req.log?.warn(
      { userId: req.dbUserId, resource, projectId },
      "settlement_security: project access denied",
    );
    res
      .status(403)
      .json({ error: "Access denied: you are not assigned to this project" });
  }
  return allowed;
}

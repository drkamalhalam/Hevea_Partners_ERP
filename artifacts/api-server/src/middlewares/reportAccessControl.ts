/**
 * reportAccessControl.ts
 *
 * Unified security layer for analytics and reporting modules.
 * Extends settlement_security.ts to cover ALL analytics modules.
 *
 * Permission Matrix (canonical source of truth):
 * ─────────────────────────────────────────────────────────────────────────
 *  Module                   | admin | dev | landowner | investor | employee | ops_staff
 * ─────────────────────────────────────────────────────────────────────────
 *  financial_reports        |  ✓   |  ✓  |    ✓      |    ✓    |    ✗    |    ✗
 *  financial_analytics      |  ✓   |  ✓  |    ✓      |    ✓    |    ✗    |    ✗
 *  settlement_analytics     |  ✓   |  ✓  |    ✓      |    ✓    |    ✗    |    ✗
 *  ownership_analytics      |  ✓   |  ✓  |    ✓      |    ✓    |    ✗    |    ✗
 *  global_analytics         |  ✓   |  ✓  |    ✗      |    ✗    |    ✗    |    ✗
 *  governance_reports       |  ✓   |  ✓  |    ✗      |    ✗    |    ✗    |    ✗
 *  operational_analytics    |  ✓   |  ✓  |    ✓      |    ✓    |    ✓    |    ✓
 *  project_analytics        |  ✓   |  ✓  |    ✓      |    ✓    |    ✓    |    ✓
 *  analytics_hub (search)   |  full|  full| financial |financial| ops only| ops only
 *  report_exports           |  all | all | fin/own/dist| fin/own/dist| inventory| inventory
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Exports:
 *   REPORT_MODULE_PERMISSIONS  — canonical role → module map
 *   requireFinancialAccess     — middleware blocking employee / operational_staff from financial data
 *   requireOwnershipAccess     — middleware blocking employee / operational_staff from ownership data
 *   requireSettlementAccess    — alias of requireFinancialAccess (backward compatibility)
 *   logReportAccess            — fire-and-forget write to report_access_audit
 *   logReportDenial            — record a denied access attempt
 *   getAnalyticsHubScope       — returns which data sections a role may see in analytics hub
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import { db, reportAccessAuditTable } from "@workspace/db";
import { requireRole } from "./auth";

// ── Canonical permission matrix ───────────────────────────────────────────────

export const REPORT_MODULE_PERMISSIONS: Record<string, string[]> = {
  financial_reports:     ["admin", "developer", "landowner", "investor"],
  financial_analytics:   ["admin", "developer", "landowner", "investor"],
  settlement_analytics:  ["admin", "developer", "landowner", "investor"],
  ownership_analytics:   ["admin", "developer", "landowner", "investor"],
  global_analytics:      ["admin", "developer"],
  governance_reports:    ["admin", "developer"],
  operational_analytics: ["admin", "developer", "landowner", "investor", "employee", "operational_staff"],
  project_analytics:     ["admin", "developer", "landowner", "investor", "employee", "operational_staff"],
  analytics_hub:         ["admin", "developer", "landowner", "investor", "employee", "operational_staff"],
  report_exports:        ["admin", "developer", "landowner", "investor", "employee", "operational_staff"],
};

/** Returns true if the role is permitted to access the given module. */
export function canAccessModule(role: string, module: string): boolean {
  const allowed = REPORT_MODULE_PERMISSIONS[module];
  if (!allowed) return false;
  return allowed.includes(role);
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * requireFinancialAccess
 * Blocks employee and operational_staff from financial / settlement / ownership modules.
 * Must follow requireAuth.
 */
export const requireFinancialAccess = requireRole(
  "admin", "developer", "landowner", "investor",
);

/** Alias — settlement module uses this name historically. */
export const requireOwnershipAccess = requireFinancialAccess;

// ── Analytics Hub scope ───────────────────────────────────────────────────────

export interface AnalyticsHubScope {
  canViewFinancial:    boolean;  // revenue, expenditure, P&L, LCA, distributions, contributions
  canViewOwnership:    boolean;  // partner equity, transfers, inheritance
  canViewGovernance:   boolean;  // disputes, overrides, alerts
  canViewPartners:     boolean;  // partner-level breakdowns
  canViewOperational:  boolean;  // production, inventory
  canViewProjects:     boolean;  // project metadata (everyone)
}

export function getAnalyticsHubScope(role: string): AnalyticsHubScope {
  const privileged  = role === "admin" || role === "developer";
  const financial   = privileged || role === "landowner" || role === "investor";
  const operational = true; // all roles

  return {
    canViewFinancial:   financial,
    canViewOwnership:   financial,
    canViewGovernance:  privileged,
    canViewPartners:    financial,
    canViewOperational: operational,
    canViewProjects:    operational,
  };
}

// ── Audit logging ─────────────────────────────────────────────────────────────

interface LogReportAccessOpts {
  projectId?:   string | null;
  projectName?: string | null;
  granted?:     boolean;
  denyReason?:  string | null;
  /** Sanitised subset of req.query — caller removes sensitive values */
  querySnapshot?: Record<string, unknown>;
}

/**
 * logReportAccess
 *
 * Fire-and-forget write to report_access_audit.
 * Non-blocking — never throws, never awaited.
 */
export function logReportAccess(
  req: Request,
  module: string,
  endpoint: string,
  opts: LogReportAccessOpts = {},
): void {
  const userId     = req.dbUserId ?? null;
  const userRole   = req.userRole ?? "unknown";
  const displayName = (req as unknown as Record<string, unknown>).dbUser
    ? ((req as unknown as Record<string, unknown>).dbUser as Record<string, unknown>).displayName as string | null
    : null;
  const clerkUserId = (req as unknown as Record<string, unknown>).auth
    ? ((req as unknown as Record<string, unknown>).auth as Record<string, unknown>).userId as string | null
    : null;

  const ipAddress =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    null;
  const userAgent = (req.headers["user-agent"] as string) ?? null;

  // Sanitise query — exclude any token/key fields
  const rawQuery = req.query ?? {};
  const safeQuery: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawQuery)) {
    if (!/(token|key|secret|password|auth)/i.test(k)) {
      safeQuery[k] = v;
    }
  }

  db.insert(reportAccessAuditTable)
    .values({
      userId:       userId as `${string}-${string}-${string}-${string}-${string}` | null,
      userRole,
      displayName:  displayName as string | null,
      clerkUserId:  clerkUserId as string | null,
      module,
      endpoint,
      projectId:    (opts.projectId as `${string}-${string}-${string}-${string}-${string}`) ?? null,
      projectName:  opts.projectName ?? null,
      accessGranted: opts.granted ?? true,
      denyReason:   opts.denyReason ?? null,
      ipAddress,
      userAgent,
      requestQuery: Object.keys(safeQuery).length > 0 ? safeQuery : null,
    })
    .catch((err: unknown) => {
      req.log?.warn({ err }, "reportAccessControl: failed to write report access audit log");
    });
}

/**
 * logReportDenial
 *
 * Convenience wrapper for denied access attempts.
 * Call this before sending the 403/401 response on sensitive routes.
 */
export function logReportDenial(
  req: Request,
  module: string,
  endpoint: string,
  reason: string,
  projectId?: string | null,
): void {
  logReportAccess(req, module, endpoint, {
    projectId,
    granted: false,
    denyReason: reason,
  });
}

/**
 * auditMiddleware
 *
 * Inline pass-through middleware that fire-and-forgets a report access log entry.
 * Place AFTER the role-blocking middleware so it only fires for permitted access.
 *
 * Usage:
 *   router.get("/statement", requireAuth, requireFinancialAccess,
 *              auditMiddleware("financial_reports", "statement"), async (req, res) => { ... })
 */
export function auditMiddleware(module: string, endpoint: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    logReportAccess(req, module, endpoint, { granted: true });
    next();
  };
}

/**
 * sendDenied
 *
 * Send a 403 response AND record the denial in the audit log.
 * Returns void — caller should return after this.
 */
export function sendDenied(
  req: Request,
  res: Response,
  module: string,
  endpoint: string,
  reason: string,
  projectId?: string | null,
): void {
  logReportDenial(req, module, endpoint, reason, projectId);
  res.status(403).json({
    error: "Access denied",
    reason,
    module,
  });
}

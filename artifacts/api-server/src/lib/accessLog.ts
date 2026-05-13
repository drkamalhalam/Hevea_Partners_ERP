/**
 * accessLog — fire-and-forget operational access logging utility.
 *
 * Call this from route handlers to create an audit trail for every
 * access to production, inventory, and sales records.
 *
 * All writes are non-fatal: errors are swallowed so a logging failure
 * never blocks a legitimate request.
 */
import { Request } from "express";
import { db } from "@workspace/db";
import { operationalAccessLogsTable } from "@workspace/db/schema";

export interface AccessLogParams {
  req: Request;
  resourceType: string;
  action: string;
  projectId?: string | null;
  projectName?: string | null;
  resourceId?: string | null;
  resourceRef?: string | null;
  accessDenied?: boolean;
}

export function logOperationalAccess(params: AccessLogParams): void {
  const { req, resourceType, action, projectId, projectName, resourceId, resourceRef, accessDenied = false } = params;

  // Fire-and-forget — never awaited, never throws
  db
    .insert(operationalAccessLogsTable)
    .values({
      userId: (req.dbUserId as string | undefined) ?? undefined,
      userName: undefined, // enriched separately when available
      userRole: (req.userRole as string | undefined) ?? "unknown",
      projectId: projectId ?? undefined,
      projectName: projectName ?? undefined,
      resourceType,
      resourceId: (resourceId as string | undefined) ?? undefined,
      resourceRef: resourceRef ?? undefined,
      action,
      accessDenied,
      clientIp: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined,
      userAgent: req.headers["user-agent"]?.substring(0, 255) ?? undefined,
    })
    .catch((err: unknown) => {
      req.log?.warn({ err }, "Failed to write operational access log (non-fatal)");
    });
}

/**
 * Convenience: log a denied access attempt, then return false.
 * Caller is responsible for sending the 403 response.
 */
export function logDeniedAccess(req: Request, resourceType: string, resourceId?: string | null, projectId?: string | null): void {
  logOperationalAccess({ req, resourceType, action: "denied", projectId, resourceId, accessDenied: true });
}

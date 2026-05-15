/**
 * auditLogger.ts
 *
 * Central audit logging utility. All writes are fire-and-forget — this
 * function never throws and never blocks the request that calls it.
 *
 * Usage:
 *   import { writeAudit } from "../lib/auditLogger";
 *
 *   writeAudit(req, {
 *     tableName: "contributions",
 *     recordId: contribution.id,
 *     operation: "UPDATE",
 *     module: "contributions",
 *     actionType: "contribution_verified",
 *     projectId: contribution.projectId,
 *     oldData: { status: "pending_verification" },
 *     newData: { status: "verified" },
 *   });
 */

import { Request } from "express";
import { eq } from "drizzle-orm";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { logger } from "./logger";

export interface AuditEntry {
  tableName: string;
  recordId: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  module?: string;
  actionType?: string;
  projectId?: string | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  /** Pre-resolved user — if not supplied, resolved from Clerk session on req */
  actor?: {
    id: string;
    name?: string | null;
    role?: string | null;
  } | null;
}

/**
 * Write an immutable audit log entry. Fire-and-forget: never awaited,
 * never throws. The request is used to extract IP, user-agent, and
 * Clerk user ID (if actor is not pre-supplied).
 */
export function writeAudit(req: Request, entry: AuditEntry): void {
  const ip = req.ip ?? null;
  const ua = req.get("user-agent") ?? null;

  const doInsert = async () => {
    let userId: string | null = null;
    let userName: string | null = null;
    let userRole: string | null = null;

    if (entry.actor) {
      userId = entry.actor.id ?? null;
      userName = entry.actor.name ?? null;
      userRole = entry.actor.role ?? null;
    } else {
      const { userId: clerkUserId } = getAuth(req);
      if (clerkUserId) {
        const [user] = await db
          .select({
            id: usersTable.id,
            displayName: usersTable.displayName,
            role: usersTable.role,
          })
          .from(usersTable)
          .where(eq(usersTable.clerkUserId, clerkUserId))
          .limit(1);
        if (user) {
          userId = user.id;
          userName = user.displayName ?? null;
          userRole = user.role ?? null;
        }
      }
    }

    await db.insert(auditLogsTable).values({
      userId: userId ?? undefined,
      tableName: entry.tableName,
      recordId: entry.recordId,
      operation: entry.operation,
      oldData: entry.oldData ?? null,
      newData: entry.newData ?? null,
      ipAddress: ip,
      userAgent: ua,
      projectId: entry.projectId ?? null,
      module: entry.module ?? null,
      actionType: entry.actionType ?? null,
      metadata: entry.metadata ?? null,
      userName: userName ?? null,
      userRole: userRole ?? null,
    });
  };

  doInsert().catch((err) => {
    logger.error({ err, entry }, "Failed to write audit log entry");
  });
}

import type { Request } from "express";
import { db, financialAccessLogsTable } from "@workspace/db";

/**
 * Fire-and-forget audit logger for sensitive financial data access.
 * Call from GET handlers for LCA, landowner accounting, and analytics endpoints.
 * Never await this — must not block the response.
 *
 * @param req      - Express request (must have run through requireAuth)
 * @param resource - Module identifier, e.g. "lca_configs", "landowner_account_summary"
 * @param action   - Access action, default "read"
 * @param projectId - UUID of the project being accessed, if applicable
 * @param resourceId - UUID/ID of the specific record, if applicable
 */
export function logFinancialAccess(
  req: Request,
  resource: string,
  action: string = "read",
  projectId?: string | null,
  resourceId?: string | null,
): void {
  void (async () => {
    try {
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
        req.socket?.remoteAddress ??
        null;

      await db.insert(financialAccessLogsTable).values({
        userId: req.dbUserId ?? null,
        userRole: req.userRole ?? "unknown",
        resource,
        resourceId: resourceId ?? null,
        projectId: projectId ?? null,
        action,
        ipAddress: ip,
        userAgent: (req.headers["user-agent"] ?? null) as string | null,
      });
    } catch {
      // Non-fatal: audit log failures must never block the response
    }
  })();
}

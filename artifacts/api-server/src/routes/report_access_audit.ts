/**
 * report_access_audit.ts
 *
 * Admin-only endpoint for viewing the report access audit log.
 * Records every successful access to analytics and reporting modules.
 *
 * Endpoints:
 *   GET /report-access-audit          — paginated audit log (admin/developer only)
 *   GET /report-access-audit/summary  — module-level access counts (admin/developer only)
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, reportAccessAuditTable } from "@workspace/db";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router = Router();
const requireAdmin = requireRole("admin", "developer");

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── GET /report-access-audit ──────────────────────────────────────────────────

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkId);
  if (!actor) return void res.status(401).json({ error: "Unauthorized" });

  const {
    module,
    userRole,
    accessGranted,
    dateFrom,
    dateTo,
    limit: limitStr = "50",
    offset: offsetStr = "0",
  } = req.query as Record<string, string | undefined>;

  const limit  = Math.min(parseInt(limitStr  ?? "50",  10) || 50,  200);
  const offset = Math.max(parseInt(offsetStr ?? "0",   10) || 0,   0);

  // Build typed drizzle conditions
  const conditions = [];
  if (module)      conditions.push(eq(reportAccessAuditTable.module,       module));
  if (userRole)    conditions.push(eq(reportAccessAuditTable.userRole,     userRole));
  if (accessGranted !== undefined && accessGranted !== "") {
    conditions.push(eq(reportAccessAuditTable.accessGranted, accessGranted === "true"));
  }
  if (dateFrom) conditions.push(gte(reportAccessAuditTable.accessedAt, new Date(dateFrom)));
  if (dateTo)   conditions.push(lte(reportAccessAuditTable.accessedAt, new Date(dateTo)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRows, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(reportAccessAuditTable)
      .where(whereClause),
    db
      .select({
        id:           reportAccessAuditTable.id,
        userId:       reportAccessAuditTable.userId,
        userRole:     reportAccessAuditTable.userRole,
        displayName:  reportAccessAuditTable.displayName,
        module:       reportAccessAuditTable.module,
        endpoint:     reportAccessAuditTable.endpoint,
        projectId:    reportAccessAuditTable.projectId,
        projectName:  reportAccessAuditTable.projectName,
        accessGranted: reportAccessAuditTable.accessGranted,
        denyReason:   reportAccessAuditTable.denyReason,
        ipAddress:    reportAccessAuditTable.ipAddress,
        userAgent:    reportAccessAuditTable.userAgent,
        requestQuery: reportAccessAuditTable.requestQuery,
        accessedAt:   reportAccessAuditTable.accessedAt,
        resolvedName: usersTable.displayName,
      })
      .from(reportAccessAuditTable)
      .leftJoin(usersTable, eq(usersTable.id, reportAccessAuditTable.userId))
      .where(whereClause)
      .orderBy(desc(reportAccessAuditTable.accessedAt))
      .limit(limit)
      .offset(offset),
  ]);

  const total = countRows[0]?.total ?? 0;
  const logs = rows.map(r => ({
    id:            r.id,
    userId:        r.userId ?? null,
    userRole:      r.userRole ?? null,
    displayName:   r.resolvedName ?? r.displayName ?? null,
    module:        r.module,
    endpoint:      r.endpoint,
    projectId:     r.projectId ?? null,
    projectName:   r.projectName ?? null,
    accessGranted: r.accessGranted,
    denyReason:    r.denyReason ?? null,
    ipAddress:     r.ipAddress ?? null,
    userAgent:     r.userAgent ?? null,
    requestQuery:  r.requestQuery ?? null,
    accessedAt:    r.accessedAt?.toISOString() ?? null,
  }));

  return void res.json({ logs, total, limit, offset });
});

// ── GET /report-access-audit/summary ─────────────────────────────────────────

router.get("/summary", requireAuth, requireAdmin, async (req, res) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return void res.status(401).json({ error: "Unauthorized" });

  const [moduleStats, roleStats, recentDenials, dailyVolume] = await Promise.all([
    db.execute(sql`
      SELECT module,
        COUNT(*)::int AS total_accesses,
        COUNT(*) FILTER (WHERE access_granted = false)::int AS denied,
        COUNT(*) FILTER (WHERE access_granted = true)::int  AS granted,
        MAX(accessed_at) AS last_access
      FROM report_access_audit
      WHERE accessed_at >= NOW() - INTERVAL '30 days'
      GROUP BY module ORDER BY total_accesses DESC
    `),
    db.execute(sql`
      SELECT user_role, COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE access_granted = false)::int AS denied
      FROM report_access_audit
      WHERE accessed_at >= NOW() - INTERVAL '30 days'
      GROUP BY user_role ORDER BY total DESC
    `),
    db.execute(sql`
      SELECT raa.module, raa.endpoint, raa.user_role, raa.deny_reason,
             raa.ip_address, raa.accessed_at,
             u.display_name AS display_name
      FROM report_access_audit raa
      LEFT JOIN users u ON u.id = raa.user_id
      WHERE raa.access_granted = false
      ORDER BY raa.accessed_at DESC LIMIT 10
    `),
    db.execute(sql`
      SELECT DATE_TRUNC('day', accessed_at)::date AS day,
             COUNT(*)::int AS accesses,
             COUNT(*) FILTER (WHERE access_granted = false)::int AS denials
      FROM report_access_audit
      WHERE accessed_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1
    `),
  ]);

  return void res.json({
    moduleStats:   moduleStats.rows,
    roleStats:     roleStats.rows,
    recentDenials: recentDenials.rows,
    dailyVolume:   dailyVolume.rows,
  });
});

export default router;

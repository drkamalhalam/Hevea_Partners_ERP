/**
 * user_activity.ts
 *
 * User activity traceability and accountability endpoints.
 * All endpoints are restricted to admin / developer only except where noted.
 *
 *   GET /user-activity/summary            — platform-wide aggregate stats
 *   GET /user-activity/users              — per-user activity summary list
 *   GET /user-activity/user/:userId       — full activity history for one user
 *   GET /user-activity/sensitive          — high-risk action monitoring
 *   GET /user-activity/project/:projectId — per-project accountability report
 *   GET /user-activity/sessions           — login session history
 *   GET /user-activity/role-summary       — breakdown by role
 */

import { Router } from "express";
import {
  db,
  auditLogsTable,
  usersTable,
  userProjectAssignmentsTable,
  userSessionsTable,
  projectsTable,
} from "@workspace/db";
import {
  eq,
  and,
  desc,
  gte,
  lte,
  inArray,
  sql,
  or,
  isNotNull,
  count,
} from "drizzle-orm";
import { requireRole } from "../middlewares/auth";

const router = Router();
router.use(requireRole("admin", "developer"));

// ── Constants ──────────────────────────────────────────────────────────────────

const SENSITIVE_ACTION_TYPES = new Set([
  "contribution_verified",
  "contribution_dispute_resolved",
  "contribution_dispute_rejected",
  "expenditure_approved",
  "expenditure_rejected",
  "settlement_overridden",
  "settlement_finalized",
  "settlement_reopened",
  "lca_adjustment",
  "lca_waived",
  "lca_applied",
  "transfer_executed",
  "transfer_price_override",
  "ownership_transfer",
  "governance_override",
  "governance_manual_note",
  "nominee_activated",
  "inheritance_settled",
  "inheritance_approved",
  "role_changed",
  "user_deactivated",
  "user_activated",
  "document_uploaded",
  "evidence_created",
  "evidence_status_changed",
  "override_created",
  "dispute_resolved",
  "dispute_escalated",
  "maturity_completed",
  "project_lifecycle_changed",
]);

const SENSITIVE_MODULES = new Set([
  "governance",
  "settlement",
  "ownership_transfers",
  "admin",
  "lca",
  "inheritance",
  "nominee_activation",
  "maturity",
  "evidence",
  "governance_overrides",
]);

function isSensitive(row: { actionType: string | null; module: string | null }): boolean {
  return (
    (!!row.actionType && SENSITIVE_ACTION_TYPES.has(row.actionType)) ||
    (!!row.module && SENSITIVE_MODULES.has(row.module))
  );
}

function parseLimit(v: unknown, def = 50, max = 200): number {
  const n = parseInt(String(v), 10);
  return isNaN(n) || n < 1 ? def : Math.min(n, max);
}
function parseOffset(v: unknown): number {
  const n = parseInt(String(v), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function formatAudit(row: typeof auditLogsTable.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId ?? null,
    userName: row.userName ?? null,
    userRole: row.userRole ?? null,
    tableName: row.tableName,
    recordId: row.recordId,
    operation: row.operation,
    module: row.module ?? null,
    actionType: row.actionType ?? null,
    projectId: row.projectId ?? null,
    oldData: row.oldData ?? null,
    newData: row.newData ?? null,
    metadata: row.metadata ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    isSensitive: isSensitive(row),
    createdAt: row.createdAt.toISOString(),
  };
}

// ── GET /user-activity/summary ─────────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    const [
      totalCount,
      last30Count,
      sensitiveCount,
      byRoleRows,
      byModuleRows,
      topUsersRows,
      recentFeed,
      sessionCount,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable),

      db
        .select({ c: sql<number>`count(*)::int` })
        .from(auditLogsTable)
        .where(gte(auditLogsTable.createdAt, thirtyDaysAgo)),

      db
        .select({ c: sql<number>`count(*)::int` })
        .from(auditLogsTable)
        .where(
          and(
            gte(auditLogsTable.createdAt, thirtyDaysAgo),
            isNotNull(auditLogsTable.actionType),
          ),
        ),

      db
        .select({
          userRole: auditLogsTable.userRole,
          cnt: sql<number>`count(*)::int`,
        })
        .from(auditLogsTable)
        .where(gte(auditLogsTable.createdAt, thirtyDaysAgo))
        .groupBy(auditLogsTable.userRole)
        .orderBy(desc(sql`count(*)`)),

      db
        .select({
          module: auditLogsTable.module,
          cnt: sql<number>`count(*)::int`,
        })
        .from(auditLogsTable)
        .where(
          and(
            gte(auditLogsTable.createdAt, thirtyDaysAgo),
            isNotNull(auditLogsTable.module),
          ),
        )
        .groupBy(auditLogsTable.module)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      db
        .select({
          userId: auditLogsTable.userId,
          userName: auditLogsTable.userName,
          userRole: auditLogsTable.userRole,
          cnt: sql<number>`count(*)::int`,
          lastAction: sql<string>`max(${auditLogsTable.createdAt})::text`,
        })
        .from(auditLogsTable)
        .where(
          and(
            gte(auditLogsTable.createdAt, thirtyDaysAgo),
            isNotNull(auditLogsTable.userId),
          ),
        )
        .groupBy(auditLogsTable.userId, auditLogsTable.userName, auditLogsTable.userRole)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      db
        .select()
        .from(auditLogsTable)
        .where(gte(auditLogsTable.createdAt, sevenDaysAgo))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(20),

      db.select({ c: sql<number>`count(*)::int` }).from(userSessionsTable)
        .where(gte(userSessionsTable.createdAt, thirtyDaysAgo)),
    ]);

    res.json({
      totals: {
        allTime: totalCount[0]?.c ?? 0,
        last30Days: last30Count[0]?.c ?? 0,
        sensitiveActions: sensitiveCount[0]?.c ?? 0,
        loginSessions: sessionCount[0]?.c ?? 0,
      },
      byRole: byRoleRows.map((r) => ({ role: r.userRole ?? "unknown", count: r.cnt })),
      byModule: byModuleRows.map((r) => ({ module: r.module ?? "unknown", count: r.cnt })),
      topUsers: topUsersRows.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        userRole: r.userRole,
        actionCount: r.cnt,
        lastAction: r.lastAction,
      })),
      recentFeed: recentFeed.map(formatAudit),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load user activity summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /user-activity/role-summary ───────────────────────────────────────────

router.get("/role-summary", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const [roleActivity, roleUsers] = await Promise.all([
      db
        .select({
          userRole: auditLogsTable.userRole,
          totalActions: sql<number>`count(*)::int`,
          uniqueUsers: sql<number>`count(distinct ${auditLogsTable.userId})::int`,
          lastActivity: sql<string>`max(${auditLogsTable.createdAt})::text`,
        })
        .from(auditLogsTable)
        .groupBy(auditLogsTable.userRole)
        .orderBy(desc(sql`count(*)`)),

      db
        .select({
          role: usersTable.role,
          totalUsers: sql<number>`count(*)::int`,
          activeUsers: sql<number>`count(*) filter (where ${usersTable.isActive} = true)::int`,
        })
        .from(usersTable)
        .groupBy(usersTable.role),
    ]);

    const byRole = roleActivity.map((ra) => {
      const usersInRole = roleUsers.find((u) => u.role === ra.userRole);
      return {
        role: ra.userRole ?? "unknown",
        totalActions: ra.totalActions,
        uniqueActiveUsers: ra.uniqueUsers,
        totalUsers: usersInRole?.totalUsers ?? 0,
        activeUsers: usersInRole?.activeUsers ?? 0,
        lastActivity: ra.lastActivity,
        actionsLast30Days: 0,
      };
    });

    const last30 = await db
      .select({
        userRole: auditLogsTable.userRole,
        cnt: sql<number>`count(*)::int`,
      })
      .from(auditLogsTable)
      .where(gte(auditLogsTable.createdAt, thirtyDaysAgo))
      .groupBy(auditLogsTable.userRole);

    for (const r of byRole) {
      const found = last30.find((l) => l.userRole === r.role);
      r.actionsLast30Days = found?.cnt ?? 0;
    }

    res.json({ byRole });
  } catch (err) {
    req.log.error({ err }, "Failed to load role summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /user-activity/users ──────────────────────────────────────────────────

router.get("/users", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const [users, auditActivity, sessions] = await Promise.all([
      db.select().from(usersTable).orderBy(usersTable.displayName),

      db
        .select({
          userId: auditLogsTable.userId,
          totalActions: sql<number>`count(*)::int`,
          last30DayActions: sql<number>`count(*) filter (where ${auditLogsTable.createdAt} >= ${thirtyDaysAgo})::int`,
          lastActivity: sql<string>`max(${auditLogsTable.createdAt})::text`,
          sensitiveActions: sql<number>`count(*) filter (where ${auditLogsTable.module} = any(array['governance','settlement','ownership_transfers','lca','inheritance','evidence','governance_overrides']))::int`,
        })
        .from(auditLogsTable)
        .where(isNotNull(auditLogsTable.userId))
        .groupBy(auditLogsTable.userId),

      db
        .select({
          userId: userSessionsTable.userId,
          sessionCount: sql<number>`count(*)::int`,
          lastLogin: sql<string>`max(${userSessionsTable.createdAt})::text`,
        })
        .from(userSessionsTable)
        .where(isNotNull(userSessionsTable.userId))
        .groupBy(userSessionsTable.userId),
    ]);

    const activityMap = new Map(auditActivity.map((a) => [a.userId, a]));
    const sessionMap = new Map(sessions.map((s) => [s.userId, s]));

    const result = users.map((u) => {
      const activity = activityMap.get(u.id);
      const session = sessionMap.get(u.id);
      return {
        id: u.id,
        displayName: u.displayName,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt.toISOString(),
        totalActions: activity?.totalActions ?? 0,
        last30DayActions: activity?.last30DayActions ?? 0,
        sensitiveActions: activity?.sensitiveActions ?? 0,
        lastActivity: activity?.lastActivity ?? null,
        sessionCount: session?.sessionCount ?? 0,
        lastLogin: session?.lastLogin ?? null,
      };
    });

    res.json({ users: result });
  } catch (err) {
    req.log.error({ err }, "Failed to load user list");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /user-activity/user/:userId ───────────────────────────────────────────

router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const module = req.query.module as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const conditions: ReturnType<typeof eq>[] = [eq(auditLogsTable.userId, userId)];
    if (module) conditions.push(eq(auditLogsTable.module, module));
    if (from) conditions.push(gte(auditLogsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLogsTable.createdAt, new Date(to)));

    const where = and(...conditions);

    const [rows, countResult, moduleSummary, userRow, userSessions] = await Promise.all([
      db
        .select()
        .from(auditLogsTable)
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),

      db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable).where(where),

      db
        .select({
          module: auditLogsTable.module,
          cnt: sql<number>`count(*)::int`,
        })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.userId, userId))
        .groupBy(auditLogsTable.module)
        .orderBy(desc(sql`count(*)`)),

      db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1),

      db
        .select()
        .from(userSessionsTable)
        .where(eq(userSessionsTable.userId, userId))
        .orderBy(desc(userSessionsTable.createdAt))
        .limit(20),
    ]);

    const user = userRow[0] ?? null;

    res.json({
      user: user
        ? {
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt.toISOString(),
          }
        : null,
      entries: rows.map(formatAudit),
      total: countResult[0]?.c ?? 0,
      limit,
      offset,
      moduleSummary: moduleSummary.map((r) => ({
        module: r.module ?? "unknown",
        count: r.cnt,
      })),
      sessions: userSessions.map((s) => ({
        id: s.id,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load user activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /user-activity/sensitive ──────────────────────────────────────────────

router.get("/sensitive", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 200);
    const offset = parseOffset(req.query.offset);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const projectId = req.query.projectId as string | undefined;

    const sensitiveModulesArr = Array.from(SENSITIVE_MODULES);
    const sensitiveActionsArr = Array.from(SENSITIVE_ACTION_TYPES);

    const conditions = [
      or(
        inArray(auditLogsTable.module, sensitiveModulesArr),
        inArray(auditLogsTable.actionType, sensitiveActionsArr),
      ),
    ];

    if (from) conditions.push(gte(auditLogsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLogsTable.createdAt, new Date(to)));
    if (projectId) conditions.push(eq(auditLogsTable.projectId, projectId));

    const where = and(...conditions);

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogsTable)
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable).where(where),
    ]);

    res.json({
      entries: rows.map(formatAudit),
      total: countResult[0]?.c ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load sensitive actions");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /user-activity/project/:projectId ─────────────────────────────────────

router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const conditions = [eq(auditLogsTable.projectId, projectId)];
    if (from) conditions.push(gte(auditLogsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLogsTable.createdAt, new Date(to)));

    const where = and(...conditions);

    const [rows, countResult, byUser, byModule, projectRow] = await Promise.all([
      db
        .select()
        .from(auditLogsTable)
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),

      db.select({ c: sql<number>`count(*)::int` }).from(auditLogsTable).where(where),

      db
        .select({
          userId: auditLogsTable.userId,
          userName: auditLogsTable.userName,
          userRole: auditLogsTable.userRole,
          totalActions: sql<number>`count(*)::int`,
          sensitiveActions: sql<number>`count(*) filter (where ${auditLogsTable.module} = any(array['governance','settlement','ownership_transfers','lca','inheritance','evidence','governance_overrides']))::int`,
          lastAction: sql<string>`max(${auditLogsTable.createdAt})::text`,
          firstAction: sql<string>`min(${auditLogsTable.createdAt})::text`,
        })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.projectId, projectId))
        .groupBy(auditLogsTable.userId, auditLogsTable.userName, auditLogsTable.userRole)
        .orderBy(desc(sql`count(*)`)),

      db
        .select({
          module: auditLogsTable.module,
          cnt: sql<number>`count(*)::int`,
        })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.projectId, projectId))
        .groupBy(auditLogsTable.module)
        .orderBy(desc(sql`count(*)`)),

      db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    ]);

    res.json({
      project: projectRow[0]
        ? { id: projectRow[0].id, name: projectRow[0].name, lifecycleStatus: projectRow[0].lifecycleStatus }
        : null,
      entries: rows.map(formatAudit),
      total: countResult[0]?.c ?? 0,
      limit,
      offset,
      byUser: byUser.map((u) => ({
        userId: u.userId,
        userName: u.userName,
        userRole: u.userRole,
        totalActions: u.totalActions,
        sensitiveActions: u.sensitiveActions,
        lastAction: u.lastAction,
        firstAction: u.firstAction,
      })),
      byModule: byModule.map((m) => ({ module: m.module ?? "unknown", count: m.cnt })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load project activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /user-activity/sessions ───────────────────────────────────────────────

router.get("/sessions", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const offset = parseOffset(req.query.offset);
    const userId = req.query.userId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const conditions: ReturnType<typeof eq>[] = [];
    if (userId) conditions.push(eq(userSessionsTable.userId, userId));
    if (from) conditions.push(gte(userSessionsTable.createdAt, new Date(from)));
    if (to) conditions.push(lte(userSessionsTable.createdAt, new Date(to)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(userSessionsTable)
        .where(where)
        .orderBy(desc(userSessionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ c: sql<number>`count(*)::int` }).from(userSessionsTable).where(where),
    ]);

    res.json({
      sessions: rows.map((s) => ({
        id: s.id,
        userId: s.userId,
        clerkUserId: s.clerkUserId,
        displayName: s.displayName,
        userRole: s.userRole,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
      })),
      total: countResult[0]?.c ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load sessions");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

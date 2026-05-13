/**
 * GET /operational-access-logs
 * Admin and Developer read-only access to the operational access audit trail.
 *
 * Query params:
 *   userId        – filter by user UUID
 *   projectId     – filter by project UUID
 *   resourceType  – e.g. "sale_detail", "inventory_analytics", "production_batch"
 *   action        – e.g. "view", "list", "analytics", "denied"
 *   accessDenied  – "true" to show only denied attempts
 *   from          – ISO date string lower bound for accessedAt
 *   to            – ISO date string upper bound for accessedAt
 *   limit         – max rows (default 100, max 500)
 *   offset        – pagination offset
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  operationalAccessLogsTable,
  projectsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── GET /operational-access-logs ──────────────────────────────────────────────

router.get(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const {
      userId,
      projectId,
      resourceType,
      action,
      accessDenied,
      from,
      to,
      limit: limitQ,
      offset: offsetQ,
    } = req.query as Record<string, string>;

    const limit = Math.min(parseInt(limitQ ?? "100", 10) || 100, 500);
    const offset = parseInt(offsetQ ?? "0", 10) || 0;

    const conditions = [
      userId ? eq(operationalAccessLogsTable.userId, userId) : undefined,
      projectId ? eq(operationalAccessLogsTable.projectId, projectId) : undefined,
      resourceType ? eq(operationalAccessLogsTable.resourceType, resourceType) : undefined,
      action ? eq(operationalAccessLogsTable.action, action) : undefined,
      accessDenied === "true" ? eq(operationalAccessLogsTable.accessDenied, true) : undefined,
      from ? sql`${operationalAccessLogsTable.accessedAt} >= ${from}::timestamptz` : undefined,
      to ? sql`${operationalAccessLogsTable.accessedAt} <= ${to}::timestamptz` : undefined,
    ].filter(Boolean);

    const rows = await db
      .select({
        id: operationalAccessLogsTable.id,
        userId: operationalAccessLogsTable.userId,
        userRole: operationalAccessLogsTable.userRole,
        projectId: operationalAccessLogsTable.projectId,
        projectName: operationalAccessLogsTable.projectName,
        resourceType: operationalAccessLogsTable.resourceType,
        resourceId: operationalAccessLogsTable.resourceId,
        resourceRef: operationalAccessLogsTable.resourceRef,
        action: operationalAccessLogsTable.action,
        accessDenied: operationalAccessLogsTable.accessDenied,
        clientIp: operationalAccessLogsTable.clientIp,
        accessedAt: operationalAccessLogsTable.accessedAt,
        // Enrich user name from users table
        resolvedName: usersTable.displayName,
        resolvedEmail: usersTable.email,
      })
      .from(operationalAccessLogsTable)
      .leftJoin(usersTable, eq(operationalAccessLogsTable.userId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(operationalAccessLogsTable.accessedAt))
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(operationalAccessLogsTable)
      .where(and(...conditions));

    return res.json({
      logs: rows.map((r) => ({
        id: r.id,
        userId: r.userId ?? undefined,
        userName: r.resolvedName ?? r.resolvedEmail ?? undefined,
        userRole: r.userRole,
        projectId: r.projectId ?? undefined,
        projectName: r.projectName ?? undefined,
        resourceType: r.resourceType,
        resourceId: r.resourceId ?? undefined,
        resourceRef: r.resourceRef ?? undefined,
        action: r.action,
        accessDenied: r.accessDenied,
        clientIp: r.clientIp ?? undefined,
        accessedAt: r.accessedAt.toISOString(),
      })),
      total: totalRow[0]?.total ?? 0,
      limit,
      offset,
    });
  },
);

// ── GET /operational-access-logs/summary ─────────────────────────────────────

router.get(
  "/summary",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { from, to } = req.query as Record<string, string>;

    const timeCondition = and(
      from ? sql`${operationalAccessLogsTable.accessedAt} >= ${from}::timestamptz` : undefined,
      to ? sql`${operationalAccessLogsTable.accessedAt} <= ${to}::timestamptz` : undefined,
    );

    const byRole = await db
      .select({
        role: operationalAccessLogsTable.userRole,
        count: sql<number>`count(*)::int`,
        denied: sql<number>`count(*) filter (where ${operationalAccessLogsTable.accessDenied} = true)::int`,
      })
      .from(operationalAccessLogsTable)
      .where(timeCondition)
      .groupBy(operationalAccessLogsTable.userRole)
      .orderBy(sql`count(*) DESC`);

    const byResourceType = await db
      .select({
        resourceType: operationalAccessLogsTable.resourceType,
        count: sql<number>`count(*)::int`,
        denied: sql<number>`count(*) filter (where ${operationalAccessLogsTable.accessDenied} = true)::int`,
      })
      .from(operationalAccessLogsTable)
      .where(timeCondition)
      .groupBy(operationalAccessLogsTable.resourceType)
      .orderBy(sql`count(*) DESC`);

    const totals = await db
      .select({
        total: sql<number>`count(*)::int`,
        denied: sql<number>`count(*) filter (where ${operationalAccessLogsTable.accessDenied} = true)::int`,
      })
      .from(operationalAccessLogsTable)
      .where(timeCondition);

    return res.json({
      total: totals[0]?.total ?? 0,
      totalDenied: totals[0]?.denied ?? 0,
      byRole: byRole.map((r) => ({
        role: r.role,
        count: r.count,
        denied: r.denied,
      })),
      byResourceType: byResourceType.map((r) => ({
        resourceType: r.resourceType,
        count: r.count,
        denied: r.denied,
      })),
    });
  },
);

export default router;

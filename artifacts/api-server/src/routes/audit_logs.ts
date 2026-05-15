/**
 * audit_logs.ts
 *
 * Read-only query endpoints for the central audit log.
 *
 *   GET /audit-logs                          — paginated log (admin/developer)
 *   GET /audit-logs/record/:table/:recordId  — timeline for one record (any role)
 *   GET /audit-logs/me/activity              — current user's own activity (any role)
 *
 * This router never mutates the audit_logs table.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { enforceWriteOnce } from "../lib/integrityMiddleware";

const router = Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : 0;
  return isNaN(n) || n <= 0 ? DEFAULT_LIMIT : Math.min(n, MAX_LIMIT);
}

function parseOffset(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : 0;
  return isNaN(n) || n < 0 ? 0 : n;
}

function formatEntry(row: typeof auditLogsTable.$inferSelect) {
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
    createdAt: row.createdAt.toISOString(),
  };
}

// ── GET /audit-logs ───────────────────────────────────────────────────────────
// Full paginated log — restricted to admin and developer.

router.get(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = parseLimit(q.limit);
    const offset = parseOffset(q.offset);

    const conditions: ReturnType<typeof eq>[] = [];

    if (q.module) conditions.push(eq(auditLogsTable.module, q.module));
    if (q.actionType) conditions.push(eq(auditLogsTable.actionType, q.actionType));
    if (q.projectId) conditions.push(eq(auditLogsTable.projectId, q.projectId));
    if (q.tableName) conditions.push(eq(auditLogsTable.tableName, q.tableName));
    if (q.operation) {
      conditions.push(
        eq(
          auditLogsTable.operation,
          q.operation as typeof auditLogsTable.operation._.data,
        ),
      );
    }
    if (q.userId) conditions.push(eq(auditLogsTable.userId, q.userId));
    if (q.from) conditions.push(gte(auditLogsTable.createdAt, new Date(q.from)));
    if (q.to) conditions.push(lte(auditLogsTable.createdAt, new Date(q.to)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogsTable)
        .where(where)
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogsTable)
        .where(where),
    ]);

    return res.json({
      entries: rows.map(formatEntry),
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    });
  },
);

// ── GET /audit-logs/record/:tableName/:recordId ───────────────────────────────
// Full timeline for one record — any authenticated user.
// Useful for embedding in detail pages (contribution, expenditure, transfer, …)

router.get("/record/:tableName/:recordId", async (req, res) => {
  const { tableName, recordId } = req.params as { tableName: string; recordId: string };

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.tableName, tableName),
        eq(auditLogsTable.recordId, recordId),
      ),
    )
    .orderBy(desc(auditLogsTable.createdAt));

  return res.json({ entries: rows.map(formatEntry) });
});

// ── GET /audit-logs/me/activity ───────────────────────────────────────────────
// Current user's own recent activity — any authenticated user.

router.get("/me/activity", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  if (!user) return res.json({ entries: [], total: 0 });

  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  const where = eq(auditLogsTable.userId, user.id);

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(auditLogsTable)
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(where),
  ]);

  return res.json({
    entries: rows.map(formatEntry),
    total: countResult[0]?.count ?? 0,
  });
});

// ── Explicit write-once protection ────────────────────────────────────────────
// auditLogsTable is append-only. Block DELETE, PATCH, and PUT at the route level.
// Uses regex paths for Express 5 / path-to-regexp 8 compatibility.
router.delete(/.*/, enforceWriteOnce("audit logs"));
router.patch(/.*/, enforceWriteOnce("audit logs"));
router.put(/.*/, enforceWriteOnce("audit logs"));

export default router;

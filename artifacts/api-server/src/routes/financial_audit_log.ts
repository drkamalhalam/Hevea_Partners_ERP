import { Router } from "express";
import { getAuth } from "@clerk/express";
import { desc, and, eq, gte, lte, inArray } from "drizzle-orm";
import { db, financialAccessLogsTable, usersTable } from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── GET /financial-access-logs ────────────────────────────────────────────────
// Returns paginated financial access audit log entries.
// Admin-only: full history visible. Developer: limited to last 7 days.

router.get(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const {
      resource,
      projectId,
      userId: filterUserId,
      from,
      to,
      limit: limitParam = "50",
      offset: offsetParam = "0",
    } = req.query as Record<string, string>;

    const limitNum = Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offsetParam, 10) || 0, 0);

    const [actor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (!actor) return res.status(401).json({ error: "User not found" });

    // Developers see only the last 7 days; admins see everything
    const developerCutoff =
      actor.role === "developer"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : null;

    const rows = await db
      .select()
      .from(financialAccessLogsTable)
      .where(
        and(
          resource ? eq(financialAccessLogsTable.resource, resource) : undefined,
          projectId
            ? eq(financialAccessLogsTable.projectId, projectId)
            : undefined,
          filterUserId
            ? eq(financialAccessLogsTable.userId, filterUserId)
            : undefined,
          from
            ? gte(financialAccessLogsTable.accessedAt, new Date(from))
            : undefined,
          to
            ? lte(financialAccessLogsTable.accessedAt, new Date(to))
            : undefined,
          developerCutoff
            ? gte(financialAccessLogsTable.accessedAt, developerCutoff)
            : undefined,
        ),
      )
      .orderBy(desc(financialAccessLogsTable.accessedAt))
      .limit(limitNum)
      .offset(offsetNum);

    const entries = rows.map((r) => ({
      id: r.id,
      userId: r.userId ?? undefined,
      userRole: r.userRole,
      resource: r.resource,
      resourceId: r.resourceId ?? undefined,
      projectId: r.projectId ?? undefined,
      action: r.action,
      ipAddress: r.ipAddress ?? undefined,
      accessedAt: r.accessedAt.toISOString(),
    }));

    return res.json({ entries, limit: limitNum, offset: offsetNum });
  },
);

export default router;

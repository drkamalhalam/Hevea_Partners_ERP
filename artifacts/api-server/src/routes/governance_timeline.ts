/**
 * governance_timeline.ts
 *
 * Cross-project evidentiary timeline — admin/developer only.
 *
 * Mounted at /governance-timeline in index.ts.
 *   GET /   — paginated events across all projects (or filtered by projectId)
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq, gte, lte, desc, count } from "drizzle-orm";
import {
  db,
  projectTimelineEventsTable,
  projectsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

const QueryParams = z.object({
  projectId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  severity: z.enum(["info", "important", "critical"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = QueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { projectId, eventType, severity, from, to, limit, offset } = parsed.data;

  try {
    let toDate: Date | undefined;
    if (to) {
      toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
    }

    const whereClause = and(
      projectId ? eq(projectTimelineEventsTable.projectId, projectId) : undefined,
      eventType ? eq(projectTimelineEventsTable.eventType, eventType) : undefined,
      severity ? eq(projectTimelineEventsTable.severity, severity) : undefined,
      from ? gte(projectTimelineEventsTable.occurredAt, new Date(from)) : undefined,
      toDate ? lte(projectTimelineEventsTable.occurredAt, toDate) : undefined,
    );

    const [rows, [{ value: total }]] = await Promise.all([
      db
        .select({
          event: projectTimelineEventsTable,
          projectName: projectsTable.name,
        })
        .from(projectTimelineEventsTable)
        .leftJoin(
          projectsTable,
          eq(projectTimelineEventsTable.projectId, projectsTable.id),
        )
        .where(whereClause)
        .orderBy(desc(projectTimelineEventsTable.occurredAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: count() })
        .from(projectTimelineEventsTable)
        .where(whereClause),
    ]);

    res.json({
      events: rows.map(({ event: e, projectName }) => ({
        ...e,
        projectName: projectName ?? null,
        occurredAt: e.occurredAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      })),
      total: Number(total),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list governance timeline");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

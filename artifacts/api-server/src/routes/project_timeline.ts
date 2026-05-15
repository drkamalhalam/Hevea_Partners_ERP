/**
 * project_timeline.ts
 *
 * Evidentiary project timeline API.
 *
 * Mounted at /projects in index.ts, so paths here are relative:
 *   GET  /:projectId/timeline          — paginated events for a single project
 *   POST /:projectId/timeline          — add manual governance note (admin/dev)
 *
 * All writes are immutable (append-only). No UPDATE/DELETE routes.
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq, gte, lte, desc, count } from "drizzle-orm";
import {
  db,
  projectTimelineEventsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";

const router = Router();

// ── Query params schema ────────────────────────────────────────────────────────

const TimelineQueryParams = z.object({
  eventType: z.string().optional(),
  severity: z.enum(["info", "important", "critical"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── GET /:projectId/timeline ──────────────────────────────────────────────────

router.get("/:projectId/timeline", async (req, res) => {
  const projectId = String(req.params.projectId);

  const parsed = TimelineQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { eventType, severity, from, to, limit, offset } = parsed.data;

  try {
    const [project] = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    let toDate: Date | undefined;
    if (to) {
      toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
    }

    const whereClause = and(
      eq(projectTimelineEventsTable.projectId, projectId),
      eventType ? eq(projectTimelineEventsTable.eventType, eventType) : undefined,
      severity ? eq(projectTimelineEventsTable.severity, severity) : undefined,
      from ? gte(projectTimelineEventsTable.occurredAt, new Date(from)) : undefined,
      toDate ? lte(projectTimelineEventsTable.occurredAt, toDate) : undefined,
    );

    const [events, [{ value: total }]] = await Promise.all([
      db
        .select()
        .from(projectTimelineEventsTable)
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
      events: events.map((e) => ({
        ...e,
        projectName: project.name,
        occurredAt: e.occurredAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      })),
      total: Number(total),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list project timeline");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /:projectId/timeline — manual governance note ────────────────────────

const ManualNoteBody = z.object({
  eventType: z.string().default("governance_note"),
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  severity: z.enum(["info", "important", "critical"]).default("info"),
  relatedTable: z.string().optional(),
  relatedRecordId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

router.post(
  "/:projectId/timeline",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = String(req.params.projectId);
    const parsed = ManualNoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const [project] = await db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const { userId: clerkUserId } = getAuth(req);
      let actorId: string | null = null;
      let actorName: string | null = null;
      let actorRole: string | null = null;

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
          actorId = user.id;
          actorName = user.displayName ?? null;
          actorRole = user.role ?? null;
        }
      }

      const {
        eventType,
        title,
        description,
        severity,
        relatedTable,
        relatedRecordId,
        metadata,
      } = parsed.data;

      const [created] = await db
        .insert(projectTimelineEventsTable)
        .values({
          projectId,
          eventType,
          title,
          description: description ?? null,
          severity,
          actorId: actorId ?? undefined,
          actorName,
          actorRole,
          relatedTable: relatedTable ?? null,
          relatedRecordId: relatedRecordId ?? null,
          metadata: metadata ?? null,
        })
        .returning();

      res.status(201).json({
        ...created,
        projectName: project.name,
        occurredAt: created.occurredAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "Failed to add manual timeline event");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

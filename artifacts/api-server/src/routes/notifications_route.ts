/**
 * notifications_route.ts — Notification Centre
 *
 * GET  /notifications              — list for current user (filterable)
 * GET  /notifications/unread-count — fast badge count
 * PATCH /notifications/:id/read   — mark one as read
 * POST  /notifications/mark-all-read — mark all as read for current user
 * POST  /notifications             — create (admin only, for broadcasts)
 * DELETE /notifications/:id        — delete (own only)
 */

import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { getAuth } from "@clerk/express";
import { requireRole } from "../middlewares/auth";

const router = Router();

async function resolveUser(clerkId: string) {
  const [u] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkId))
    .limit(1);
  return u ?? null;
}

function fmt(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    readAt: n.readAt?.toISOString() ?? null,
    projectId: n.projectId,
    metadata: n.metadata,
    createdAt: n.createdAt.toISOString(),
  };
}

// GET /notifications
router.get("/", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "User not found" }); return; }

    const { unreadOnly, type, projectId } = req.query as Record<string, string>;
    const conds: any[] = [eq(notificationsTable.userId, me.id)];
    if (unreadOnly === "true") conds.push(eq(notificationsTable.isRead, false));
    if (type) conds.push(eq(notificationsTable.type, type as any));
    if (projectId) conds.push(eq(notificationsTable.projectId, projectId));

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(and(...conds))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(200);

    const unreadCount = rows.filter((r) => !r.isRead).length;

    res.json({
      notifications: rows.map(fmt),
      total: rows.length,
      unreadCount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list notifications");
    res.status(500).json({ error: "Failed to list notifications" });
  }
});

// GET /notifications/unread-count
router.get("/unread-count", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.json({ count: 0 }); return; }

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, me.id),
        eq(notificationsTable.isRead, false),
      ));

    res.json({ count: row?.count ?? 0 });
  } catch (err) {
    req.log.error({ err }, "Failed to get unread count");
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

// PATCH /notifications/:id/read
router.patch("/:id/read", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "User not found" }); return; }

    const id = req.params.id as string;
    const { isRead } = req.body as { isRead?: boolean };
    const markRead = isRead !== false;

    const [updated] = await db
      .update(notificationsTable)
      .set({
        isRead: markRead,
        readAt: markRead ? new Date() : null,
      })
      .where(and(
        eq(notificationsTable.id, id),
        eq(notificationsTable.userId, me.id),
      ))
      .returning();

    if (!updated) { res.status(404).json({ error: "Notification not found" }); return; }
    res.json({ notification: fmt(updated) });
  } catch (err) {
    req.log.error({ err }, "Failed to update notification");
    res.status(500).json({ error: "Failed to update notification" });
  }
});

// POST /notifications/mark-all-read
router.post("/mark-all-read", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "User not found" }); return; }

    const now = new Date();
    const result = await db
      .update(notificationsTable)
      .set({ isRead: true, readAt: now })
      .where(and(
        eq(notificationsTable.userId, me.id),
        eq(notificationsTable.isRead, false),
      ))
      .returning({ id: notificationsTable.id });

    res.json({ markedCount: result.length });
  } catch (err) {
    req.log.error({ err }, "Failed to mark all read");
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

// POST /notifications — admin broadcast or system notification
router.post("/", requireRole("admin", "developer"), async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const me = userId ? await resolveUser(userId) : null;

    const { userIds, title, message, type, projectId, metadata } = req.body as {
      userIds: string[];
      title: string;
      message: string;
      type?: string;
      projectId?: string;
      metadata?: any;
    };

    if (!userIds?.length || !title || !message) {
      res.status(400).json({ error: "userIds, title and message are required." });
      return;
    }

    const rows = await db
      .insert(notificationsTable)
      .values(
        userIds.map((uid) => ({
          userId: uid,
          title: title.trim(),
          message: message.trim(),
          type: (type ?? "general") as any,
          projectId: projectId ?? null,
          metadata: metadata ?? null,
          createdBy: me?.id ?? null,
        })),
      )
      .returning();

    res.status(201).json({ created: rows.length, notifications: rows.map(fmt) });
  } catch (err) {
    req.log.error({ err }, "Failed to create notification");
    res.status(500).json({ error: "Failed to create notification" });
  }
});

// DELETE /notifications/:id
router.delete("/:id", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const me = await resolveUser(userId);
    if (!me) { res.status(403).json({ error: "User not found" }); return; }

    const id = req.params.id as string;
    const [deleted] = await db
      .delete(notificationsTable)
      .where(and(
        eq(notificationsTable.id, id),
        eq(notificationsTable.userId, me.id),
      ))
      .returning({ id: notificationsTable.id });

    if (!deleted) { res.status(404).json({ error: "Notification not found" }); return; }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete notification");
    res.status(500).json({ error: "Failed to delete notification" });
  }
});

export default router;

/**
 * field_ops.ts
 *
 * Field Operations & Event Queue — offline-safe field event submission and processing.
 * Mounted at /api/field-ops.
 *
 *   GET  /context/:projectId     — project context for field workers
 *   POST /events                 — submit one or many field events (idempotent)
 *   GET  /events                 — list events (own for field roles; all-pending for admin)
 *   PATCH /events/:id/status     — admin: process | reject | flag-conflict
 *   POST /events/batch-process   — admin: auto-process all processable pending events
 */

import { Router } from "express";
import { db, fieldEventQueueTable, projectsTable, inventoryStockMovementsTable, operationalTasksTable, usersTable } from "@workspace/db";
import { requireRole } from "../middlewares/auth";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, or, sql, desc } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function resolveActor(clerkUserId: string) {
  const [row] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return row ?? null;
}

const ALL_ROLES = ["admin", "developer", "employee", "operational_staff", "landowner", "investor"] as const;

// ── GET /context/:projectId ───────────────────────────────────────────────────
router.get("/context/:projectId", requireRole(...ALL_ROLES), async (req, res) => {
  const projectId = req.params.projectId as string;

  const [projectRows, stockRows, taskRows] = await Promise.all([
    db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        lifecycleStatus: projectsTable.lifecycleStatus,
        activationStatus: projectsTable.activationStatus,
        commercialModel: projectsTable.commercialModel,
        configurationStatus: projectsTable.configurationStatus,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1),

    // Current stock summary
    db
      .select({
        stockType: inventoryStockMovementsTable.stockType,
        unit: inventoryStockMovementsTable.unit,
        balance: sql<number>`
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'in'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN ${inventoryStockMovementsTable.direction} = 'out'
            AND ${inventoryStockMovementsTable.status} = 'confirmed'
            THEN ${inventoryStockMovementsTable.quantity}::numeric ELSE 0 END), 0)`,
      })
      .from(inventoryStockMovementsTable)
      .where(
        and(
          eq(inventoryStockMovementsTable.projectId, projectId),
          eq(inventoryStockMovementsTable.isActive, true),
        ),
      )
      .groupBy(
        inventoryStockMovementsTable.stockType,
        inventoryStockMovementsTable.unit,
      ),

    // Pending tasks count for this project
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operationalTasksTable)
      .where(
        and(
          eq(operationalTasksTable.projectId, projectId),
          or(eq(operationalTasksTable.status, "pending"), eq(operationalTasksTable.status, "in_progress")),
          eq(operationalTasksTable.isActive, true),
        ),
      )
      .then(([r]) => Number(r?.count ?? 0)),
  ]);

  if (projectRows.length === 0) {
    return res.status(404).json({ error: "Project not found" });
  }

  return res.json({
    project: projectRows[0],
    stock: stockRows.map((r) => ({ ...r, balance: Number(r.balance) })),
    pendingTaskCount: taskRows,
    fetchedAt: new Date().toISOString(),
  });
});

// ── POST /events ──────────────────────────────────────────────────────────────
const singleEventSchema = z.object({
  projectId: z.string().uuid().optional(),
  projectName: z.string().optional(),
  eventType: z.enum([
    "quick_production",
    "quick_stock_intake",
    "quick_expense",
    "attendance_check",
    "stock_audit",
    "field_note",
  ]),
  payload: z.record(z.string(), z.unknown()),
  eventedAt: z.string().datetime().optional(),
  idempotencyKey: z.string().max(200).optional(),
});

const submitSchema = z.union([singleEventSchema, z.array(singleEventSchema)]);

router.post("/events", requireRole(...ALL_ROLES), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(403).json({ error: "User not found" });

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid event payload", details: parsed.error.flatten() });
  }

  const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const now = new Date();

  const inserted: (typeof fieldEventQueueTable.$inferSelect)[] = [];
  const skipped: { idempotencyKey: string; reason: string }[] = [];

  for (const evt of events) {
    try {
      const [row] = await db
        .insert(fieldEventQueueTable)
        .values({
          projectId: evt.projectId ?? null,
          projectName: evt.projectName ?? null,
          eventType: evt.eventType,
          payload: evt.payload,
          submittedByUserId: actor.id,
          submittedByName: actor.displayName,
          eventedAt: evt.eventedAt ? new Date(evt.eventedAt) : now,
          idempotencyKey: evt.idempotencyKey ?? null,
          status: "pending",
        })
        .onConflictDoNothing()
        .returning();

      if (row) {
        inserted.push(row);
      } else {
        skipped.push({
          idempotencyKey: evt.idempotencyKey ?? "(no key)",
          reason: "duplicate idempotency key — event already received",
        });
      }
    } catch (err) {
      req.log.error({ err, eventType: evt.eventType }, "field-ops: event insert failed");
      skipped.push({
        idempotencyKey: evt.idempotencyKey ?? "(no key)",
        reason: err instanceof Error ? err.message : "insert error",
      });
    }
  }

  req.log.info(
    { inserted: inserted.length, skipped: skipped.length, userId: actor.id },
    "field-ops: events submitted",
  );

  return res.status(inserted.length > 0 ? 201 : 200).json({
    ok: true,
    inserted: inserted.length,
    skipped: skipped.length,
    events: inserted,
    skippedDetails: skipped.length > 0 ? skipped : undefined,
  });
});

// ── GET /events ───────────────────────────────────────────────────────────────
router.get("/events", requireRole(...ALL_ROLES), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(403).json({ error: "User not found" });

  const isAdmin = ["admin", "developer"].includes(actor.role);
  const statusFilter = req.query.status as string | undefined;
  const limitParam = parseInt(req.query.limit as string ?? "100", 10);
  const limit = Math.min(isNaN(limitParam) ? 100 : limitParam, 500);

  const conditions = [eq(fieldEventQueueTable.isActive, true)];

  // Non-admin roles can only see their own events
  if (!isAdmin) {
    conditions.push(eq(fieldEventQueueTable.submittedByUserId, actor.id));
  }

  if (statusFilter && ["pending", "processed", "conflict", "rejected"].includes(statusFilter)) {
    conditions.push(eq(fieldEventQueueTable.status, statusFilter));
  }

  const rows = await db
    .select()
    .from(fieldEventQueueTable)
    .where(and(...conditions))
    .orderBy(desc(fieldEventQueueTable.createdAt))
    .limit(limit);

  const counts = {
    pending: rows.filter((r) => r.status === "pending").length,
    processed: rows.filter((r) => r.status === "processed").length,
    conflict: rows.filter((r) => r.status === "conflict").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
  };

  return res.json({ events: rows, counts, total: rows.length });
});

// ── PATCH /events/:id/status ──────────────────────────────────────────────────
const patchStatusSchema = z.object({
  status: z.enum(["processed", "conflict", "rejected"]),
  conflictReason: z.string().max(1000).optional(),
  resultEntityId: z.string().uuid().optional(),
  resultEntityType: z.string().max(100).optional(),
});

router.patch("/events/:id/status", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(403).json({ error: "User not found" });

  const id = req.params.id as string;
  const parsed = patchStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const [existing] = await db
    .select({ id: fieldEventQueueTable.id, status: fieldEventQueueTable.status })
    .from(fieldEventQueueTable)
    .where(and(eq(fieldEventQueueTable.id, id), eq(fieldEventQueueTable.isActive, true)))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Event not found" });
  if (existing.status !== "pending") {
    return res.status(409).json({ error: `Event is already ${existing.status} — only pending events can be updated` });
  }

  const now = new Date();
  const [updated] = await db
    .update(fieldEventQueueTable)
    .set({
      status: parsed.data.status,
      conflictReason: parsed.data.conflictReason ?? null,
      processedAt: now,
      processedByUserId: actor.id,
      processedByName: actor.displayName,
      resultEntityId: parsed.data.resultEntityId ?? null,
      resultEntityType: parsed.data.resultEntityType ?? null,
    })
    .where(eq(fieldEventQueueTable.id, id))
    .returning();

  req.log.info(
    { eventId: id, newStatus: parsed.data.status, processedBy: actor.id },
    "field-ops: event status updated",
  );

  return res.json({ ok: true, event: updated });
});

// ── POST /events/batch-process ────────────────────────────────────────────────
// Auto-marks all pending `field_note` and `attendance_check` events as processed.
// Other event types (quick_production, quick_stock_intake, etc.) require manual
// review and routing to the appropriate canonical module.
router.post("/events/batch-process", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(403).json({ error: "User not found" });

  // Auto-processable types: observation-only events that don't create canonical records
  const autoProcessableTypes = ["field_note", "attendance_check"];

  const pending = await db
    .select({ id: fieldEventQueueTable.id, eventType: fieldEventQueueTable.eventType })
    .from(fieldEventQueueTable)
    .where(
      and(
        eq(fieldEventQueueTable.status, "pending"),
        eq(fieldEventQueueTable.isActive, true),
        inArray(fieldEventQueueTable.eventType, autoProcessableTypes),
      ),
    );

  if (pending.length === 0) {
    return res.json({ ok: true, processed: 0, message: "No auto-processable pending events found." });
  }

  const ids = pending.map((r) => r.id);
  const now = new Date();

  await db
    .update(fieldEventQueueTable)
    .set({
      status: "processed",
      processedAt: now,
      processedByUserId: actor.id,
      processedByName: actor.displayName,
      conflictReason: null,
    })
    .where(inArray(fieldEventQueueTable.id, ids));

  req.log.info(
    { processed: ids.length, processedBy: actor.id },
    "field-ops: batch auto-process complete",
  );

  return res.json({
    ok: true,
    processed: ids.length,
    eventIds: ids,
    message: `${ids.length} field note and attendance event(s) marked as processed.`,
  });
});

export default router;

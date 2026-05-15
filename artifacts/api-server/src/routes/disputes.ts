/**
 * disputes.ts
 *
 * Dispute and conflict traceability API.
 *
 * Routes:
 *   GET  /disputes                 — paginated list, admin/dev
 *   POST /disputes                 — create dispute record, admin/dev
 *   GET  /disputes/pending-summary — dashboard counts + urgent list (BEFORE /:id)
 *   GET  /disputes/:id             — single dispute + full event history
 *   POST /disputes/:id/events      — add resolution event (review/note/resolve/escalate/withdraw)
 *
 * Write-once: disputeResolutionEventsTable has no UPDATE/DELETE routes.
 * Disputes themselves are mutable (status transitions).
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, ilike, lte, ne, or, SQL } from "drizzle-orm";
import {
  db,
  disputesTable,
  disputeResolutionEventsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveUser(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function fmt(d: typeof disputesTable.$inferSelect & { projectName?: string | null }) {
  return {
    id: d.id,
    projectId: d.projectId,
    projectName: (d as { projectName?: string | null }).projectName ?? null,
    disputeType: d.disputeType,
    status: d.status,
    severity: d.severity,
    title: d.title,
    description: d.description ?? null,
    raisedById: d.raisedById ?? null,
    raisedByName: d.raisedByName ?? null,
    raisedByRole: d.raisedByRole ?? null,
    raisedAt: d.raisedAt.toISOString(),
    relatedTable: d.relatedTable ?? null,
    relatedRecordId: d.relatedRecordId ?? null,
    supportingDocuments: d.supportingDocuments ?? null,
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
    resolvedById: d.resolvedById ?? null,
    resolvedByName: d.resolvedByName ?? null,
    resolvedByRole: d.resolvedByRole ?? null,
    resolutionSummary: d.resolutionSummary ?? null,
    metadata: d.metadata ?? null,
    isActive: d.isActive,
    updatedAt: d.updatedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

function fmtEvent(e: typeof disputeResolutionEventsTable.$inferSelect) {
  return {
    id: e.id,
    disputeId: e.disputeId,
    projectId: e.projectId ?? null,
    eventType: e.eventType,
    previousStatus: e.previousStatus ?? null,
    newStatus: e.newStatus ?? null,
    description: e.description ?? null,
    actorId: e.actorId ?? null,
    actorName: e.actorName ?? null,
    actorRole: e.actorRole ?? null,
    metadata: e.metadata ?? null,
    performedAt: e.performedAt.toISOString(),
  };
}

// Status → next allowed statuses
const STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ["under_review", "escalated", "withdrawn", "resolved"],
  under_review: ["resolved", "escalated", "withdrawn"],
  escalated: ["under_review", "resolved", "withdrawn"],
  resolved: [],
  withdrawn: [],
};

// eventType → resulting status (null = no status change)
const EVENT_STATUS_MAP: Record<string, string | null> = {
  reviewed: "under_review",
  note_added: null,
  resolved: "resolved",
  withdrawn: "withdrawn",
  escalated: "escalated",
};

// ── GET /disputes ─────────────────────────────────────────────────────────────

router.get("/", requireRole("admin", "developer"), async (req, res) => {
  const q = req.query as Record<string, string>;
  const limit = Math.min(parseInt(q.limit ?? "50", 10), 200);
  const offset = parseInt(q.offset ?? "0", 10);

  const conditions: SQL[] = [];
  if (q.projectId) conditions.push(eq(disputesTable.projectId, q.projectId));
  if (q.disputeType) conditions.push(eq(disputesTable.disputeType, q.disputeType));
  if (q.status) conditions.push(eq(disputesTable.status, q.status));
  if (q.severity) conditions.push(eq(disputesTable.severity, q.severity));
  if (q.from) conditions.push(gte(disputesTable.raisedAt, new Date(q.from)));
  if (q.to) conditions.push(lte(disputesTable.raisedAt, new Date(q.to)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        dispute: disputesTable,
        projectName: projectsTable.name,
      })
      .from(disputesTable)
      .leftJoin(projectsTable, eq(disputesTable.projectId, projectsTable.id))
      .where(where)
      .orderBy(desc(disputesTable.raisedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(disputesTable)
      .where(where),
  ]);

  const disputes = rows.map((r) =>
    fmt({ ...r.dispute, projectName: r.projectName ?? null }),
  );

  return res.json({ disputes, total: Number(total) });
});

// ── POST /disputes ────────────────────────────────────────────────────────────

const createSchema = z.object({
  projectId: z.string().uuid(),
  disputeType: z.enum([
    "contribution",
    "expenditure",
    "settlement",
    "ownership",
    "inheritance",
    "governance",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
  title: z.string().min(5),
  description: z.string().optional().nullable(),
  relatedTable: z.string().optional().nullable(),
  relatedRecordId: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkUserId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const b = parsed.data;

  // Verify project exists
  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, b.projectId))
    .limit(1);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const [dispute] = await db
    .insert(disputesTable)
    .values({
      projectId: b.projectId,
      disputeType: b.disputeType,
      status: "open",
      severity: b.severity,
      title: b.title,
      description: b.description ?? null,
      raisedById: user.id,
      raisedByName: user.displayName ?? null,
      raisedByRole: user.role,
      relatedTable: b.relatedTable ?? null,
      relatedRecordId: b.relatedRecordId ?? null,
      metadata: b.metadata ?? null,
    })
    .returning();

  // Immutable "raised" event
  await db.insert(disputeResolutionEventsTable).values({
    disputeId: dispute.id,
    projectId: dispute.projectId,
    eventType: "raised",
    previousStatus: null,
    newStatus: "open",
    description: b.description ?? b.title,
    actorId: user.id,
    actorName: user.displayName ?? null,
    actorRole: user.role,
    metadata: b.metadata ?? null,
  });

  req.log.info({ disputeId: dispute.id, disputeType: b.disputeType }, "Dispute created");
  return res.status(201).json({ dispute: fmt(dispute) });
});

// ── GET /disputes/pending-summary ─────────────────────────────────────────────
// MUST be before /:id to avoid path collision

router.get("/pending-summary", requireRole("admin", "developer"), async (req, res) => {
  const q = req.query as Record<string, string>;
  const conditions: SQL[] = [ne(disputesTable.status, "resolved"), ne(disputesTable.status, "withdrawn")];
  if (q.projectId) conditions.push(eq(disputesTable.projectId, q.projectId));
  const activeWhere = and(...conditions);

  // All non-resolved disputes
  const allRows = await db
    .select({
      dispute: disputesTable,
      projectName: projectsTable.name,
    })
    .from(disputesTable)
    .leftJoin(projectsTable, eq(disputesTable.projectId, projectsTable.id))
    .where(activeWhere)
    .orderBy(asc(disputesTable.raisedAt));

  const open = allRows.filter((r) => r.dispute.status === "open");
  const underReview = allRows.filter((r) => r.dispute.status === "under_review");
  const escalated = allRows.filter((r) => r.dispute.status === "escalated");
  const highSeverity = allRows.filter((r) =>
    r.dispute.status !== "resolved" &&
    r.dispute.status !== "withdrawn" &&
    (r.dispute.severity === "high" || r.dispute.severity === "critical"),
  );

  // Count resolved/withdrawn overall
  const resolvedConditions: SQL[] = [];
  if (q.projectId) resolvedConditions.push(eq(disputesTable.projectId, q.projectId));
  resolvedConditions.push(eq(disputesTable.status, "resolved"));
  const [{ totalResolved }] = await db
    .select({ totalResolved: count() })
    .from(disputesTable)
    .where(and(...resolvedConditions));

  // byType aggregation
  const typeMap = new Map<string, { open: number; underReview: number; escalated: number }>();
  for (const r of allRows) {
    const t = r.dispute.disputeType;
    if (!typeMap.has(t)) typeMap.set(t, { open: 0, underReview: 0, escalated: 0 });
    const entry = typeMap.get(t)!;
    if (r.dispute.status === "open") entry.open++;
    if (r.dispute.status === "under_review") entry.underReview++;
    if (r.dispute.status === "escalated") entry.escalated++;
  }

  // Urgent = critical/high severity open or escalated, sorted by raisedAt
  const urgent = allRows
    .filter(
      (r) =>
        (r.dispute.severity === "critical" || r.dispute.severity === "high") &&
        (r.dispute.status === "open" || r.dispute.status === "escalated"),
    )
    .slice(0, 10)
    .map((r) => fmt({ ...r.dispute, projectName: r.projectName ?? null }));

  return res.json({
    totalOpen: open.length,
    totalUnderReview: underReview.length,
    totalEscalated: escalated.length,
    totalResolved: Number(totalResolved),
    highSeverityOpen: highSeverity.length,
    byType: Array.from(typeMap.entries()).map(([disputeType, counts]) => ({
      disputeType,
      ...counts,
    })),
    urgent,
  });
});

// ── GET /disputes/:id ─────────────────────────────────────────────────────────

router.get("/:id", requireRole("admin", "developer"), async (req, res) => {
  const { id } = req.params as { id: string };

  const [row] = await db
    .select({ dispute: disputesTable, projectName: projectsTable.name })
    .from(disputesTable)
    .leftJoin(projectsTable, eq(disputesTable.projectId, projectsTable.id))
    .where(eq(disputesTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ error: "Dispute not found" });

  const events = await db
    .select()
    .from(disputeResolutionEventsTable)
    .where(eq(disputeResolutionEventsTable.disputeId, id))
    .orderBy(asc(disputeResolutionEventsTable.performedAt));

  return res.json({
    dispute: fmt({ ...row.dispute, projectName: row.projectName ?? null }),
    events: events.map(fmtEvent),
  });
});

// ── POST /disputes/:id/events ─────────────────────────────────────────────────

const eventSchema = z.object({
  eventType: z.enum(["reviewed", "note_added", "resolved", "withdrawn", "escalated"]),
  description: z.string().min(3),
  resolutionSummary: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

router.post("/:id/events", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(clerkUserId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const { id } = req.params as { id: string };

  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", details: parsed.error.issues });
  }
  const b = parsed.data;

  const [existing] = await db
    .select()
    .from(disputesTable)
    .where(eq(disputesTable.id, id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Dispute not found" });

  // Check if already in a terminal state
  if (existing.status === "resolved" || existing.status === "withdrawn") {
    return res.status(409).json({
      error: `Cannot add event to a ${existing.status} dispute`,
    });
  }

  const newStatus = EVENT_STATUS_MAP[b.eventType] ?? null;

  // Validate transition
  if (newStatus && !STATUS_TRANSITIONS[existing.status]?.includes(newStatus)) {
    return res.status(409).json({
      error: `Cannot transition from ${existing.status} to ${newStatus}`,
    });
  }

  // Build dispute update patch
  const now = new Date();
  const patch: Partial<typeof disputesTable.$inferInsert> = { updatedAt: now };
  if (newStatus) patch.status = newStatus;
  if (b.eventType === "resolved") {
    patch.resolvedAt = now;
    patch.resolvedById = user.id;
    patch.resolvedByName = user.displayName ?? null;
    patch.resolvedByRole = user.role;
    if (b.resolutionSummary) patch.resolutionSummary = b.resolutionSummary;
  }

  const [updatedDispute] = await db
    .update(disputesTable)
    .set(patch)
    .where(eq(disputesTable.id, id))
    .returning();

  // Immutable event record
  const [event] = await db
    .insert(disputeResolutionEventsTable)
    .values({
      disputeId: id,
      projectId: existing.projectId,
      eventType: b.eventType,
      previousStatus: existing.status,
      newStatus: newStatus ?? existing.status,
      description: b.description,
      actorId: user.id,
      actorName: user.displayName ?? null,
      actorRole: user.role,
      metadata: b.metadata ?? null,
    })
    .returning();

  req.log.info(
    { disputeId: id, eventType: b.eventType, newStatus },
    "Dispute event added",
  );

  return res.json({ dispute: fmt(updatedDispute), event: fmtEvent(event) });
});

export default router;

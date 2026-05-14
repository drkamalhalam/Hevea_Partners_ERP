/**
 * settlement_overrides.ts
 *
 * Manual settlement override and finalization system.
 *
 * Authority model:
 *   - Any authenticated user may call POST /:id/override (with remarks required)
 *   - Admin / developer may call POST /:id/finalize, POST /:id/set-recommendation,
 *     POST /:id/dispute, POST /:id/reopen
 *   - Admin only may DELETE (soft-archive) records and POST /:id/reopen
 *
 * All state transitions write an immutable row to settlement_override_events.
 */

import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  settlementRecordsTable,
  settlementOverrideEventsTable,
  usersTable,
  projectsTable,
  partnersTable,
} from "@workspace/db";
import { eq, and, desc, isNull, or, inArray } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";
import {
  requireSettlementAccess,
  getProjectScopeFilter,
  logSettlementAccess,
  enforceProjectAccess,
} from "../middlewares/settlement_security";

const router = Router();

// ── Helper: resolve internal userId from Clerk userId ─────────────────────

async function resolveUser(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

// ── Helper: write an immutable audit event ────────────────────────────────

async function writeEvent(payload: {
  settlementRecordId: string;
  projectId?: string | null;
  partnerId?: string | null;
  eventType: string;
  previousAmount?: string | null;
  newAmount?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  performedBy?: string | null;
  performedByName?: string | null;
  performedByRole?: string | null;
  remarks?: string | null;
  metadata?: unknown;
}) {
  await db.insert(settlementOverrideEventsTable).values({
    settlementRecordId: payload.settlementRecordId,
    projectId: payload.projectId ?? null,
    partnerId: payload.partnerId ?? null,
    eventType: payload.eventType,
    previousAmount: payload.previousAmount ?? null,
    newAmount: payload.newAmount ?? null,
    previousStatus: payload.previousStatus ?? null,
    newStatus: payload.newStatus ?? null,
    performedBy: payload.performedBy ?? null,
    performedByName: payload.performedByName ?? null,
    performedByRole: payload.performedByRole ?? null,
    remarks: payload.remarks ?? null,
    metadata: payload.metadata ? (payload.metadata as Record<string, unknown>) : null,
  });
}

// ── GET /settlement — list records ────────────────────────────────────────

router.get("/", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveUser(auth.userId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const projectScope = getProjectScopeFilter(req);
  if (projectScope !== null && projectScope.length === 0) {
    logSettlementAccess(req, "settlement_records", "list");
    return res.json({ records: [], total: 0 });
  }

  const { projectId, partnerId, status, type } = req.query as Record<string, string | undefined>;

  let query = db
    .select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      settlementType: settlementRecordsTable.settlementType,
      sourceReferenceId: settlementRecordsTable.sourceReferenceId,
      periodLabel: settlementRecordsTable.periodLabel,
      periodStart: settlementRecordsTable.periodStart,
      periodEnd: settlementRecordsTable.periodEnd,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      recommendedAt: settlementRecordsTable.recommendedAt,
      recommendedByName: settlementRecordsTable.recommendedByName,
      actualAmount: settlementRecordsTable.actualAmount,
      isOverridden: settlementRecordsTable.isOverridden,
      overrideCount: settlementRecordsTable.overrideCount,
      lastOverriddenAt: settlementRecordsTable.lastOverriddenAt,
      lastOverriddenByName: settlementRecordsTable.lastOverriddenByName,
      lastOverriddenByRole: settlementRecordsTable.lastOverriddenByRole,
      status: settlementRecordsTable.status,
      finalizedAt: settlementRecordsTable.finalizedAt,
      finalizedByName: settlementRecordsTable.finalizedByName,
      createdAt: settlementRecordsTable.createdAt,
      updatedAt: settlementRecordsTable.updatedAt,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(eq(settlementRecordsTable.isActive, true))
    .$dynamic();

  const filters: ReturnType<typeof eq>[] = [eq(settlementRecordsTable.isActive, true)];
  if (projectId) filters.push(eq(settlementRecordsTable.projectId, projectId));
  if (partnerId) filters.push(eq(settlementRecordsTable.partnerId, partnerId));
  if (status) filters.push(eq(settlementRecordsTable.status, status));
  if (type) filters.push(eq(settlementRecordsTable.settlementType, type));
  if (projectScope !== null) filters.push(inArray(settlementRecordsTable.projectId, projectScope));

  const rows = await db
    .select({
      id: settlementRecordsTable.id,
      projectId: settlementRecordsTable.projectId,
      projectName: projectsTable.name,
      partnerId: settlementRecordsTable.partnerId,
      partnerName: partnersTable.name,
      settlementType: settlementRecordsTable.settlementType,
      sourceReferenceId: settlementRecordsTable.sourceReferenceId,
      periodLabel: settlementRecordsTable.periodLabel,
      periodStart: settlementRecordsTable.periodStart,
      periodEnd: settlementRecordsTable.periodEnd,
      recommendedAmount: settlementRecordsTable.recommendedAmount,
      recommendedAt: settlementRecordsTable.recommendedAt,
      recommendedByName: settlementRecordsTable.recommendedByName,
      actualAmount: settlementRecordsTable.actualAmount,
      isOverridden: settlementRecordsTable.isOverridden,
      overrideCount: settlementRecordsTable.overrideCount,
      lastOverriddenAt: settlementRecordsTable.lastOverriddenAt,
      lastOverriddenByName: settlementRecordsTable.lastOverriddenByName,
      lastOverriddenByRole: settlementRecordsTable.lastOverriddenByRole,
      status: settlementRecordsTable.status,
      finalizedAt: settlementRecordsTable.finalizedAt,
      finalizedByName: settlementRecordsTable.finalizedByName,
      createdAt: settlementRecordsTable.createdAt,
      updatedAt: settlementRecordsTable.updatedAt,
    })
    .from(settlementRecordsTable)
    .leftJoin(projectsTable, eq(settlementRecordsTable.projectId, projectsTable.id))
    .leftJoin(partnersTable, eq(settlementRecordsTable.partnerId, partnersTable.id))
    .where(and(...filters))
    .orderBy(desc(settlementRecordsTable.createdAt));

  logSettlementAccess(req, "settlement_records", "list");
  return res.json({ records: rows, total: rows.length });
});

// ── POST /settlement — create record ─────────────────────────────────────

router.post(
  "/",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const {
      projectId,
      partnerId,
      settlementType,
      sourceReferenceId,
      periodLabel,
      periodStart,
      periodEnd,
      recommendedAmount,
      recommendedBreakdown,
      notes,
    } = req.body;

    if (!projectId || !settlementType || !periodLabel) {
      return res.status(400).json({ error: "projectId, settlementType, periodLabel required" });
    }

    const [record] = await db
      .insert(settlementRecordsTable)
      .values({
        projectId,
        partnerId: partnerId ?? null,
        settlementType,
        sourceReferenceId: sourceReferenceId ?? null,
        periodLabel,
        periodStart: periodStart ?? null,
        periodEnd: periodEnd ?? null,
        recommendedAmount: recommendedAmount ?? null,
        recommendedBreakdown: recommendedBreakdown ?? null,
        recommendedAt: recommendedAmount ? new Date() : null,
        recommendedBy: recommendedAmount ? user.id : null,
        recommendedByName: recommendedAmount ? (user.displayName ?? null) : null,
        actualAmount: recommendedAmount ?? null,
        status: recommendedAmount ? "recommended" : "draft",
        notes: notes ?? null,
        createdBy: user.id,
        createdByName: user.displayName ?? null,
      })
      .returning();

    await writeEvent({
      settlementRecordId: record.id,
      projectId: record.projectId,
      partnerId: record.partnerId,
      eventType: "created",
      previousStatus: null,
      newStatus: record.status,
      newAmount: record.recommendedAmount,
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: `Record created for period: ${periodLabel}`,
      metadata: { settlementType, sourceReferenceId },
    });

    return res.status(201).json({ record });
  }
);

// ── GET /settlement/:id — get single record with events ──────────────────

router.get("/:id", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params as { id: string };

  const [record] = await db
    .select()
    .from(settlementRecordsTable)
    .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
    .limit(1);

  if (!record) return res.status(404).json({ error: "Record not found" });
  if (!enforceProjectAccess(req, res, record.projectId, "settlement_records")) return;

  const events = await db
    .select()
    .from(settlementOverrideEventsTable)
    .where(eq(settlementOverrideEventsTable.settlementRecordId, id))
    .orderBy(desc(settlementOverrideEventsTable.performedAt));

  logSettlementAccess(req, "settlement_records", "view", id, record.projectId ?? undefined);
  return res.json({ record, events });
});

// ── PATCH /settlement/:id — update draft record ───────────────────────────

router.patch(
  "/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(settlementRecordsTable)
      .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "finalized") {
      return res.status(409).json({ error: "Cannot edit a finalized settlement record" });
    }

    const { periodLabel, periodStart, periodEnd, notes } = req.body;

    const [updated] = await db
      .update(settlementRecordsTable)
      .set({
        periodLabel: periodLabel ?? existing.periodLabel,
        periodStart: periodStart ?? existing.periodStart,
        periodEnd: periodEnd ?? existing.periodEnd,
        notes: notes !== undefined ? notes : existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(settlementRecordsTable.id, id))
      .returning();

    await writeEvent({
      settlementRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "updated",
      previousStatus: existing.status,
      newStatus: updated.status,
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: "Record metadata updated",
    });

    return res.json({ record: updated });
  }
);

// ── POST /settlement/:id/set-recommendation — set/update recommendation ──

router.post(
  "/:id/set-recommendation",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };
    const { recommendedAmount, recommendedBreakdown, remarks } = req.body;

    if (recommendedAmount === undefined) {
      return res.status(400).json({ error: "recommendedAmount required" });
    }

    const [existing] = await db
      .select()
      .from(settlementRecordsTable)
      .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "finalized") {
      return res.status(409).json({ error: "Cannot update recommendation on a finalized record" });
    }

    const [updated] = await db
      .update(settlementRecordsTable)
      .set({
        recommendedAmount: String(recommendedAmount),
        recommendedBreakdown: recommendedBreakdown ?? existing.recommendedBreakdown,
        recommendedAt: new Date(),
        recommendedBy: user.id,
        recommendedByName: user.displayName ?? null,
        actualAmount: existing.isOverridden ? existing.actualAmount : String(recommendedAmount),
        status: "recommended",
        updatedAt: new Date(),
      })
      .where(eq(settlementRecordsTable.id, id))
      .returning();

    await writeEvent({
      settlementRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "recommendation_set",
      previousAmount: existing.recommendedAmount,
      newAmount: String(recommendedAmount),
      previousStatus: existing.status,
      newStatus: "recommended",
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: remarks ?? null,
      metadata: { breakdown: recommendedBreakdown },
    });

    return res.json({ record: updated });
  }
);

// ── POST /settlement/:id/override — any user may override ────────────────

router.post("/:id/override", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
  const user = await resolveUser(auth.userId);
  if (!user) return res.status(403).json({ error: "User not registered" });

  const { id } = req.params as { id: string };
  const { actualAmount, overrideRemarks, actualBreakdown } = req.body;

  if (actualAmount === undefined) {
    return res.status(400).json({ error: "actualAmount required" });
  }
  if (!overrideRemarks || String(overrideRemarks).trim().length < 5) {
    return res.status(400).json({ error: "overrideRemarks required (min 5 chars) — no silent modification allowed" });
  }

  const [existing] = await db
    .select()
    .from(settlementRecordsTable)
    .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Record not found" });
  if (existing.status === "finalized") {
    return res.status(409).json({ error: "Cannot override a finalized settlement. Use reopen first." });
  }
  if (existing.status === "draft") {
    return res.status(400).json({ error: "Set a recommendation before applying overrides" });
  }

  const newCount = (existing.overrideCount ?? 0) + 1;

  const [updated] = await db
    .update(settlementRecordsTable)
    .set({
      actualAmount: String(actualAmount),
      actualBreakdown: actualBreakdown ?? existing.actualBreakdown,
      isOverridden: true,
      overrideRemarks: overrideRemarks,
      overrideCount: newCount,
      lastOverriddenAt: new Date(),
      lastOverriddenBy: user.id,
      lastOverriddenByName: user.displayName ?? null,
      lastOverriddenByRole: user.role,
      status: "overridden",
      updatedAt: new Date(),
    })
    .where(eq(settlementRecordsTable.id, id))
    .returning();

  await writeEvent({
    settlementRecordId: id,
    projectId: existing.projectId,
    partnerId: existing.partnerId,
    eventType: "overridden",
    previousAmount: existing.actualAmount,
    newAmount: String(actualAmount),
    previousStatus: existing.status,
    newStatus: "overridden",
    performedBy: user.id,
    performedByName: user.displayName ?? null,
    performedByRole: user.role,
    remarks: overrideRemarks,
    metadata: {
      recommendedAmount: existing.recommendedAmount,
      overrideNumber: newCount,
      breakdown: actualBreakdown,
    },
  });

  return res.json({ record: updated });
});

// ── POST /settlement/:id/finalize — Project Developer / admin finalizes ───

router.post(
  "/:id/finalize",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };
    const { finalizationNotes } = req.body;

    const [existing] = await db
      .select()
      .from(settlementRecordsTable)
      .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "finalized") {
      return res.status(409).json({ error: "Record is already finalized" });
    }
    if (existing.status === "draft") {
      return res.status(400).json({ error: "Cannot finalize a draft record — set a recommendation first" });
    }

    const now = new Date();
    const [updated] = await db
      .update(settlementRecordsTable)
      .set({
        status: "finalized",
        finalizedAt: now,
        finalizedBy: user.id,
        finalizedByName: user.displayName ?? null,
        finalizedByRole: user.role,
        finalizationNotes: finalizationNotes ?? null,
        updatedAt: now,
      })
      .where(eq(settlementRecordsTable.id, id))
      .returning();

    await writeEvent({
      settlementRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "finalized",
      previousAmount: existing.actualAmount,
      newAmount: updated.actualAmount,
      previousStatus: existing.status,
      newStatus: "finalized",
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: finalizationNotes ?? "Settlement finalized",
      metadata: {
        recommendedAmount: existing.recommendedAmount,
        finalAmount: updated.actualAmount,
        wasOverridden: existing.isOverridden,
        overrideCount: existing.overrideCount,
      },
    });

    return res.json({ record: updated });
  }
);

// ── POST /settlement/:id/dispute — mark disputed ──────────────────────────

router.post(
  "/:id/dispute",
  requireRole("admin", "developer"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };
    const { remarks } = req.body;

    if (!remarks || String(remarks).trim().length < 5) {
      return res.status(400).json({ error: "remarks required (min 5 chars)" });
    }

    const [existing] = await db
      .select()
      .from(settlementRecordsTable)
      .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "finalized") {
      return res.status(409).json({ error: "Cannot dispute a finalized record. Use reopen first." });
    }

    const [updated] = await db
      .update(settlementRecordsTable)
      .set({ status: "disputed", updatedAt: new Date() })
      .where(eq(settlementRecordsTable.id, id))
      .returning();

    await writeEvent({
      settlementRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "disputed",
      previousStatus: existing.status,
      newStatus: "disputed",
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks,
    });

    return res.json({ record: updated });
  }
);

// ── POST /settlement/:id/reopen — admin only, reopen finalized ───────────

router.post(
  "/:id/reopen",
  requireRole("admin"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };
    const { remarks } = req.body;

    if (!remarks || String(remarks).trim().length < 5) {
      return res.status(400).json({ error: "remarks required (min 5 chars) — reopen must be justified" });
    }

    const [existing] = await db
      .select()
      .from(settlementRecordsTable)
      .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status !== "finalized") {
      return res.status(400).json({ error: "Only finalized records can be reopened" });
    }

    const [updated] = await db
      .update(settlementRecordsTable)
      .set({ status: "overridden", updatedAt: new Date() })
      .where(eq(settlementRecordsTable.id, id))
      .returning();

    await writeEvent({
      settlementRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "reopened",
      previousStatus: "finalized",
      newStatus: "overridden",
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks,
    });

    return res.json({ record: updated });
  }
);

// ── GET /settlement/:id/audit — immutable audit trail ────────────────────

router.get("/:id/audit", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params as { id: string };

  const [record] = await db
    .select({ id: settlementRecordsTable.id, projectId: settlementRecordsTable.projectId })
    .from(settlementRecordsTable)
    .where(eq(settlementRecordsTable.id, id))
    .limit(1);

  if (!record) return res.status(404).json({ error: "Record not found" });
  if (!enforceProjectAccess(req, res, record.projectId, "settlement_records_audit")) return;

  const events = await db
    .select()
    .from(settlementOverrideEventsTable)
    .where(eq(settlementOverrideEventsTable.settlementRecordId, id))
    .orderBy(desc(settlementOverrideEventsTable.performedAt));

  logSettlementAccess(req, "settlement_records", "audit", id, record.projectId ?? undefined);
  return res.json({ settlementRecordId: id, events, total: events.length });
});

// ── GET /settlement/:id/comparison — recommended vs actual ───────────────

router.get("/:id/comparison", requireSettlementAccess, async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params as { id: string };

  const [record] = await db
    .select()
    .from(settlementRecordsTable)
    .where(eq(settlementRecordsTable.id, id))
    .limit(1);

  if (!record) return res.status(404).json({ error: "Record not found" });
  if (!enforceProjectAccess(req, res, record.projectId, "settlement_records_comparison")) return;

  const events = await db
    .select()
    .from(settlementOverrideEventsTable)
    .where(eq(settlementOverrideEventsTable.settlementRecordId, id))
    .orderBy(desc(settlementOverrideEventsTable.performedAt));

  logSettlementAccess(req, "settlement_records", "comparison", id, record.projectId ?? undefined);
  const recommendedAmt = parseFloat(record.recommendedAmount ?? "0");
  const actualAmt = parseFloat(record.actualAmount ?? "0");
  const diff = actualAmt - recommendedAmt;
  const diffPct = recommendedAmt !== 0 ? (diff / recommendedAmt) * 100 : 0;

  return res.json({
    settlementRecordId: id,
    periodLabel: record.periodLabel,
    status: record.status,
    isOverridden: record.isOverridden,
    overrideCount: record.overrideCount,
    recommended: {
      amount: record.recommendedAmount,
      breakdown: record.recommendedBreakdown,
      setAt: record.recommendedAt,
      setBy: record.recommendedByName,
    },
    actual: {
      amount: record.actualAmount,
      breakdown: record.actualBreakdown,
      lastOverriddenAt: record.lastOverriddenAt,
      lastOverriddenBy: record.lastOverriddenByName,
      lastOverriddenByRole: record.lastOverriddenByRole,
      overrideRemarks: record.overrideRemarks,
    },
    delta: {
      amount: diff.toFixed(2),
      percentChange: diffPct.toFixed(2),
      direction: diff > 0 ? "increase" : diff < 0 ? "decrease" : "unchanged",
    },
    finalization: record.status === "finalized"
      ? {
          finalizedAt: record.finalizedAt,
          finalizedBy: record.finalizedByName,
          finalizedByRole: record.finalizedByRole,
          notes: record.finalizationNotes,
        }
      : null,
    overrideTimeline: events
      .filter((e: typeof events[0]) => e.eventType === "overridden")
      .map((e: typeof events[0]) => ({
        overrideNumber: null,
        previousAmount: e.previousAmount,
        newAmount: e.newAmount,
        performedBy: e.performedByName,
        performedByRole: e.performedByRole,
        remarks: e.remarks,
        performedAt: e.performedAt,
      })),
  });
});

// ── DELETE /settlement/:id — soft-archive (admin only) ───────────────────

router.delete(
  "/:id",
  requireRole("admin"),
  async (req, res) => {
    const auth = getAuth(req);
    if (!auth.userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await resolveUser(auth.userId);
    if (!user) return res.status(403).json({ error: "User not registered" });

    const { id } = req.params as { id: string };

    const [existing] = await db
      .select()
      .from(settlementRecordsTable)
      .where(and(eq(settlementRecordsTable.id, id), eq(settlementRecordsTable.isActive, true)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record not found" });
    if (existing.status === "finalized") {
      return res.status(409).json({ error: "Cannot archive a finalized record" });
    }

    await db
      .update(settlementRecordsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(settlementRecordsTable.id, id));

    await writeEvent({
      settlementRecordId: id,
      projectId: existing.projectId,
      partnerId: existing.partnerId,
      eventType: "archived",
      previousStatus: existing.status,
      newStatus: "archived",
      performedBy: user.id,
      performedByName: user.displayName ?? null,
      performedByRole: user.role,
      remarks: "Record soft-archived",
    });

    return res.json({ success: true });
  }
);

export default router;

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  partnersTable,
  burdenRecoveryAdjustmentsTable,
  burdenRecoveryEventsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function canAccessAllProjects(role: string) {
  return role === "admin" || role === "developer";
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(
      and(
        eq(userProjectAssignmentsTable.userId, userId),
        isNull(userProjectAssignmentsTable.revokedAt),
      ),
    );
  return rows.map((r) => r.projectId);
}

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

type AdjRow = typeof burdenRecoveryAdjustmentsTable.$inferSelect & {
  projectName?: string | null;
  sourcePartnerName?: string | null;
  targetPartnerName?: string | null;
};

function formatAdj(row: AdjRow) {
  const remaining = Math.max(0, row.recoverableAmount - row.recoveredAmount);
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    sourcePartnerId: row.sourcePartnerId,
    sourcePartnerName: row.sourcePartnerName ?? undefined,
    targetPartnerId: row.targetPartnerId,
    targetPartnerName: row.targetPartnerName ?? undefined,
    description: row.description,
    costCategory: row.costCategory ?? undefined,
    totalAmount: row.totalAmount,
    recoverableAmount: row.recoverableAmount,
    recoveredAmount: row.recoveredAmount,
    remainingAmount: remaining,
    revenueModelType: row.revenueModelType,
    periodLabel: row.periodLabel,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    recoveryStatus: row.recoveryStatus,
    linkedLedgerEntryId: row.linkedLedgerEntryId ?? undefined,
    isOwnershipCreating: row.isOwnershipCreating,
    notes: row.notes ?? undefined,
    recordedByName: row.recordedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── GET /burden-recovery/summary ─────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId, sourcePartnerId, targetPartnerId } = req.query as Record<string, string>;

  let allowedProjects: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    allowedProjects = await getAssignedProjectIds(actor.id);
    if (allowedProjects.length === 0) {
      return res.json({
        totalRecoverable: 0,
        totalRecovered: 0,
        totalRemaining: 0,
        pendingCount: 0,
        partialCount: 0,
        recoveredCount: 0,
        waivedCount: 0,
        adjustments: [],
      });
    }
  }

  // Fetch adjustments with names
  const rows = await db
    .select({
      adj: burdenRecoveryAdjustmentsTable,
      projectName: projectsTable.name,
      sourcePartnerName: sql<string>`sp.name`.as("source_partner_name"),
      targetPartnerName: sql<string>`tp.name`.as("target_partner_name"),
    })
    .from(burdenRecoveryAdjustmentsTable)
    .innerJoin(projectsTable, eq(burdenRecoveryAdjustmentsTable.projectId, projectsTable.id))
    .innerJoin(
      sql`partners sp`,
      sql`sp.id = ${burdenRecoveryAdjustmentsTable.sourcePartnerId}`,
    )
    .innerJoin(
      sql`partners tp`,
      sql`tp.id = ${burdenRecoveryAdjustmentsTable.targetPartnerId}`,
    )
    .where(
      and(
        projectId ? eq(burdenRecoveryAdjustmentsTable.projectId, projectId) : undefined,
        sourcePartnerId ? eq(burdenRecoveryAdjustmentsTable.sourcePartnerId, sourcePartnerId) : undefined,
        targetPartnerId ? eq(burdenRecoveryAdjustmentsTable.targetPartnerId, targetPartnerId) : undefined,
        allowedProjects ? inArray(burdenRecoveryAdjustmentsTable.projectId, allowedProjects) : undefined,
      ),
    )
    .orderBy(desc(burdenRecoveryAdjustmentsTable.createdAt));

  const adjustments = rows.map((r) =>
    formatAdj({
      ...r.adj,
      projectName: r.projectName,
      sourcePartnerName: String(r.sourcePartnerName ?? ""),
      targetPartnerName: String(r.targetPartnerName ?? ""),
    }),
  );

  const totalRecoverable = adjustments.reduce((s, a) => s + a.recoverableAmount, 0);
  const totalRecovered = adjustments.reduce((s, a) => s + a.recoveredAmount, 0);
  const totalRemaining = adjustments.reduce((s, a) => s + a.remainingAmount, 0);

  return res.json({
    totalRecoverable,
    totalRecovered,
    totalRemaining,
    pendingCount: adjustments.filter((a) => a.recoveryStatus === "pending").length,
    partialCount: adjustments.filter((a) => a.recoveryStatus === "partial").length,
    recoveredCount: adjustments.filter((a) => a.recoveryStatus === "recovered").length,
    waivedCount: adjustments.filter((a) => a.recoveryStatus === "waived").length,
    adjustments,
  });
});

// ── GET /burden-recovery/adjustments ─────────────────────────────────────────

router.get("/adjustments", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId, recoveryStatus, sourcePartnerId, targetPartnerId } = req.query as Record<string, string>;

  let allowedProjects: string[] | null = null;
  if (!canAccessAllProjects(actor.role)) {
    allowedProjects = await getAssignedProjectIds(actor.id);
    if (allowedProjects.length === 0) return res.json([]);
  }

  const rows = await db
    .select({
      adj: burdenRecoveryAdjustmentsTable,
      projectName: projectsTable.name,
      sourcePartnerName: sql<string>`sp.name`.as("source_partner_name"),
      targetPartnerName: sql<string>`tp.name`.as("target_partner_name"),
    })
    .from(burdenRecoveryAdjustmentsTable)
    .innerJoin(projectsTable, eq(burdenRecoveryAdjustmentsTable.projectId, projectsTable.id))
    .innerJoin(
      sql`partners sp`,
      sql`sp.id = ${burdenRecoveryAdjustmentsTable.sourcePartnerId}`,
    )
    .innerJoin(
      sql`partners tp`,
      sql`tp.id = ${burdenRecoveryAdjustmentsTable.targetPartnerId}`,
    )
    .where(
      and(
        projectId ? eq(burdenRecoveryAdjustmentsTable.projectId, projectId) : undefined,
        recoveryStatus ? eq(burdenRecoveryAdjustmentsTable.recoveryStatus, recoveryStatus) : undefined,
        sourcePartnerId ? eq(burdenRecoveryAdjustmentsTable.sourcePartnerId, sourcePartnerId) : undefined,
        targetPartnerId ? eq(burdenRecoveryAdjustmentsTable.targetPartnerId, targetPartnerId) : undefined,
        allowedProjects ? inArray(burdenRecoveryAdjustmentsTable.projectId, allowedProjects) : undefined,
      ),
    )
    .orderBy(desc(burdenRecoveryAdjustmentsTable.createdAt));

  return res.json(
    rows.map((r) =>
      formatAdj({
        ...r.adj,
        projectName: r.projectName,
        sourcePartnerName: String(r.sourcePartnerName ?? ""),
        targetPartnerName: String(r.targetPartnerName ?? ""),
      }),
    ),
  );
});

// ── POST /burden-recovery/adjustments ────────────────────────────────────────

router.post("/adjustments", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const {
    projectId, sourcePartnerId, targetPartnerId, description,
    costCategory, totalAmount, recoverableAmount,
    periodLabel, periodStart, periodEnd,
    linkedLedgerEntryId, notes,
  } = req.body as {
    projectId: string;
    sourcePartnerId: string;
    targetPartnerId: string;
    description: string;
    costCategory?: string;
    totalAmount: number;
    recoverableAmount: number;
    periodLabel: string;
    periodStart: string;
    periodEnd: string;
    linkedLedgerEntryId?: string;
    notes?: string;
  };

  if (!projectId || !sourcePartnerId || !targetPartnerId || !description) {
    return res.status(400).json({ error: "projectId, sourcePartnerId, targetPartnerId, description are required" });
  }
  if (!totalAmount || totalAmount <= 0) {
    return res.status(400).json({ error: "totalAmount must be positive" });
  }
  if (!recoverableAmount || recoverableAmount <= 0) {
    return res.status(400).json({ error: "recoverableAmount must be positive" });
  }
  if (recoverableAmount > totalAmount) {
    return res.status(400).json({ error: "recoverableAmount cannot exceed totalAmount" });
  }

  const [adj] = await db
    .insert(burdenRecoveryAdjustmentsTable)
    .values({
      projectId,
      sourcePartnerId,
      targetPartnerId,
      description,
      costCategory: costCategory ?? null,
      totalAmount,
      recoverableAmount,
      recoveredAmount: 0,
      recoveryStatus: "pending",
      periodLabel,
      periodStart,
      periodEnd,
      linkedLedgerEntryId: linkedLedgerEntryId ?? null,
      isOwnershipCreating: false, // INVARIANT: always false
      notes: notes ?? null,
      recordedById: actor.id,
      recordedByName: actor.displayName ?? actor.clerkUserId,
    })
    .returning();

  // Fetch with names for response
  const [enriched] = await db
    .select({
      adj: burdenRecoveryAdjustmentsTable,
      projectName: projectsTable.name,
      sourcePartnerName: sql<string>`sp.name`.as("source_partner_name"),
      targetPartnerName: sql<string>`tp.name`.as("target_partner_name"),
    })
    .from(burdenRecoveryAdjustmentsTable)
    .innerJoin(projectsTable, eq(burdenRecoveryAdjustmentsTable.projectId, projectsTable.id))
    .innerJoin(sql`partners sp`, sql`sp.id = ${burdenRecoveryAdjustmentsTable.sourcePartnerId}`)
    .innerJoin(sql`partners tp`, sql`tp.id = ${burdenRecoveryAdjustmentsTable.targetPartnerId}`)
    .where(eq(burdenRecoveryAdjustmentsTable.id, adj.id));

  return res.status(201).json(
    formatAdj({
      ...enriched.adj,
      projectName: enriched.projectName,
      sourcePartnerName: String(enriched.sourcePartnerName ?? ""),
      targetPartnerName: String(enriched.targetPartnerName ?? ""),
    }),
  );
});

// ── PATCH /burden-recovery/adjustments/:id ───────────────────────────────────

router.patch("/adjustments/:id", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const id = req.params.id as string;
  const [existing] = await db
    .select()
    .from(burdenRecoveryAdjustmentsTable)
    .where(eq(burdenRecoveryAdjustmentsTable.id, id))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Adjustment not found" });

  const {
    description, costCategory, totalAmount, recoverableAmount,
    periodLabel, periodStart, periodEnd,
    recoveryStatus, linkedLedgerEntryId, notes,
  } = req.body as Partial<{
    description: string;
    costCategory: string;
    totalAmount: number;
    recoverableAmount: number;
    periodLabel: string;
    periodStart: string;
    periodEnd: string;
    recoveryStatus: string;
    linkedLedgerEntryId: string;
    notes: string;
  }>;

  // Admin-only: manual recoveryStatus override (waive, reopen)
  if (recoveryStatus !== undefined && actor.role !== "admin") {
    return res.status(403).json({ error: "Only admin can manually set recovery status" });
  }

  const [updated] = await db
    .update(burdenRecoveryAdjustmentsTable)
    .set({
      ...(description !== undefined ? { description } : {}),
      ...(costCategory !== undefined ? { costCategory } : {}),
      ...(totalAmount !== undefined ? { totalAmount } : {}),
      ...(recoverableAmount !== undefined ? { recoverableAmount } : {}),
      ...(periodLabel !== undefined ? { periodLabel } : {}),
      ...(periodStart !== undefined ? { periodStart } : {}),
      ...(periodEnd !== undefined ? { periodEnd } : {}),
      ...(recoveryStatus !== undefined ? { recoveryStatus } : {}),
      ...(linkedLedgerEntryId !== undefined ? { linkedLedgerEntryId } : {}),
      ...(notes !== undefined ? { notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(burdenRecoveryAdjustmentsTable.id, id as string))
    .returning();

  const [enriched] = await db
    .select({
      adj: burdenRecoveryAdjustmentsTable,
      projectName: projectsTable.name,
      sourcePartnerName: sql<string>`sp.name`.as("source_partner_name"),
      targetPartnerName: sql<string>`tp.name`.as("target_partner_name"),
    })
    .from(burdenRecoveryAdjustmentsTable)
    .innerJoin(projectsTable, eq(burdenRecoveryAdjustmentsTable.projectId, projectsTable.id))
    .innerJoin(sql`partners sp`, sql`sp.id = ${burdenRecoveryAdjustmentsTable.sourcePartnerId}`)
    .innerJoin(sql`partners tp`, sql`tp.id = ${burdenRecoveryAdjustmentsTable.targetPartnerId}`)
    .where(eq(burdenRecoveryAdjustmentsTable.id, updated.id));

  return res.json(
    formatAdj({
      ...enriched.adj,
      projectName: enriched.projectName,
      sourcePartnerName: String(enriched.sourcePartnerName ?? ""),
      targetPartnerName: String(enriched.targetPartnerName ?? ""),
    }),
  );
});

// ── GET /burden-recovery/adjustments/:id/events ───────────────────────────────

router.get("/adjustments/:id/events", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const id = req.params.id as string;

  const events = await db
    .select()
    .from(burdenRecoveryEventsTable)
    .where(eq(burdenRecoveryEventsTable.adjustmentId, id))
    .orderBy(desc(burdenRecoveryEventsTable.createdAt));

  return res.json(
    events.map((e) => ({
      id: e.id,
      adjustmentId: e.adjustmentId,
      projectId: e.projectId,
      amountRecovered: e.amountRecovered,
      recoveryDate: e.recoveryDate,
      recoveryRef: e.recoveryRef ?? undefined,
      notes: e.notes ?? undefined,
      recordedByName: e.recordedByName,
      createdAt: e.createdAt.toISOString(),
    })),
  );
});

// ── POST /burden-recovery/adjustments/:id/events ──────────────────────────────

router.post("/adjustments/:id/events", requireRole("admin", "developer"), async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const id = req.params.id as string;
  const [adj] = await db
    .select()
    .from(burdenRecoveryAdjustmentsTable)
    .where(eq(burdenRecoveryAdjustmentsTable.id, id))
    .limit(1);

  if (!adj) return res.status(404).json({ error: "Adjustment not found" });
  if (adj.recoveryStatus === "recovered" || adj.recoveryStatus === "waived") {
    return res.status(400).json({ error: "Adjustment is already fully resolved" });
  }

  const { amountRecovered, recoveryDate, recoveryRef, notes } = req.body as {
    amountRecovered: number;
    recoveryDate: string;
    recoveryRef?: string;
    notes?: string;
  };

  if (!amountRecovered || amountRecovered <= 0) {
    return res.status(400).json({ error: "amountRecovered must be positive" });
  }

  const remaining = adj.recoverableAmount - adj.recoveredAmount;
  if (amountRecovered > remaining + 0.01) {
    return res.status(400).json({
      error: `Cannot recover ${amountRecovered} — only ${remaining.toFixed(2)} remaining`,
    });
  }

  // Insert event
  const [event] = await db
    .insert(burdenRecoveryEventsTable)
    .values({
      adjustmentId: id,
      projectId: adj.projectId,
      amountRecovered,
      recoveryDate,
      recoveryRef: recoveryRef ?? null,
      notes: notes ?? null,
      recordedById: actor.id,
      recordedByName: actor.displayName ?? actor.clerkUserId,
    })
    .returning();

  // Atomically update the adjustment
  const newRecovered = adj.recoveredAmount + amountRecovered;
  const newStatus =
    newRecovered >= adj.recoverableAmount - 0.01
      ? "recovered"
      : "partial";

  await db
    .update(burdenRecoveryAdjustmentsTable)
    .set({
      recoveredAmount: newRecovered,
      recoveryStatus: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(burdenRecoveryAdjustmentsTable.id, id as string));

  return res.status(201).json({
    id: event.id,
    adjustmentId: event.adjustmentId,
    projectId: event.projectId,
    amountRecovered: event.amountRecovered,
    recoveryDate: event.recoveryDate,
    recoveryRef: event.recoveryRef ?? undefined,
    notes: event.notes ?? undefined,
    recordedByName: event.recordedByName,
    createdAt: event.createdAt.toISOString(),
  });
});

export default router;

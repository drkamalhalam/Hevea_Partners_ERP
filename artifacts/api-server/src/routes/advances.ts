import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  recoverableAdvancesTable,
  advanceRecoveryEventsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── Shared helpers ──────────────────────────────────────────────────────────

function canAccessAllProjects(role: string): boolean {
  return role === "admin" || role === "developer";
}

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map((r) => r.projectId);
}

async function resolveActingUser(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return user ?? null;
}

function computeRemainingAmount(
  originalAmount: string | number,
  recoveredAmount: string | number,
): number {
  return Math.max(0, Number(originalAmount) - Number(recoveredAmount));
}

function isOverdue(advance: { dueDate: string | null; status: string }): boolean {
  if (!advance.dueDate) return false;
  if (advance.status === "recovered" || advance.status === "written_off") return false;
  return new Date(advance.dueDate) < new Date();
}

function formatAdvance(
  row: typeof recoverableAdvancesTable.$inferSelect & { projectName?: string | null },
) {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    advancedByPartnerId: row.advancedByPartnerId ?? undefined,
    advancedByName: row.advancedByName,
    advancedByRole: row.advancedByRole,
    responsiblePartyRole: row.responsiblePartyRole,
    responsiblePartnerId: row.responsiblePartnerId ?? undefined,
    responsiblePartnerName: row.responsiblePartnerName ?? undefined,
    linkedBurdenRecordId: row.linkedBurdenRecordId ?? undefined,
    linkedExpenditureId: row.linkedExpenditureId ?? undefined,
    originalAmount: Number(row.originalAmount),
    recoveredAmount: Number(row.recoveredAmount),
    remainingAmount: computeRemainingAmount(row.originalAmount, row.recoveredAmount),
    description: row.description,
    advancedDate: row.advancedDate,
    dueDate: row.dueDate ?? undefined,
    recoveryMethod: row.recoveryMethod ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    recoveryNotes: row.recoveryNotes ?? undefined,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? undefined,
    acknowledgedByName: row.acknowledgedByName ?? undefined,
    closedAt: row.closedAt?.toISOString() ?? undefined,
    closedByName: row.closedByName ?? undefined,
    isOverdue: isOverdue({ dueDate: row.dueDate, status: row.status }),
    createdByName: row.createdByName ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatEvent(row: typeof advanceRecoveryEventsTable.$inferSelect) {
  return {
    id: row.id,
    advanceId: row.advanceId,
    eventType: row.eventType,
    amount: row.amount !== null ? Number(row.amount) : undefined,
    description: row.description,
    eventDate: row.eventDate,
    recordedByName: row.recordedByName ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── GET /advances/summary ───────────────────────────────────────────────────

router.get("/advances/summary", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveActingUser(clerkUserId);
  if (!user) return res.status(401).json({ error: "User not found" });

  const projectIdFilter = req.query.projectId as string | undefined;

  // Determine accessible project IDs
  let accessibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(user.role)) {
    accessibleProjectIds = await getAssignedProjectIds(user.id);
    if (accessibleProjectIds.length === 0) {
      return res.json({
        totalOutstanding: 0,
        totalOverdue: 0,
        totalRecovered: 0,
        totalWrittenOff: 0,
        advanceCount: 0,
        pendingCount: 0,
        inRecoveryCount: 0,
        byProject: [],
        byPartyRole: [],
      });
    }
  }

  // Build where conditions
  const conditions = [eq(recoverableAdvancesTable.isActive, true)];
  if (projectIdFilter) {
    conditions.push(eq(recoverableAdvancesTable.projectId, projectIdFilter));
  } else if (accessibleProjectIds) {
    conditions.push(inArray(recoverableAdvancesTable.projectId, accessibleProjectIds));
  }

  const rows = await db
    .select({
      id: recoverableAdvancesTable.id,
      projectId: recoverableAdvancesTable.projectId,
      projectName: projectsTable.name,
      responsiblePartyRole: recoverableAdvancesTable.responsiblePartyRole,
      originalAmount: recoverableAdvancesTable.originalAmount,
      recoveredAmount: recoverableAdvancesTable.recoveredAmount,
      dueDate: recoverableAdvancesTable.dueDate,
      status: recoverableAdvancesTable.status,
    })
    .from(recoverableAdvancesTable)
    .leftJoin(projectsTable, eq(recoverableAdvancesTable.projectId, projectsTable.id))
    .where(and(...conditions));

  const today = new Date();

  let totalOutstanding = 0;
  let totalOverdue = 0;
  let totalRecovered = 0;
  let totalWrittenOff = 0;
  let pendingCount = 0;
  let inRecoveryCount = 0;

  const byProjectMap = new Map<
    string,
    { projectId: string; projectName: string; outstanding: number; overdue: number; count: number }
  >();
  const byRoleMap = new Map<string, { outstanding: number; count: number }>();

  for (const row of rows) {
    const remaining = Math.max(0, Number(row.originalAmount) - Number(row.recoveredAmount));
    const isRowOverdue =
      row.dueDate &&
      new Date(row.dueDate) < today &&
      row.status !== "recovered" &&
      row.status !== "written_off";

    if (row.status === "recovered") {
      totalRecovered += Number(row.originalAmount);
    } else if (row.status === "written_off") {
      totalWrittenOff += Number(row.originalAmount);
    } else {
      totalOutstanding += remaining;
      if (isRowOverdue) totalOverdue += remaining;
      if (row.status === "pending" || row.status === "acknowledged") pendingCount++;
      if (row.status === "in_recovery") inRecoveryCount++;

      // By project
      const projKey = row.projectId;
      const existing = byProjectMap.get(projKey) ?? {
        projectId: row.projectId,
        projectName: row.projectName ?? row.projectId,
        outstanding: 0,
        overdue: 0,
        count: 0,
      };
      existing.outstanding += remaining;
      if (isRowOverdue) existing.overdue += remaining;
      existing.count++;
      byProjectMap.set(projKey, existing);

      // By party role
      const roleKey = row.responsiblePartyRole;
      const roleExisting = byRoleMap.get(roleKey) ?? { outstanding: 0, count: 0 };
      roleExisting.outstanding += remaining;
      roleExisting.count++;
      byRoleMap.set(roleKey, roleExisting);
    }
  }

  return res.json({
    totalOutstanding,
    totalOverdue,
    totalRecovered,
    totalWrittenOff,
    advanceCount: rows.length,
    pendingCount,
    inRecoveryCount,
    byProject: Array.from(byProjectMap.values()),
    byPartyRole: Array.from(byRoleMap.entries()).map(([role, v]) => ({ role, ...v })),
  });
});

// ── GET /advances ───────────────────────────────────────────────────────────

router.get("/advances", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveActingUser(clerkUserId);
  if (!user) return res.status(401).json({ error: "User not found" });

  const projectIdFilter = req.query.projectId as string | undefined;
  const statusFilter = req.query.status as string | undefined;
  const responsiblePartyRoleFilter = req.query.responsiblePartyRole as string | undefined;
  const advancedByPartnerIdFilter = req.query.advancedByPartnerId as string | undefined;

  let accessibleProjectIds: string[] | null = null;
  if (!canAccessAllProjects(user.role)) {
    accessibleProjectIds = await getAssignedProjectIds(user.id);
    if (accessibleProjectIds.length === 0) return res.json([]);
  }

  const conditions = [eq(recoverableAdvancesTable.isActive, true)];
  if (projectIdFilter) {
    conditions.push(eq(recoverableAdvancesTable.projectId, projectIdFilter));
  } else if (accessibleProjectIds) {
    conditions.push(inArray(recoverableAdvancesTable.projectId, accessibleProjectIds));
  }
  if (statusFilter) {
    conditions.push(eq(recoverableAdvancesTable.status, statusFilter as never));
  }
  if (responsiblePartyRoleFilter) {
    conditions.push(
      eq(recoverableAdvancesTable.responsiblePartyRole, responsiblePartyRoleFilter),
    );
  }
  if (advancedByPartnerIdFilter) {
    conditions.push(
      eq(recoverableAdvancesTable.advancedByPartnerId, advancedByPartnerIdFilter),
    );
  }

  const rows = await db
    .select({
      advance: recoverableAdvancesTable,
      projectName: projectsTable.name,
    })
    .from(recoverableAdvancesTable)
    .leftJoin(projectsTable, eq(recoverableAdvancesTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(desc(recoverableAdvancesTable.createdAt));

  return res.json(rows.map((r) => formatAdvance({ ...r.advance, projectName: r.projectName })));
});

// ── POST /advances ──────────────────────────────────────────────────────────

router.post(
  "/advances",
  requireRole("admin", "developer", "landowner"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const user = await resolveActingUser(clerkUserId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const data = req.body as {
      projectId?: string;
      advancedByPartnerId?: string;
      advancedByName?: string;
      advancedByRole?: string;
      responsiblePartyRole?: string;
      responsiblePartnerId?: string;
      responsiblePartnerName?: string;
      linkedBurdenRecordId?: string;
      linkedExpenditureId?: string;
      originalAmount?: number;
      description?: string;
      advancedDate?: string;
      dueDate?: string;
      recoveryMethod?: string;
      notes?: string;
    };

    if (!data.projectId || !data.advancedByName || !data.description || !data.advancedDate) {
      return res.status(400).json({ error: "projectId, advancedByName, description, and advancedDate are required" });
    }
    const originalAmount = Number(data.originalAmount);
    if (!originalAmount || originalAmount <= 0) {
      return res.status(400).json({ error: "originalAmount must be a positive number" });
    }

    // Verify project access
    if (!canAccessAllProjects(user.role)) {
      const assigned = await getAssignedProjectIds(user.id);
      if (!assigned.includes(data.projectId)) {
        return res.status(403).json({ error: "Access denied to this project" });
      }
    }

    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, data.projectId))
      .limit(1);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const [advance] = await db
      .insert(recoverableAdvancesTable)
      .values({
        projectId: data.projectId,
        advancedByPartnerId: data.advancedByPartnerId,
        advancedByName: data.advancedByName,
        advancedByRole: data.advancedByRole ?? "other",
        responsiblePartyRole: data.responsiblePartyRole ?? "landowner",
        responsiblePartnerId: data.responsiblePartnerId,
        responsiblePartnerName: data.responsiblePartnerName,
        linkedBurdenRecordId: data.linkedBurdenRecordId,
        linkedExpenditureId: data.linkedExpenditureId,
        originalAmount: originalAmount.toString(),
        description: data.description,
        advancedDate: data.advancedDate,
        dueDate: data.dueDate,
        recoveryMethod: data.recoveryMethod,
        notes: data.notes,
        status: "pending",
        createdById: user.id,
        createdByName: user.displayName ?? user.email ?? "Unknown",
      })
      .returning();

    // Auto-create initial 'raised' event
    await db.insert(advanceRecoveryEventsTable).values({
      advanceId: advance.id,
      eventType: "raised",
      description: `Advance raised: ${data.description}`,
      eventDate: data.advancedDate,
      recordedById: user.id,
      recordedByName: user.displayName ?? user.email ?? "Unknown",
    });

    return res.status(201).json(formatAdvance({ ...advance, projectName: project.name }));
  },
);

// ── GET /advances/:id ───────────────────────────────────────────────────────

router.get("/advances/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

  const user = await resolveActingUser(clerkUserId);
  if (!user) return res.status(401).json({ error: "User not found" });

  const [row] = await db
    .select({
      advance: recoverableAdvancesTable,
      projectName: projectsTable.name,
    })
    .from(recoverableAdvancesTable)
    .leftJoin(projectsTable, eq(recoverableAdvancesTable.projectId, projectsTable.id))
    .where(
      and(eq(recoverableAdvancesTable.id, req.params.id), eq(recoverableAdvancesTable.isActive, true)),
    )
    .limit(1);

  if (!row) return res.status(404).json({ error: "Advance not found" });

  // Project access check
  if (!canAccessAllProjects(user.role)) {
    const assigned = await getAssignedProjectIds(user.id);
    if (!assigned.includes(row.advance.projectId)) {
      return res.status(403).json({ error: "Access denied" });
    }
  }

  const events = await db
    .select()
    .from(advanceRecoveryEventsTable)
    .where(eq(advanceRecoveryEventsTable.advanceId, row.advance.id))
    .orderBy(advanceRecoveryEventsTable.createdAt);

  return res.json({
    ...formatAdvance({ ...row.advance, projectName: row.projectName }),
    events: events.map(formatEvent),
  });
});

// ── PATCH /advances/:id ─────────────────────────────────────────────────────

router.patch(
  "/advances/:id",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const user = await resolveActingUser(clerkUserId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const advanceId = String(req.params.id);
    const body = req.body as {
      description?: string;
      notes?: string;
      dueDate?: string;
      recoveryNotes?: string;
    };

    const [existing] = await db
      .select()
      .from(recoverableAdvancesTable)
      .where(and(eq(recoverableAdvancesTable.id, advanceId), eq(recoverableAdvancesTable.isActive, true)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Advance not found" });

    const updates: Partial<typeof recoverableAdvancesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.description !== undefined) updates.description = body.description;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.dueDate !== undefined) updates.dueDate = body.dueDate;
    if (body.recoveryNotes !== undefined) updates.recoveryNotes = body.recoveryNotes;

    const [updated] = await db
      .update(recoverableAdvancesTable)
      .set(updates)
      .where(eq(recoverableAdvancesTable.id, advanceId))
      .returning();

    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);

    return res.json(formatAdvance({ ...updated, projectName: proj?.name }));
  },
);

// ── POST /advances/:id/acknowledge ──────────────────────────────────────────

router.post(
  "/advances/:id/acknowledge",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const user = await resolveActingUser(clerkUserId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const advanceId = String(req.params.id);
    const notes = (req.body?.notes as string | undefined) ?? undefined;

    const [existing] = await db
      .select()
      .from(recoverableAdvancesTable)
      .where(and(eq(recoverableAdvancesTable.id, advanceId), eq(recoverableAdvancesTable.isActive, true)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Advance not found" });

    if (existing.status === "recovered" || existing.status === "written_off") {
      return res.status(400).json({ error: "Advance is already closed" });
    }
    if (existing.status === "acknowledged" || existing.status === "in_recovery") {
      return res.status(400).json({ error: "Advance is already acknowledged" });
    }

    const now = new Date();
    const userName = user.displayName ?? user.email ?? "Unknown";

    const [updated] = await db
      .update(recoverableAdvancesTable)
      .set({
        status: "acknowledged",
        acknowledgedAt: now,
        acknowledgedById: user.id,
        acknowledgedByName: userName,
        notes: notes ?? existing.notes,
        updatedAt: now,
      })
      .where(eq(recoverableAdvancesTable.id, advanceId))
      .returning();

    await db.insert(advanceRecoveryEventsTable).values({
      advanceId: existing.id,
      eventType: "acknowledged",
      description: notes ?? "Advance acknowledged by admin/developer",
      eventDate: now.toISOString().slice(0, 10),
      recordedById: user.id,
      recordedByName: userName,
    });

    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);

    return res.json(formatAdvance({ ...updated, projectName: proj?.name }));
  },
);

// ── POST /advances/:id/recover ──────────────────────────────────────────────

router.post(
  "/advances/:id/recover",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const user = await resolveActingUser(clerkUserId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const advanceId = String(req.params.id);
    const body = req.body as { amount?: number; method?: string; notes?: string; eventDate?: string };
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const method = body.method ?? "direct_payment";
    const notes = body.notes;
    const eventDate = body.eventDate;

    const [existing] = await db
      .select()
      .from(recoverableAdvancesTable)
      .where(and(eq(recoverableAdvancesTable.id, advanceId), eq(recoverableAdvancesTable.isActive, true)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Advance not found" });

    if (existing.status === "recovered" || existing.status === "written_off") {
      return res.status(400).json({ error: "Advance is already closed" });
    }

    const currentRecovered = Number(existing.recoveredAmount);
    const original = Number(existing.originalAmount);
    const newRecovered = Math.min(currentRecovered + amount, original);
    const remaining = original - newRecovered;
    const fullyRecovered = remaining <= 0;

    const now = new Date();
    const eventDateValue = eventDate ?? now.toISOString().slice(0, 10);
    const userName = user.displayName ?? user.email ?? "Unknown";

    const eventTypeMap: Record<string, string> = {
      direct_payment: "payment",
      share_deduction: "deduction",
      settlement: "payment",
    };

    const [updated] = await db
      .update(recoverableAdvancesTable)
      .set({
        recoveredAmount: newRecovered.toString(),
        recoveryMethod: method,
        recoveryNotes: notes ?? existing.recoveryNotes,
        status: fullyRecovered ? "recovered" : "in_recovery",
        closedAt: fullyRecovered ? now : existing.closedAt,
        closedById: fullyRecovered ? user.id : existing.closedById,
        closedByName: fullyRecovered ? userName : existing.closedByName,
        updatedAt: now,
      })
      .where(eq(recoverableAdvancesTable.id, advanceId))
      .returning();

    await db.insert(advanceRecoveryEventsTable).values({
      advanceId: existing.id,
      eventType: eventTypeMap[method] ?? "payment",
      amount: amount.toString(),
      description:
        notes ??
        `Recovery of ₹${amount.toLocaleString("en-IN")} via ${method.replace(/_/g, " ")}`,
      eventDate: eventDateValue,
      recordedById: user.id,
      recordedByName: userName,
    });

    if (fullyRecovered) {
      await db.insert(advanceRecoveryEventsTable).values({
        advanceId: existing.id,
        eventType: "recovered",
        description: "Advance fully recovered",
        eventDate: eventDateValue,
        recordedById: user.id,
        recordedByName: userName,
      });
    }

    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);

    return res.json(formatAdvance({ ...updated, projectName: proj?.name }));
  },
);

// ── POST /advances/:id/write-off ────────────────────────────────────────────

router.post(
  "/advances/:id/write-off",
  requireRole("admin", "developer"),
  async (req, res) => {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });

    const user = await resolveActingUser(clerkUserId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const advanceId = String(req.params.id);
    const notes = (req.body?.notes as string | undefined) ?? undefined;

    const [existing] = await db
      .select()
      .from(recoverableAdvancesTable)
      .where(and(eq(recoverableAdvancesTable.id, advanceId), eq(recoverableAdvancesTable.isActive, true)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Advance not found" });

    if (existing.status === "recovered" || existing.status === "written_off") {
      return res.status(400).json({ error: "Advance is already closed" });
    }

    const now = new Date();
    const userName = user.displayName ?? user.email ?? "Unknown";

    const [updated] = await db
      .update(recoverableAdvancesTable)
      .set({
        status: "written_off",
        recoveryNotes: notes ?? existing.recoveryNotes,
        closedAt: now,
        closedById: user.id,
        closedByName: userName,
        updatedAt: now,
      })
      .where(eq(recoverableAdvancesTable.id, advanceId))
      .returning();

    await db.insert(advanceRecoveryEventsTable).values({
      advanceId: existing.id,
      eventType: "written_off",
      description:
        notes ??
        "Advance written off. This does not affect ownership or equity.",
      eventDate: now.toISOString().slice(0, 10),
      recordedById: user.id,
      recordedByName: userName,
    });

    const [proj] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId))
      .limit(1);

    return res.json(formatAdvance({ ...updated, projectName: proj?.name }));
  },
);

export default router;

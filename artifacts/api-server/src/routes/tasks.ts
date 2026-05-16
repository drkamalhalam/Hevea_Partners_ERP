import { Router } from "express";
import { db } from "@workspace/db";
import { operationalTasksTable, personMasterTable } from "@workspace/db/schema";
import { eq, and, desc, or } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const MANAGER_ROLES = ["admin", "developer"] as const;
const WORKER_ROLES = ["employee", "operational_staff"] as const;
const ALL_TASK_ROLES = [...MANAGER_ROLES, ...WORKER_ROLES] as const;

function isManager(role: string) {
  return (MANAGER_ROLES as readonly string[]).includes(role);
}
function isWorker(role: string) {
  return (WORKER_ROLES as readonly string[]).includes(role);
}

/**
 * Look up the person_master.id for a user account.
 * Returns null if no linkage exists.
 */
async function getPersonMasterIdForUser(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: personMasterTable.id })
    .from(personMasterTable)
    .where(eq(personMasterTable.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

// ── GET /tasks ─────────────────────────────────────────────────────────────
// Admin/developer: all active tasks (filter by assignedToPersonId, assignedToId, projectId, status)
// Employee/staff: only tasks assigned to their person_master identity (or legacy user account)
router.get("/", async (req, res) => {
  const { dbUserId, dbUser, userRole } = req;
  if (!dbUser) return res.status(401).json({ error: "Unauthorized" });

  if (!(ALL_TASK_ROLES as readonly string[]).includes(userRole!)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { status, projectId, assignedToId, assignedToPersonId, taskType } =
    req.query as Record<string, string | undefined>;

  let rows;

  if (isManager(userRole!)) {
    const conditions = [eq(operationalTasksTable.isActive, true)];
    if (status) conditions.push(eq(operationalTasksTable.status, status as any));
    if (projectId) conditions.push(eq(operationalTasksTable.projectId, projectId));
    if (assignedToPersonId)
      conditions.push(eq(operationalTasksTable.assignedToPersonId, assignedToPersonId));
    else if (assignedToId)
      conditions.push(eq(operationalTasksTable.assignedToId, assignedToId));
    if (taskType) conditions.push(eq(operationalTasksTable.taskType, taskType as any));

    rows = await db
      .select()
      .from(operationalTasksTable)
      .where(and(...conditions))
      .orderBy(desc(operationalTasksTable.createdAt));
  } else {
    // Workers see tasks assigned to their PERSON_MASTER identity OR their legacy user account
    const personMasterId = dbUserId ? await getPersonMasterIdForUser(dbUserId) : null;

    const assignmentFilter = personMasterId
      ? or(
          eq(operationalTasksTable.assignedToPersonId, personMasterId),
          eq(operationalTasksTable.assignedToId, dbUser.id)
        )
      : eq(operationalTasksTable.assignedToId, dbUser.id);

    const conditions = [eq(operationalTasksTable.isActive, true), assignmentFilter!];
    if (status) conditions.push(eq(operationalTasksTable.status, status as any));
    if (taskType) conditions.push(eq(operationalTasksTable.taskType, taskType as any));

    rows = await db
      .select()
      .from(operationalTasksTable)
      .where(and(...conditions))
      .orderBy(desc(operationalTasksTable.createdAt));
  }

  return res.json(rows);
});

// ── GET /tasks/summary ─────────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  const { dbUserId, dbUser, userRole } = req;
  if (!dbUser) return res.status(401).json({ error: "Unauthorized" });

  if (!(ALL_TASK_ROLES as readonly string[]).includes(userRole!)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let rows;

  if (isManager(userRole!)) {
    rows = await db
      .select()
      .from(operationalTasksTable)
      .where(eq(operationalTasksTable.isActive, true));
  } else {
    const personMasterId = dbUserId ? await getPersonMasterIdForUser(dbUserId) : null;

    const assignmentFilter = personMasterId
      ? or(
          eq(operationalTasksTable.assignedToPersonId, personMasterId),
          eq(operationalTasksTable.assignedToId, dbUser.id)
        )
      : eq(operationalTasksTable.assignedToId, dbUser.id);

    rows = await db
      .select()
      .from(operationalTasksTable)
      .where(and(eq(operationalTasksTable.isActive, true), assignmentFilter!));
  }

  const pending = rows.filter((r) => r.status === "pending").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const completed = rows.filter((r) => r.status === "completed").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const urgent = rows.filter(
    (r) => r.priority === "urgent" && (r.status === "pending" || r.status === "in_progress")
  ).length;
  const overdue = rows.filter((r) => {
    if (!r.dueDate) return false;
    if (r.status === "completed" || r.status === "cancelled") return false;
    return new Date(r.dueDate) < new Date();
  }).length;

  return res.json({ pending, inProgress, completed, cancelled, urgent, overdue, total: rows.length });
});

// ── POST /tasks ─────────────────────────────────────────────────────────────
// Admin/developer only. Assigns to a person_master identity; auto-bridges linked user account.
router.post("/", async (req, res) => {
  const { dbUser, userRole } = req;
  if (!dbUser || !isManager(userRole!)) return res.status(403).json({ error: "Forbidden" });

  const schema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    taskType: z
      .enum(["production_entry", "stock_update", "inspection", "general"])
      .default("general"),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    projectId: z.string().uuid().optional(),
    projectName: z.string().optional(),
    // Identity-centric — preferred
    assignedToPersonId: z.string().uuid().optional(),
    assignedToPersonName: z.string().optional(),
    // Legacy — kept for backward compat and auto-bridging
    assignedToId: z.string().uuid().optional(),
    assignedToName: z.string().optional(),
    assignedToRole: z.string().optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
    linkedEntityType: z.string().optional(),
    linkedEntityId: z.string().uuid().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Validation error", details: parsed.error.errors });

  const data = parsed.data;

  // Auto-bridge: if assigning by personMasterId and no legacy user ID provided,
  // look up the person's linked user account and populate assignedToId.
  let resolvedAssignedToId = data.assignedToId;
  let resolvedAssignedToName = data.assignedToName;
  let resolvedAssignedToRole = data.assignedToRole;

  if (data.assignedToPersonId && !resolvedAssignedToId) {
    const [personRow] = await db
      .select()
      .from(personMasterTable)
      .where(eq(personMasterTable.id, data.assignedToPersonId))
      .limit(1);

    if (personRow?.userId) {
      resolvedAssignedToId = personRow.userId;
    }
    if (!resolvedAssignedToName && personRow) {
      resolvedAssignedToName = personRow.fullName ?? undefined;
    }
  }

  const [row] = await db
    .insert(operationalTasksTable)
    .values({
      title: data.title,
      description: data.description,
      taskType: data.taskType,
      priority: data.priority,
      projectId: data.projectId,
      projectName: data.projectName,
      assignedToPersonId: data.assignedToPersonId,
      assignedToPersonName: data.assignedToPersonName ?? resolvedAssignedToName,
      assignedToId: resolvedAssignedToId,
      assignedToName: resolvedAssignedToName,
      assignedToRole: resolvedAssignedToRole,
      assignedById: dbUser.id,
      assignedByName: dbUser.displayName ?? dbUser.email ?? dbUser.id,
      dueDate: data.dueDate,
      notes: data.notes,
      linkedEntityType: data.linkedEntityType,
      linkedEntityId: data.linkedEntityId,
    })
    .returning();

  return res.status(201).json(row);
});

// ── GET /tasks/:id ──────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { dbUserId, dbUser, userRole } = req;
  if (!dbUser) return res.status(401).json({ error: "Unauthorized" });
  if (!(ALL_TASK_ROLES as readonly string[]).includes(userRole!))
    return res.status(403).json({ error: "Forbidden" });

  const id = req.params.id as string;
  const [row] = await db
    .select()
    .from(operationalTasksTable)
    .where(eq(operationalTasksTable.id, id))
    .limit(1);
  if (!row || !row.isActive) return res.status(404).json({ error: "Task not found" });

  // Workers can only see tasks assigned to them (person identity OR legacy account)
  if (isWorker(userRole!)) {
    const personMasterId = dbUserId ? await getPersonMasterIdForUser(dbUserId) : null;
    const assignedToMe =
      row.assignedToId === dbUser.id ||
      (personMasterId !== null && row.assignedToPersonId === personMasterId);
    if (!assignedToMe) return res.status(403).json({ error: "Forbidden" });
  }

  return res.json(row);
});

// ── PATCH /tasks/:id ────────────────────────────────────────────────────────
// Admin/developer: full update; workers: can only update status + notes
router.patch("/:id", async (req, res) => {
  const { dbUserId, dbUser, userRole } = req;
  if (!dbUser) return res.status(401).json({ error: "Unauthorized" });
  if (!(ALL_TASK_ROLES as readonly string[]).includes(userRole!))
    return res.status(403).json({ error: "Forbidden" });

  const id = req.params.id as string;
  const [existing] = await db
    .select()
    .from(operationalTasksTable)
    .where(eq(operationalTasksTable.id, id))
    .limit(1);
  if (!existing || !existing.isActive) return res.status(404).json({ error: "Task not found" });

  if (isWorker(userRole!)) {
    const personMasterId = dbUserId ? await getPersonMasterIdForUser(dbUserId) : null;
    const assignedToMe =
      existing.assignedToId === dbUser.id ||
      (personMasterId !== null && existing.assignedToPersonId === personMasterId);
    if (!assignedToMe) return res.status(403).json({ error: "Forbidden" });

    const schema = z.object({
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Validation error", details: parsed.error.errors });

    const updates: Record<string, any> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.status === "completed") {
      updates.completedAt = new Date();
      updates.completedById = dbUser.id;
      updates.completedByName = dbUser.displayName ?? dbUser.email ?? dbUser.id;
    }

    const [updated] = await db
      .update(operationalTasksTable)
      .set(updates)
      .where(eq(operationalTasksTable.id, id))
      .returning();
    return res.json(updated);
  }

  // Manager full update
  const schema = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().nullable().optional(),
    taskType: z
      .enum(["production_entry", "stock_update", "inspection", "general"])
      .optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    projectId: z.string().uuid().nullable().optional(),
    projectName: z.string().nullable().optional(),
    assignedToPersonId: z.string().uuid().nullable().optional(),
    assignedToPersonName: z.string().nullable().optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    assignedToName: z.string().nullable().optional(),
    assignedToRole: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Validation error", details: parsed.error.errors });

  const data = parsed.data;

  // Auto-bridge on reassignment: if new personId provided without explicit userId
  let resolvedAssignedToId = data.assignedToId;
  if (data.assignedToPersonId && data.assignedToId === undefined) {
    const [personRow] = await db
      .select()
      .from(personMasterTable)
      .where(eq(personMasterTable.id, data.assignedToPersonId))
      .limit(1);
    if (personRow?.userId) {
      resolvedAssignedToId = personRow.userId;
    }
  }

  const updates: Record<string, any> = {
    ...data,
    assignedToId: resolvedAssignedToId,
    updatedAt: new Date(),
  };
  if (data.status === "completed" && existing.status !== "completed") {
    updates.completedAt = new Date();
    updates.completedById = dbUser.id;
    updates.completedByName = dbUser.displayName ?? dbUser.email ?? dbUser.id;
  }

  const [updated] = await db
    .update(operationalTasksTable)
    .set(updates)
    .where(eq(operationalTasksTable.id, id))
    .returning();
  return res.json(updated);
});

// ── DELETE /tasks/:id ───────────────────────────────────────────────────────
// Admin only — soft cancel
router.delete("/:id", async (req, res) => {
  const { dbUser, userRole } = req;
  if (!dbUser || userRole !== "admin") return res.status(403).json({ error: "Admin only" });

  const id = req.params.id as string;
  const [row] = await db
    .select()
    .from(operationalTasksTable)
    .where(eq(operationalTasksTable.id, id))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Task not found" });

  await db
    .update(operationalTasksTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(operationalTasksTable.id, id));
  return res.status(204).end();
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { operationalTasksTable } from "@workspace/db/schema";
import { eq, and, desc, or, isNull } from "drizzle-orm";
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

// ── GET /tasks ─────────────────────────────────────────────────────────────
// Admin/developer: all active tasks (optionally filter by assignedToId, projectId, status)
// Employee/staff: only their own tasks
router.get("/", async (req, res) => {
  const { userId, appUser } = req as any;
  if (!appUser) return res.status(401).json({ error: "Unauthorized" });
  const role: string = appUser.role;

  if (![...MANAGER_ROLES, ...WORKER_ROLES].includes(role as any)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { status, projectId, assignedToId, taskType } = req.query as Record<string, string | undefined>;

  let rows;

  if (isManager(role)) {
    const conditions = [eq(operationalTasksTable.isActive, true)];
    if (status) conditions.push(eq(operationalTasksTable.status, status as any));
    if (projectId) conditions.push(eq(operationalTasksTable.projectId, projectId));
    if (assignedToId) conditions.push(eq(operationalTasksTable.assignedToId, assignedToId));
    if (taskType) conditions.push(eq(operationalTasksTable.taskType, taskType as any));
    rows = await db
      .select()
      .from(operationalTasksTable)
      .where(and(...conditions))
      .orderBy(desc(operationalTasksTable.createdAt));
  } else {
    // Workers only see tasks assigned to them
    const conditions = [
      eq(operationalTasksTable.isActive, true),
      eq(operationalTasksTable.assignedToId, appUser.id),
    ];
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
// KPI counts for dashboard panels
router.get("/summary", async (req, res) => {
  const { appUser } = req as any;
  if (!appUser) return res.status(401).json({ error: "Unauthorized" });
  const role: string = appUser.role;

  if (![...MANAGER_ROLES, ...WORKER_ROLES].includes(role as any)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const baseCondition = isManager(role)
    ? eq(operationalTasksTable.isActive, true)
    : and(eq(operationalTasksTable.isActive, true), eq(operationalTasksTable.assignedToId, appUser.id));

  const rows = await db
    .select()
    .from(operationalTasksTable)
    .where(baseCondition!);

  const pending = rows.filter((r) => r.status === "pending").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const completed = rows.filter((r) => r.status === "completed").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const urgent = rows.filter((r) => r.priority === "urgent" && (r.status === "pending" || r.status === "in_progress")).length;
  const overdue = rows.filter((r) => {
    if (!r.dueDate) return false;
    if (r.status === "completed" || r.status === "cancelled") return false;
    return new Date(r.dueDate) < new Date();
  }).length;

  return res.json({ pending, inProgress, completed, cancelled, urgent, overdue, total: rows.length });
});

// ── POST /tasks ─────────────────────────────────────────────────────────────
// Admin/developer only
router.post("/", async (req, res) => {
  const { appUser } = req as any;
  if (!appUser || !isManager(appUser.role)) return res.status(403).json({ error: "Forbidden" });

  const schema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    taskType: z.enum(["production_entry", "stock_update", "inspection", "general"]).default("general"),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    projectId: z.string().uuid().optional(),
    projectName: z.string().optional(),
    assignedToId: z.string().uuid().optional(),
    assignedToName: z.string().optional(),
    assignedToRole: z.string().optional(),
    dueDate: z.string().optional(),
    notes: z.string().optional(),
    linkedEntityType: z.string().optional(),
    linkedEntityId: z.string().uuid().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", details: parsed.error.errors });

  const [row] = await db
    .insert(operationalTasksTable)
    .values({
      ...parsed.data,
      assignedById: appUser.id,
      assignedByName: appUser.displayName ?? appUser.clerkUserId,
    })
    .returning();

  return res.status(201).json(row);
});

// ── GET /tasks/:id ──────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { appUser } = req as any;
  if (!appUser) return res.status(401).json({ error: "Unauthorized" });
  const role: string = appUser.role;
  if (![...MANAGER_ROLES, ...WORKER_ROLES].includes(role as any)) return res.status(403).json({ error: "Forbidden" });

  const id = req.params.id as string;
  const [row] = await db.select().from(operationalTasksTable).where(eq(operationalTasksTable.id, id)).limit(1);
  if (!row || !row.isActive) return res.status(404).json({ error: "Task not found" });

  // Workers can only see their own tasks
  if (isWorker(role) && row.assignedToId !== appUser.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return res.json(row);
});

// ── PATCH /tasks/:id ────────────────────────────────────────────────────────
// Admin/developer: full update; workers: can only update status + notes
router.patch("/:id", async (req, res) => {
  const { appUser } = req as any;
  if (!appUser) return res.status(401).json({ error: "Unauthorized" });
  const role: string = appUser.role;
  if (![...MANAGER_ROLES, ...WORKER_ROLES].includes(role as any)) return res.status(403).json({ error: "Forbidden" });

  const id = req.params.id as string;
  const [existing] = await db.select().from(operationalTasksTable).where(eq(operationalTasksTable.id, id)).limit(1);
  if (!existing || !existing.isActive) return res.status(404).json({ error: "Task not found" });

  if (isWorker(role)) {
    if (existing.assignedToId !== appUser.id) return res.status(403).json({ error: "Forbidden" });

    const schema = z.object({
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
      notes: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation error", details: parsed.error.errors });

    const updates: Record<string, any> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.status === "completed") {
      updates.completedAt = new Date();
      updates.completedById = appUser.id;
      updates.completedByName = appUser.displayName ?? appUser.clerkUserId;
    }

    const [updated] = await db.update(operationalTasksTable).set(updates).where(eq(operationalTasksTable.id, id)).returning();
    return res.json(updated);
  }

  // Manager full update
  const schema = z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().nullable().optional(),
    taskType: z.enum(["production_entry", "stock_update", "inspection", "general"]).optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    projectId: z.string().uuid().nullable().optional(),
    projectName: z.string().nullable().optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    assignedToName: z.string().nullable().optional(),
    assignedToRole: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", details: parsed.error.errors });

  const updates: Record<string, any> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.status === "completed" && existing.status !== "completed") {
    updates.completedAt = new Date();
    updates.completedById = appUser.id;
    updates.completedByName = appUser.displayName ?? appUser.clerkUserId;
  }

  const [updated] = await db.update(operationalTasksTable).set(updates).where(eq(operationalTasksTable.id, id)).returning();
  return res.json(updated);
});

// ── DELETE /tasks/:id ───────────────────────────────────────────────────────
// Admin only — soft cancel
router.delete("/:id", async (req, res) => {
  const { appUser } = req as any;
  if (!appUser || appUser.role !== "admin") return res.status(403).json({ error: "Admin only" });

  const id = req.params.id as string;
  const [row] = await db.select().from(operationalTasksTable).where(eq(operationalTasksTable.id, id)).limit(1);
  if (!row) return res.status(404).json({ error: "Task not found" });

  await db.update(operationalTasksTable).set({ isActive: false, updatedAt: new Date() }).where(eq(operationalTasksTable.id, id));
  return res.status(204).end();
});

export default router;

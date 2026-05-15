import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, isNull, gte, lte, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  storeEntriesTable,
  collectionEntriesTable,
  productionAuditLogTable,
  productionEmployeeAssignmentsTable,
  userProjectAssignmentsTable,
} from "@workspace/db";
import { format } from "date-fns";

const router = Router();

function isAdminOrDev(role: string) {
  return role === "admin" || role === "developer";
}

async function resolveActor(clerkUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role, displayName: usersTable.displayName })
    .from(usersTable)
    .where(and(eq(usersTable.clerkUserId, clerkUserId), eq(usersTable.isActive, true)))
    .limit(1);
  return user ?? null;
}

async function getProductionAssignment(employeeId: string) {
  const [row] = await db
    .select({ assignment: productionEmployeeAssignmentsTable, projectName: projectsTable.name })
    .from(productionEmployeeAssignmentsTable)
    .leftJoin(projectsTable, eq(productionEmployeeAssignmentsTable.projectId, projectsTable.id))
    .where(and(
      eq(productionEmployeeAssignmentsTable.employeeId, employeeId),
      eq(productionEmployeeAssignmentsTable.isActive, true),
    ))
    .limit(1);
  return row ?? null;
}

async function getPendingOutsideStore(projectId: string): Promise<number> {
  const [collResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${collectionEntriesTable.sheetCount}), 0)` })
    .from(collectionEntriesTable)
    .where(and(eq(collectionEntriesTable.projectId, projectId), isNull(collectionEntriesTable.deletedAt)));

  const [storeResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${storeEntriesTable.sheetCount}), 0)` })
    .from(storeEntriesTable)
    .where(and(eq(storeEntriesTable.projectId, projectId), isNull(storeEntriesTable.deletedAt)));

  return Math.max(0, Number(collResult?.total ?? 0) - Number(storeResult?.total ?? 0));
}

async function logAudit(
  actionType: string,
  projectId: string | null,
  userId: string | null,
  oldValues: object | null,
  newValues: object | null,
) {
  await db.insert(productionAuditLogTable).values({
    moduleName: "store_entries",
    actionType,
    projectId,
    userId,
    oldValues,
    newValues,
  });
}

// GET /store-entries
router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const projectId = req.query.projectId as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;

  const conditions: any[] = [isNull(storeEntriesTable.deletedAt)];

  if (isAdminOrDev(actor.role)) {
    if (projectId) conditions.push(eq(storeEntriesTable.projectId, projectId));
  } else {
    conditions.push(eq(storeEntriesTable.employeeId, actor.id));
    const assignment = await getProductionAssignment(actor.id);
    if (!assignment) return res.json([]);
    conditions.push(eq(storeEntriesTable.projectId, assignment.assignment.projectId));
  }

  if (dateFrom) conditions.push(gte(storeEntriesTable.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(storeEntriesTable.entryDate, dateTo));

  const rows = await db
    .select({ entry: storeEntriesTable, projectName: projectsTable.name })
    .from(storeEntriesTable)
    .leftJoin(projectsTable, eq(storeEntriesTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(desc(storeEntriesTable.entryDate), desc(storeEntriesTable.entryTime));

  return res.json(rows.map(r => ({ ...r.entry, projectName: r.projectName })));
});

// POST /store-entries
router.post("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  let { projectId, employeeId, sheetCount, weightKg, scrapWeightKg, remarks } = req.body;

  if (!Number.isInteger(sheetCount) || sheetCount <= 0) {
    return res.status(400).json({ error: "sheetCount must be a positive integer." });
  }

  if (!isAdminOrDev(actor.role)) {
    const assignment = await getProductionAssignment(actor.id);
    if (!assignment) {
      return res.status(403).json({ error: "You are not assigned to any production project." });
    }
    projectId = assignment.assignment.projectId;
    employeeId = actor.id;
  }

  if (!projectId || !employeeId) {
    return res.status(400).json({ error: "projectId and employeeId are required." });
  }

  // Prevent over-storing: stored cannot exceed collected
  const pending = await getPendingOutsideStore(projectId);
  if (sheetCount > pending) {
    return res.status(400).json({
      error: `Cannot store ${sheetCount} sheets. Only ${pending} sheets are pending outside store.`,
      pendingOutsideStore: pending,
    });
  }

  const now = new Date();
  const entryDate = format(now, "yyyy-MM-dd");
  const entryTime = format(now, "HH:mm");

  const [employee] = await db.select({ displayName: usersTable.displayName })
    .from(usersTable).where(eq(usersTable.id, employeeId)).limit(1);

  const [created] = await db.insert(storeEntriesTable).values({
    projectId,
    employeeId,
    employeeName: employee?.displayName ?? null,
    sheetCount,
    weightKg: weightKg ?? null,
    scrapWeightKg: scrapWeightKg ?? null,
    entryDate,
    entryTime,
    remarks: remarks ?? null,
  }).returning();

  await logAudit("create", projectId, actor.id, null, created);
  return res.status(201).json({ ...created, pendingOutsideStore: pending - sheetCount });
});

// PATCH /store-entries/:id
router.patch("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db.select().from(storeEntriesTable)
    .where(and(eq(storeEntriesTable.id, req.params.id), isNull(storeEntriesTable.deletedAt)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Entry not found." });

  const { sheetCount, weightKg, scrapWeightKg, remarks } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (sheetCount !== undefined) updates.sheetCount = sheetCount;
  if (weightKg !== undefined) updates.weightKg = weightKg;
  if (scrapWeightKg !== undefined) updates.scrapWeightKg = scrapWeightKg;
  if (remarks !== undefined) updates.remarks = remarks;

  const [updated] = await db.update(storeEntriesTable).set(updates)
    .where(eq(storeEntriesTable.id, req.params.id)).returning();

  await logAudit("edit", existing.projectId, actor.id, existing, updated);
  return res.json(updated);
});

// DELETE /store-entries/:id — soft delete
router.delete("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db.select().from(storeEntriesTable)
    .where(and(eq(storeEntriesTable.id, req.params.id), isNull(storeEntriesTable.deletedAt)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Entry not found." });

  const [deleted] = await db.update(storeEntriesTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(storeEntriesTable.id, req.params.id)).returning();

  await logAudit("soft_delete", existing.projectId, actor.id, existing, null);
  return res.json(deleted);
});

export default router;

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, isNull, gte, lte, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  collectionEntriesTable,
  storeEntriesTable,
  productionAuditLogTable,
  productionEmployeeAssignmentsTable,
  observationAssignmentsTable,
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

async function getAssignedProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: userProjectAssignmentsTable.projectId })
    .from(userProjectAssignmentsTable)
    .where(eq(userProjectAssignmentsTable.userId, userId));
  return rows.map(r => r.projectId);
}

async function getProductionAssignment(employeeId: string) {
  const [row] = await db
    .select({
      assignment: productionEmployeeAssignmentsTable,
      projectName: projectsTable.name,
    })
    .from(productionEmployeeAssignmentsTable)
    .leftJoin(projectsTable, eq(productionEmployeeAssignmentsTable.projectId, projectsTable.id))
    .where(and(
      eq(productionEmployeeAssignmentsTable.employeeId, employeeId),
      eq(productionEmployeeAssignmentsTable.isActive, true),
    ))
    .limit(1);
  return row ?? null;
}

async function isObserverActive(projectId: string, now: Date): Promise<boolean> {
  const nowTs = now.toISOString();
  const [row] = await db
    .select({ id: observationAssignmentsTable.id })
    .from(observationAssignmentsTable)
    .where(and(
      eq(observationAssignmentsTable.projectId, projectId),
      lte(sql`${observationAssignmentsTable.startDatetime}::text`, nowTs),
      sql`(${observationAssignmentsTable.endDatetime} IS NULL OR ${observationAssignmentsTable.endDatetime}::text >= ${nowTs})`,
    ))
    .limit(1);
  return !!row;
}

async function logAudit(
  actionType: string,
  projectId: string | null,
  userId: string | null,
  oldValues: object | null,
  newValues: object | null,
) {
  await db.insert(productionAuditLogTable).values({
    moduleName: "collection_entries",
    actionType,
    projectId,
    userId,
    oldValues,
    newValues,
  });
}

// GET /collection-entries — list entries
// Employees see only their own. Admins/devs see project-wide.
router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const projectId = req.query.projectId as string | undefined;
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;
  const employeeId = req.query.employeeId as string | undefined;

  const conditions: any[] = [isNull(collectionEntriesTable.deletedAt)];

  if (isAdminOrDev(actor.role)) {
    if (projectId) conditions.push(eq(collectionEntriesTable.projectId, projectId));
    if (employeeId) conditions.push(eq(collectionEntriesTable.employeeId, employeeId));
  } else {
    // Employees see only their own entries
    conditions.push(eq(collectionEntriesTable.employeeId, actor.id));
    // Also restrict to their assigned project
    const assignedIds = await getAssignedProjectIds(actor.id);
    if (assignedIds.length > 0) {
      conditions.push(eq(collectionEntriesTable.projectId, assignedIds[0]));
    } else {
      return res.json([]);
    }
  }

  if (dateFrom) conditions.push(gte(collectionEntriesTable.entryDate, dateFrom));
  if (dateTo) conditions.push(lte(collectionEntriesTable.entryDate, dateTo));

  const rows = await db
    .select({
      entry: collectionEntriesTable,
      projectName: projectsTable.name,
    })
    .from(collectionEntriesTable)
    .leftJoin(projectsTable, eq(collectionEntriesTable.projectId, projectsTable.id))
    .where(and(...conditions))
    .orderBy(desc(collectionEntriesTable.entryDate), desc(collectionEntriesTable.entryTime));

  return res.json(rows.map(r => ({ ...r.entry, projectName: r.projectName })));
});

// POST /collection-entries — create a collection entry
router.post("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  let { projectId, employeeId, sheetCount, remarks } = req.body;

  if (!Number.isInteger(sheetCount) || sheetCount <= 0) {
    return res.status(400).json({ error: "sheetCount must be a positive integer." });
  }

  // Employees auto-fill project and identity from their assignment
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

  // ── Governance lock check ────────────────────────────────────────────
  const [govColl] = await db
    .select({ governanceLocked: projectsTable.governanceLocked, configurationStatus: projectsTable.configurationStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (govColl?.governanceLocked) {
    return res.status(423).json({
      error: "Project is governance-locked. At least one valid landowner must be linked before collection entries can be created.",
      code: "GOVERNANCE_LOCKED",
      configurationStatus: govColl.configurationStatus,
    });
  }

  const now = new Date();
  const entryDate = format(now, "yyyy-MM-dd");
  const entryTime = format(now, "HH:mm");
  const observerActive = (await isObserverActive(projectId, now)) ? "yes" : "no";

  const [employee] = await db.select({ displayName: usersTable.displayName })
    .from(usersTable).where(eq(usersTable.id, employeeId)).limit(1);

  const [created] = await db.insert(collectionEntriesTable).values({
    projectId,
    employeeId,
    employeeName: employee?.displayName ?? null,
    sheetCount,
    entryDate,
    entryTime,
    remarks: remarks ?? null,
    observerActive,
  }).returning();

  await logAudit("create", projectId, actor.id, null, created);
  return res.status(201).json(created);
});

// PATCH /collection-entries/:id — soft-edit (admin/dev only)
router.patch("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db.select().from(collectionEntriesTable)
    .where(and(eq(collectionEntriesTable.id, req.params.id), isNull(collectionEntriesTable.deletedAt)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Entry not found." });

  const { sheetCount, remarks } = req.body;
  const updates: Partial<typeof existing> = { updatedAt: new Date() };
  if (sheetCount !== undefined) {
    if (!Number.isInteger(sheetCount) || sheetCount <= 0) {
      return res.status(400).json({ error: "sheetCount must be a positive integer." });
    }
    updates.sheetCount = sheetCount;
  }
  if (remarks !== undefined) updates.remarks = remarks;

  const [updated] = await db.update(collectionEntriesTable)
    .set(updates as any)
    .where(eq(collectionEntriesTable.id, req.params.id))
    .returning();

  await logAudit("edit", existing.projectId, actor.id, existing, updated);
  return res.json(updated);
});

// DELETE /collection-entries/:id — soft delete (admin/dev only)
router.delete("/:id", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db.select().from(collectionEntriesTable)
    .where(and(eq(collectionEntriesTable.id, req.params.id), isNull(collectionEntriesTable.deletedAt)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Entry not found." });

  const [deleted] = await db.update(collectionEntriesTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(collectionEntriesTable.id, req.params.id))
    .returning();

  await logAudit("soft_delete", existing.projectId, actor.id, existing, null);
  return res.json(deleted);
});

// GET /collection-entries/summary/:projectId — pending outside store + today totals
router.get("/summary/:projectId", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const { projectId } = req.params;
  const today = format(new Date(), "yyyy-MM-dd");

  // Access check
  if (!isAdminOrDev(actor.role)) {
    const assignment = await getProductionAssignment(actor.id);
    if (!assignment || assignment.assignment.projectId !== projectId) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const [collResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${collectionEntriesTable.sheetCount}), 0)` })
    .from(collectionEntriesTable)
    .where(and(eq(collectionEntriesTable.projectId, projectId), isNull(collectionEntriesTable.deletedAt)));

  const [storeResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${storeEntriesTable.sheetCount}), 0)` })
    .from(storeEntriesTable)
    .where(and(eq(storeEntriesTable.projectId, projectId), isNull(storeEntriesTable.deletedAt)));

  const [todayCollResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${collectionEntriesTable.sheetCount}), 0)` })
    .from(collectionEntriesTable)
    .where(and(
      eq(collectionEntriesTable.projectId, projectId),
      eq(collectionEntriesTable.entryDate, today),
      isNull(collectionEntriesTable.deletedAt),
    ));

  const [todayStoreResult] = await db
    .select({ total: sql<number>`COALESCE(SUM(${storeEntriesTable.sheetCount}), 0)` })
    .from(storeEntriesTable)
    .where(and(
      eq(storeEntriesTable.projectId, projectId),
      eq(storeEntriesTable.entryDate, today),
      isNull(storeEntriesTable.deletedAt),
    ));

  const [weightResult] = await db
    .select({
      totalWeight: sql<number>`COALESCE(SUM(${storeEntriesTable.weightKg}), 0)`,
      totalScrap: sql<number>`COALESCE(SUM(${storeEntriesTable.scrapWeightKg}), 0)`,
    })
    .from(storeEntriesTable)
    .where(and(eq(storeEntriesTable.projectId, projectId), isNull(storeEntriesTable.deletedAt)));

  const totalCollected = Number(collResult?.total ?? 0);
  const totalStored = Number(storeResult?.total ?? 0);

  return res.json({
    projectId,
    totalCollected,
    totalStored,
    pendingOutsideStore: Math.max(0, totalCollected - totalStored),
    todayCollected: Number(todayCollResult?.total ?? 0),
    todayStored: Number(todayStoreResult?.total ?? 0),
    totalStoredWeightKg: Number(weightResult?.totalWeight ?? 0),
    totalScrapWeightKg: Number(weightResult?.totalScrap ?? 0),
  });
});

export default router;

import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  observationAssignmentsTable,
  productionAuditLogTable,
} from "@workspace/db";

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

// GET /observation-assignments
router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const projectId = req.query.projectId as string | undefined;
  const conditions: any[] = [];
  if (projectId) conditions.push(eq(observationAssignmentsTable.projectId, projectId));

  const rows = await db
    .select({
      obs: observationAssignmentsTable,
      projectName: projectsTable.name,
      observerDisplayName: usersTable.displayName,
    })
    .from(observationAssignmentsTable)
    .leftJoin(projectsTable, eq(observationAssignmentsTable.projectId, projectsTable.id))
    .leftJoin(usersTable, eq(observationAssignmentsTable.observerUserId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(observationAssignmentsTable.startDatetime));

  return res.json(rows.map(r => ({
    ...r.obs,
    projectName: r.projectName,
    observerDisplayName: r.observerDisplayName ?? r.obs.observerName,
  })));
});

// POST /observation-assignments
router.post("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { projectId, observerUserId, startDatetime, endDatetime, notes } = req.body;
  if (!projectId || !observerUserId || !startDatetime) {
    return res.status(400).json({ error: "projectId, observerUserId, startDatetime are required." });
  }

  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return res.status(404).json({ error: "Project not found." });

  const [observer] = await db.select({ displayName: usersTable.displayName }).from(usersTable)
    .where(eq(usersTable.id, observerUserId)).limit(1);
  if (!observer) return res.status(404).json({ error: "Observer user not found." });

  const [created] = await db.insert(observationAssignmentsTable).values({
    projectId,
    observerUserId,
    observerName: observer.displayName,
    startDatetime: new Date(startDatetime),
    endDatetime: endDatetime ? new Date(endDatetime) : null,
    notes: notes ?? null,
    createdById: actor.id,
    createdByName: actor.displayName,
  }).returning();

  await db.insert(productionAuditLogTable).values({
    moduleName: "observation_assignments",
    actionType: "create",
    projectId,
    userId: actor.id,
    oldValues: null,
    newValues: created,
  });

  return res.status(201).json(created);
});

// PATCH /observation-assignments/:id/close — set endDatetime to now
router.patch("/:id/close", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db.select().from(observationAssignmentsTable)
    .where(eq(observationAssignmentsTable.id, req.params.id)).limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });

  const [updated] = await db.update(observationAssignmentsTable)
    .set({ endDatetime: new Date(), updatedAt: new Date() })
    .where(eq(observationAssignmentsTable.id, req.params.id))
    .returning();

  return res.json(updated);
});

export default router;

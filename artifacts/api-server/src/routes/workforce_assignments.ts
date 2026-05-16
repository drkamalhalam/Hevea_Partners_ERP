import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  projectWorkforceAssignmentsTable,
  personMasterTable,
} from "@workspace/db";
import { z } from "zod";

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

const createSchema = z.object({
  projectId: z.string().uuid(),
  personId: z.string().uuid(),
  roleType: z.string().min(1),
  assignmentType: z.enum(["employee", "observer", "supervisor"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
  observationType: z.enum(["routine", "surprise", "audit", "verification"]).optional(),
});

// GET /workforce-assignments
router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const projectId = req.query.projectId as string | undefined;
  const assignmentType = req.query.assignmentType as string | undefined;
  const activeOnly = req.query.activeOnly === "true";

  const conditions: ReturnType<typeof eq>[] = [];
  if (projectId) conditions.push(eq(projectWorkforceAssignmentsTable.projectId, projectId));
  if (assignmentType) conditions.push(eq(projectWorkforceAssignmentsTable.assignmentType, assignmentType));
  if (activeOnly) conditions.push(eq(projectWorkforceAssignmentsTable.isActive, true));

  const rows = await db
    .select({
      id: projectWorkforceAssignmentsTable.id,
      projectId: projectWorkforceAssignmentsTable.projectId,
      projectName: projectsTable.name,
      personId: projectWorkforceAssignmentsTable.personId,
      personNameSnapshot: projectWorkforceAssignmentsTable.personNameSnapshot,
      personMobile: personMasterTable.mobile,
      personAadhaarLast4: personMasterTable.aadhaarLast4,
      roleType: projectWorkforceAssignmentsTable.roleType,
      assignmentType: projectWorkforceAssignmentsTable.assignmentType,
      startDate: projectWorkforceAssignmentsTable.startDate,
      endDate: projectWorkforceAssignmentsTable.endDate,
      isActive: projectWorkforceAssignmentsTable.isActive,
      notes: projectWorkforceAssignmentsTable.notes,
      observationType: projectWorkforceAssignmentsTable.observationType,
      assignedById: projectWorkforceAssignmentsTable.assignedById,
      assignedByName: projectWorkforceAssignmentsTable.assignedByName,
      createdAt: projectWorkforceAssignmentsTable.createdAt,
      updatedAt: projectWorkforceAssignmentsTable.updatedAt,
    })
    .from(projectWorkforceAssignmentsTable)
    .leftJoin(projectsTable, eq(projectWorkforceAssignmentsTable.projectId, projectsTable.id))
    .leftJoin(personMasterTable, eq(projectWorkforceAssignmentsTable.personId, personMasterTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projectWorkforceAssignmentsTable.createdAt));

  return res.json(rows);
});

// POST /workforce-assignments
router.post("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  const { projectId, personId, roleType, assignmentType, startDate, endDate, notes, observationType } = parsed.data;

  const [person] = await db
    .select({ id: personMasterTable.id, fullName: personMasterTable.fullName })
    .from(personMasterTable)
    .where(eq(personMasterTable.id, personId))
    .limit(1);
  if (!person) return res.status(404).json({ error: "Person not found in registry." });

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return res.status(404).json({ error: "Project not found." });

  const today = new Date().toISOString().slice(0, 10);

  const [created] = await db
    .insert(projectWorkforceAssignmentsTable)
    .values({
      projectId,
      personId,
      personNameSnapshot: person.fullName,
      roleType,
      assignmentType,
      startDate: startDate ?? today,
      endDate: endDate ?? null,
      notes: notes ?? null,
      observationType: observationType ?? null,
      assignedById: actor.id,
      assignedByName: actor.displayName,
      isActive: true,
    })
    .returning();

  return res.status(201).json(created);
});

// PATCH /workforce-assignments/:id/deactivate
router.patch("/:id/deactivate", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db
    .select()
    .from(projectWorkforceAssignmentsTable)
    .where(eq(projectWorkforceAssignmentsTable.id, req.params.id))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });

  const [updated] = await db
    .update(projectWorkforceAssignmentsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(projectWorkforceAssignmentsTable.id, req.params.id))
    .returning();

  return res.json(updated);
});

export default router;

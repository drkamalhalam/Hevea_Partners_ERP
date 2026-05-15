import { Router } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  projectsTable,
  productionEmployeeAssignmentsTable,
  productionAuditLogTable,
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

async function logAudit(
  moduleName: string,
  actionType: string,
  projectId: string | null,
  userId: string | null,
  oldValues: object | null,
  newValues: object | null,
) {
  await db.insert(productionAuditLogTable).values({
    moduleName,
    actionType,
    projectId,
    userId,
    oldValues,
    newValues,
  });
}

// GET /production-assignments — list all assignments (admin/dev only)
router.get("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const projectId = req.query.projectId as string | undefined;
  const activeOnly = req.query.activeOnly !== "false";

  const conditions = [];
  if (projectId) conditions.push(eq(productionEmployeeAssignmentsTable.projectId, projectId));
  if (activeOnly) conditions.push(eq(productionEmployeeAssignmentsTable.isActive, true));

  const rows = await db
    .select({
      assignment: productionEmployeeAssignmentsTable,
      employeeName: usersTable.displayName,
      projectName: projectsTable.name,
    })
    .from(productionEmployeeAssignmentsTable)
    .leftJoin(usersTable, eq(productionEmployeeAssignmentsTable.employeeId, usersTable.id))
    .leftJoin(projectsTable, eq(productionEmployeeAssignmentsTable.projectId, projectsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(productionEmployeeAssignmentsTable.createdAt));

  return res.json(rows.map(r => ({
    ...r.assignment,
    employeeName: r.employeeName ?? r.assignment.employeeName,
    projectName: r.projectName,
  })));
});

// POST /production-assignments — assign employee to project
router.post("/", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const { employeeId, projectId, role = "collector", notes } = req.body;
  if (!employeeId || !projectId) {
    return res.status(400).json({ error: "employeeId and projectId are required." });
  }

  const [employee] = await db.select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable).where(eq(usersTable.id, employeeId)).limit(1);
  if (!employee) return res.status(404).json({ error: "Employee not found." });

  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) return res.status(404).json({ error: "Project not found." });

  const today = format(new Date(), "yyyy-MM-dd");

  const [created] = await db.insert(productionEmployeeAssignmentsTable).values({
    employeeId,
    projectId,
    role: role as any,
    assignedById: actor.id,
    assignedByName: actor.displayName,
    assignedDate: today,
    isActive: true,
    notes: notes ?? null,
    employeeName: employee.displayName,
  }).returning();

  await logAudit("production_employee_assignments", "create", projectId, actor.id, null, created);
  return res.status(201).json(created);
});

// PATCH /production-assignments/:id/deactivate
router.patch("/:id/deactivate", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor || !isAdminOrDev(actor.role)) return res.status(403).json({ error: "Forbidden" });

  const [existing] = await db.select().from(productionEmployeeAssignmentsTable)
    .where(eq(productionEmployeeAssignmentsTable.id, req.params.id)).limit(1);
  if (!existing) return res.status(404).json({ error: "Assignment not found." });

  const [updated] = await db.update(productionEmployeeAssignmentsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(productionEmployeeAssignmentsTable.id, req.params.id))
    .returning();

  await logAudit("production_employee_assignments", "deactivate", existing.projectId, actor.id, existing, updated);
  return res.json(updated);
});

// GET /production-assignments/my — employee gets their own assignment
router.get("/my", async (req, res) => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) return res.status(401).json({ error: "Unauthorized" });
  const actor = await resolveActor(clerkUserId);
  if (!actor) return res.status(401).json({ error: "Unauthorized" });

  const rows = await db
    .select({
      assignment: productionEmployeeAssignmentsTable,
      projectName: projectsTable.name,
    })
    .from(productionEmployeeAssignmentsTable)
    .leftJoin(projectsTable, eq(productionEmployeeAssignmentsTable.projectId, projectsTable.id))
    .where(and(
      eq(productionEmployeeAssignmentsTable.employeeId, actor.id),
      eq(productionEmployeeAssignmentsTable.isActive, true),
    ));

  return res.json(rows.map(r => ({ ...r.assignment, projectName: r.projectName })));
});

export default router;

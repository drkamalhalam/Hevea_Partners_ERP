import { Router } from "express";
import { db, projectsTable, activityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";
import { requireRole, canAccessProject } from "../middlewares/auth";

const router = Router();

function formatProject(p: typeof projectsTable.$inferSelect) {
  return {
    ...p,
    startDate: p.startDate,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt?.toISOString() ?? null,
  };
}

// GET /projects — admin/developer get all; others get only assigned projects
router.get("/", async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);
    if (req.canAccessAllProjects) {
      res.json(projects.map(formatProject));
    } else {
      res.json(
        projects
          .filter((p) => (req.userProjectIds ?? []).includes(p.id))
          .map(formatProject),
      );
    }
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /projects — admin or developer only
router.post("/", requireRole("admin", "developer"), async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [project] = await db.insert(projectsTable).values(parsed.data).returning();
    await db.insert(activityTable).values({
      type: "project_created",
      description: `New project "${project.name}" created`,
      entityId: project.id,
      entityType: "project",
    });
    res.status(201).json(formatProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /projects/:id — check project access
router.get("/:id", async (req, res) => {
  const parsed = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!canAccessProject(req, parsed.data.id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, parsed.data.id));
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /projects/:id — admin or developer + project access
router.patch("/:id", requireRole("admin", "developer"), async (req, res) => {
  const paramsParsed = UpdateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!canAccessProject(req, paramsParsed.data.id)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const bodyParsed = UpdateProjectBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }
  try {
    const [project] = await db
      .update(projectsTable)
      .set(bodyParsed.data)
      .where(eq(projectsTable.id, paramsParsed.data.id))
      .returning();
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db.insert(activityTable).values({
      type: "project_updated",
      description: `Project "${project.name}" updated`,
      entityId: project.id,
      entityType: "project",
    });
    res.json(formatProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /projects/:id — admin only
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const parsed = DeleteProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db.delete(projectsTable).where(eq(projectsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

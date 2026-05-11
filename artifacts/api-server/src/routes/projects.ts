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

const router = Router();

router.get("/", async (req, res) => {
  try {
    const projects = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);
    res.json(projects.map(p => ({
      ...p,
      startDate: p.startDate,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }
  try {
    const [project] = await db.insert(projectsTable).values(parsed.data).returning();
    await db.insert(activityTable).values({
      type: "project_created",
      description: `New project "${project.name}" created`,
      entityId: project.id,
      entityType: "project",
    });
    res.status(201).json({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const parsed = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, parsed.data.id));
    if (!project) return res.status(404).json({ error: "Not found" });
    res.json({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const paramsParsed = UpdateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });
  const bodyParsed = UpdateProjectBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });
  try {
    const [project] = await db.update(projectsTable)
      .set(bodyParsed.data)
      .where(eq(projectsTable.id, paramsParsed.data.id))
      .returning();
    if (!project) return res.status(404).json({ error: "Not found" });
    await db.insert(activityTable).values({
      type: "project_updated",
      description: `Project "${project.name}" updated`,
      entityId: project.id,
      entityType: "project",
    });
    res.json({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const parsed = DeleteProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  try {
    await db.delete(projectsTable).where(eq(projectsTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

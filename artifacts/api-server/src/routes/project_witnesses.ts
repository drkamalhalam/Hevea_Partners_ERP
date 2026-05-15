import { Router } from "express";
import { db, projectWitnessesTable, projectsTable } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole } from "../middlewares/auth";

const router = Router();

const witnessSchema = z.object({
  fullName: z.string().min(1),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().optional(),
  mobile: z.string().min(10, "Mobile required"),
  address: z.string().min(2, "Address required"),
  aadhaarNumber: z.string().optional(),
});

// GET /:projectId/witnesses
router.get("/:projectId/witnesses", requireRole("admin", "developer", "landowner", "investor", "employee", "operational_staff"), async (req, res) => {
  const projectId = String(req.params.projectId);
  const rows = await db
    .select()
    .from(projectWitnessesTable)
    .where(eq(projectWitnessesTable.projectId, projectId))
    .orderBy(asc(projectWitnessesTable.position));
  res.json({ witnesses: rows });
});

// POST /:projectId/witnesses — add new witness
router.post("/:projectId/witnesses", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);

  const project = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project.length) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const parsed = witnessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const existing = await db
    .select({ position: projectWitnessesTable.position })
    .from(projectWitnessesTable)
    .where(eq(projectWitnessesTable.projectId, projectId))
    .orderBy(asc(projectWitnessesTable.position));
  const nextPos = existing.length > 0 ? Math.max(...existing.map((w) => w.position)) + 1 : 1;

  const [row] = await db
    .insert(projectWitnessesTable)
    .values({
      projectId,
      position: nextPos,
      fullName: parsed.data.fullName,
      sOnCOn: parsed.data.sOnCOn ?? null,
      fatherGuardianName: parsed.data.fatherGuardianName ?? null,
      mobile: parsed.data.mobile,
      address: parsed.data.address,
      aadhaarNumber: parsed.data.aadhaarNumber ?? null,
      createdBy: req.dbUserId ?? null,
    })
    .returning();

  res.status(201).json({ witness: row });
});

// PUT /:projectId/witnesses/:position — update by position
router.put("/:projectId/witnesses/:position", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  const position = parseInt(String(req.params.position), 10);

  const parsed = witnessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const [row] = await db
    .update(projectWitnessesTable)
    .set({
      fullName: parsed.data.fullName,
      sOnCOn: parsed.data.sOnCOn ?? null,
      fatherGuardianName: parsed.data.fatherGuardianName ?? null,
      mobile: parsed.data.mobile,
      address: parsed.data.address,
      aadhaarNumber: parsed.data.aadhaarNumber ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectWitnessesTable.projectId, projectId),
        eq(projectWitnessesTable.position, position),
      ),
    )
    .returning();

  if (!row) {
    res.status(404).json({ error: "Witness not found" });
    return;
  }
  res.json({ witness: row });
});

// DELETE /:projectId/witnesses/:position
router.delete("/:projectId/witnesses/:position", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  const position = parseInt(String(req.params.position), 10);

  await db
    .delete(projectWitnessesTable)
    .where(
      and(
        eq(projectWitnessesTable.projectId, projectId),
        eq(projectWitnessesTable.position, position),
      ),
    );
  res.json({ ok: true });
});

export default router;

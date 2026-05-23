import { Router } from "express";
import { db, projectWitnessesTable, projectsTable } from "@workspace/db";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { writeProjectAudit, diffFields } from "../lib/projectAuditLogger";

const router = Router();

// personMasterId is required — witnesses must be linked to the Person Registry
const witnessSchema = z.object({
  personMasterId: z.string().uuid({
    error: "personMasterId is required — link the witness to a Person Registry entry first.",
  }),
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
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const rows = await db
    .select()
    .from(projectWitnessesTable)
    .where(eq(projectWitnessesTable.projectId, projectId))
    .orderBy(asc(projectWitnessesTable.position));
  res.set("Cache-Control", "no-store");
  res.json({ witnesses: rows });
});

// POST /:projectId/witnesses — add new witness
router.post("/:projectId/witnesses", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }

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
      personMasterId: parsed.data.personMasterId,
      createdBy: req.dbUserId ?? null,
    })
    .returning();

  await writeProjectAudit(req, {
    projectId,
    eventType: "witness_added",
    entityType: "project_witness",
    entityId: row.id,
    title: `Witness #${row.position} added: ${row.fullName}`,
    afterData: row as unknown as Record<string, unknown>,
  });

  res.status(201).json({ witness: row });
});

// PUT /:projectId/witnesses/:position — update by position
router.put("/:projectId/witnesses/:position", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const position = parseInt(String(req.params.position), 10);

  const parsed = witnessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const [existing] = await db
    .select()
    .from(projectWitnessesTable)
    .where(
      and(
        eq(projectWitnessesTable.projectId, projectId),
        eq(projectWitnessesTable.position, position),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Witness not found" });
    return;
  }

  const updateSet = {
    fullName: parsed.data.fullName,
    sOnCOn: parsed.data.sOnCOn ?? null,
    fatherGuardianName: parsed.data.fatherGuardianName ?? null,
    mobile: parsed.data.mobile,
    address: parsed.data.address,
    aadhaarNumber: parsed.data.aadhaarNumber ?? null,
    personMasterId: parsed.data.personMasterId,
    updatedAt: new Date(),
  };

  const [row] = await db
    .update(projectWitnessesTable)
    .set(updateSet)
    .where(
      and(
        eq(projectWitnessesTable.projectId, projectId),
        eq(projectWitnessesTable.position, position),
      ),
    )
    .returning();

  const diff = diffFields(
    existing as unknown as Record<string, unknown>,
    updateSet as unknown as Record<string, unknown>,
  );
  if (diff.changedKeys.length > 0) {
    await writeProjectAudit(req, {
      projectId,
      eventType: "witness_updated",
      entityType: "project_witness",
      entityId: row.id,
      title: `Witness #${row.position} updated (${diff.changedKeys.join(", ")})`,
      beforeData: diff.before,
      afterData: diff.after,
      metadata: { changedKeys: diff.changedKeys },
    });
  }

  res.json({ witness: row });
});

// DELETE /:projectId/witnesses/:position
router.delete("/:projectId/witnesses/:position", requireRole("admin", "developer"), async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const position = parseInt(String(req.params.position), 10);

  const [existing] = await db
    .select()
    .from(projectWitnessesTable)
    .where(
      and(
        eq(projectWitnessesTable.projectId, projectId),
        eq(projectWitnessesTable.position, position),
      ),
    )
    .limit(1);

  await db
    .delete(projectWitnessesTable)
    .where(
      and(
        eq(projectWitnessesTable.projectId, projectId),
        eq(projectWitnessesTable.position, position),
      ),
    );

  if (existing) {
    await writeProjectAudit(req, {
      projectId,
      eventType: "witness_removed",
      entityType: "project_witness",
      entityId: existing.id,
      title: `Witness #${existing.position} removed: ${existing.fullName}`,
      beforeData: existing as unknown as Record<string, unknown>,
    });
  }

  res.json({ ok: true });
});

export default router;

/**
 * project_parcels.ts — Schedule A CRUD.
 *
 *   GET    /:projectId/parcels                   list (project members)
 *   POST   /:projectId/parcels                   add (admin / developer)
 *   PUT    /:projectId/parcels/:parcelId         update (admin / developer)
 *   DELETE /:projectId/parcels/:parcelId         remove (admin / developer)
 *
 * Every mutation writes one row to the project_audit_trail table.
 */

import { Router } from "express";
import {
  db,
  projectParcelsTable,
  projectsTable,
} from "@workspace/db";
import { and, eq, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { writeProjectAudit, diffFields } from "../lib/projectAuditLogger";

const router = Router();

const ParcelBody = z.object({
  landType: z.enum(["recorded", "non_recorded"]),
  khatianNumber: z.string().optional().nullable(),
  plotNumber: z.string().optional().nullable(),
  mouja: z.string().optional().nullable(),
  tahsil: z.string().optional().nullable(),
  revenueCircle: z.string().optional().nullable(),
  subDivision: z.string().optional().nullable(),
  landAreaName: z.string().optional().nullable(),
  postOffice: z.string().optional().nullable(),
  policeStation: z.string().optional().nullable(),
  village: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  landBoundaryDescription: z.string().optional().nullable(),
  gpsCoordinates: z.string().optional().nullable(),
  landArea: z.number().nonnegative(),
  landAreaUnit: z.string().default("kani"),
  notes: z.string().optional().nullable(),
});

router.get("/:projectId/parcels", async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }
  const rows = await db
    .select()
    .from(projectParcelsTable)
    .where(eq(projectParcelsTable.projectId, projectId))
    .orderBy(asc(projectParcelsTable.position));
  res.set("Cache-Control", "no-store");
  res.json({ parcels: rows });
});

router.post(
  "/:projectId/parcels",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = String(req.params.projectId);
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const parsed = ParcelBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(422)
        .json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }
    const [{ maxPos }] = await db
      .select({
        maxPos: sql<number>`COALESCE(MAX(${projectParcelsTable.position}), 0)`,
      })
      .from(projectParcelsTable)
      .where(eq(projectParcelsTable.projectId, projectId));

    const [row] = await db
      .insert(projectParcelsTable)
      .values({
        projectId,
        position: Number(maxPos) + 1,
        ...parsed.data,
        landAreaUnit: parsed.data.landAreaUnit ?? "kani",
        createdBy: req.dbUserId ?? null,
      })
      .returning();

    await writeProjectAudit(req, {
      projectId,
      eventType: "parcel_added",
      entityType: "project_parcel",
      entityId: row.id,
      title: `Parcel #${row.position} added`,
      afterData: row as unknown as Record<string, unknown>,
    });

    res.status(201).json({ parcel: row });
  },
);

router.put(
  "/:projectId/parcels/:parcelId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = String(req.params.projectId);
    const parcelId = String(req.params.parcelId);

    const parsed = ParcelBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res
        .status(422)
        .json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }

    const [existing] = await db
      .select()
      .from(projectParcelsTable)
      .where(
        and(
          eq(projectParcelsTable.id, parcelId),
          eq(projectParcelsTable.projectId, projectId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Parcel not found" });
      return;
    }

    const [row] = await db
      .update(projectParcelsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(projectParcelsTable.id, parcelId))
      .returning();

    const diff = diffFields(
      existing as unknown as Record<string, unknown>,
      parsed.data as Record<string, unknown>,
    );

    if (diff.changedKeys.length > 0) {
      await writeProjectAudit(req, {
        projectId,
        eventType: "parcel_updated",
        entityType: "project_parcel",
        entityId: row.id,
        title: `Parcel #${row.position} updated (${diff.changedKeys.join(", ")})`,
        beforeData: diff.before,
        afterData: diff.after,
        metadata: { changedKeys: diff.changedKeys },
      });
    }

    res.json({ parcel: row });
  },
);

router.delete(
  "/:projectId/parcels/:parcelId",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = String(req.params.projectId);
    const parcelId = String(req.params.parcelId);

    const [existing] = await db
      .select()
      .from(projectParcelsTable)
      .where(
        and(
          eq(projectParcelsTable.id, parcelId),
          eq(projectParcelsTable.projectId, projectId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Parcel not found" });
      return;
    }

    await db
      .delete(projectParcelsTable)
      .where(eq(projectParcelsTable.id, parcelId));

    await writeProjectAudit(req, {
      projectId,
      eventType: "parcel_removed",
      entityType: "project_parcel",
      entityId: parcelId,
      title: `Parcel #${existing.position} removed`,
      beforeData: existing as unknown as Record<string, unknown>,
    });

    res.json({ ok: true });
  },
);

export default router;

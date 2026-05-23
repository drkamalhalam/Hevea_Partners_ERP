/**
 * project_agreement_template.ts — link a project to its Document Template
 * Registry agreement template.
 *
 *   GET /:projectId/agreement-template
 *     → { template: AgreementTemplate | null }
 *
 *   PUT /:projectId/agreement-template
 *     body: { agreementTemplateId: string | null, reason?: string }
 *     → { project }
 *
 * The linked template MUST have category='agreement' and status='active'
 * at the time of assignment. Setting it to null clears the link.
 *
 * Every successful change writes a project_audit_trail row.
 */

import { Router } from "express";
import {
  db,
  projectsTable,
  agreementTemplatesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireRole, canAccessProject } from "../middlewares/auth";
import { writeProjectAudit } from "../lib/projectAuditLogger";

const router = Router();

router.get("/:projectId/agreement-template", async (req, res) => {
  const projectId = String(req.params.projectId);
  if (!canAccessProject(req, projectId)) {
    res.status(403).json({ error: "Forbidden: no access to this project" });
    return;
  }

  const [project] = await db
    .select({
      id: projectsTable.id,
      agreementTemplateId: projectsTable.agreementTemplateId,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!project.agreementTemplateId) {
    res.json({ template: null });
    return;
  }

  const [tpl] = await db
    .select()
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.id, project.agreementTemplateId))
    .limit(1);

  res.json({ template: tpl ?? null });
});

const AssignBody = z.object({
  agreementTemplateId: z.string().uuid().nullable(),
  reason: z.string().optional(),
});

router.put(
  "/:projectId/agreement-template",
  requireRole("admin", "developer"),
  async (req, res) => {
    const projectId = String(req.params.projectId);
    if (!canAccessProject(req, projectId)) {
      res.status(403).json({ error: "Forbidden: no access to this project" });
      return;
    }
    const parsed = AssignBody.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(422)
        .json({ error: "Validation failed", details: parsed.error.issues });
      return;
    }
    const { agreementTemplateId, reason } = parsed.data;

    const [project] = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        agreementTemplateId: projectsTable.agreementTemplateId,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Validate the template (when non-null)
    if (agreementTemplateId) {
      const [tpl] = await db
        .select({
          id: agreementTemplatesTable.id,
          category: agreementTemplatesTable.category,
          status: agreementTemplatesTable.status,
        })
        .from(agreementTemplatesTable)
        .where(eq(agreementTemplatesTable.id, agreementTemplateId))
        .limit(1);

      if (!tpl) {
        res.status(404).json({ error: "Agreement template not found" });
        return;
      }
      if (tpl.category !== "agreement") {
        res.status(409).json({
          error: `Template category is '${tpl.category}', expected 'agreement'`,
        });
        return;
      }
      if (tpl.status !== "active") {
        res.status(409).json({
          error: `Template status is '${tpl.status}', only 'active' templates may be linked`,
        });
        return;
      }
    }

    const previous = project.agreementTemplateId;
    if (previous === agreementTemplateId) {
      res.json({ project, changed: false });
      return;
    }

    const [updated] = await db
      .update(projectsTable)
      .set({ agreementTemplateId, updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId))
      .returning();

    const eventType = !previous
      ? "agreement_template_assigned"
      : !agreementTemplateId
        ? "agreement_template_cleared"
        : "agreement_template_changed";

    await writeProjectAudit(req, {
      projectId,
      eventType,
      entityType: "agreement_template",
      entityId: agreementTemplateId ?? previous ?? null,
      title:
        eventType === "agreement_template_assigned"
          ? "Agreement template assigned"
          : eventType === "agreement_template_cleared"
            ? "Agreement template cleared"
            : "Agreement template changed",
      beforeData: previous ? { agreementTemplateId: previous } : null,
      afterData: agreementTemplateId ? { agreementTemplateId } : null,
      reason: reason ?? null,
    });

    res.json({ project: updated, changed: true });
  },
);

export default router;

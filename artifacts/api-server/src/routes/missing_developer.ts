import { Router } from "express";
import {
  db,
  projectsTable,
  missingDeveloperCasesTable,
  activityTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import {
  FileMissingDeveloperCaseBody,
  UpdateMissingDeveloperCaseBody,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

const WAITING_PERIOD_DAYS = 45;

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeCountdown(gdEntryDate: string) {
  // Parse as local calendar date (India context) treating as UTC midnight
  const entry = new Date(gdEntryDate + "T00:00:00.000Z");
  const now = new Date();
  const msElapsed = now.getTime() - entry.getTime();
  const daysElapsed = Math.max(0, Math.floor(msElapsed / (1000 * 60 * 60 * 24)));
  const nomineeEligibleAt = new Date(
    entry.getTime() + WAITING_PERIOD_DAYS * 24 * 60 * 60 * 1000,
  );
  const msRemaining = nomineeEligibleAt.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const isNomineeEligible = daysElapsed >= WAITING_PERIOD_DAYS;
  return { daysElapsed, daysRemaining, nomineeEligibleAt: nomineeEligibleAt.toISOString(), isNomineeEligible };
}

function formatCase(c: typeof missingDeveloperCasesTable.$inferSelect) {
  const countdown = computeCountdown(c.gdEntryDate);
  // Auto-advance status in the response when waiting period has elapsed
  const effectiveStatus =
    c.status === "active" && countdown.isNomineeEligible ? "nominee_eligible" : c.status;
  return {
    id: c.id,
    projectId: c.projectId,
    status: effectiveStatus,
    reportedBy: c.reportedBy ?? null,
    reportedByName: c.reportedByName ?? null,
    gdNumber: c.gdNumber ?? null,
    gdDocumentUrl: c.gdDocumentUrl ?? null,
    gdEntryDate: c.gdEntryDate,
    remarks: c.remarks ?? null,
    previousProjectStatus: c.previousProjectStatus ?? null,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    resolvedBy: c.resolvedBy ?? null,
    resolvedByName: c.resolvedByName ?? null,
    resolutionNotes: c.resolutionNotes ?? null,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt?.toISOString() ?? null,
    ...countdown,
  };
}

async function resolveActingUser(clerkUserId: string | null | undefined) {
  if (!clerkUserId) return { id: undefined, name: undefined };
  const [row] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return { id: row?.id, name: row?.displayName ?? undefined };
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /:id/missing-developer — fetch active case (any auth)
router.get("/:id/missing-developer", async (req, res) => {
  const projectId = req.params.id as string;
  try {
    const [activeCase] = await db
      .select()
      .from(missingDeveloperCasesTable)
      .where(
        and(
          eq(missingDeveloperCasesTable.projectId, projectId),
          eq(missingDeveloperCasesTable.isActive, true),
        ),
      )
      .orderBy(desc(missingDeveloperCasesTable.createdAt))
      .limit(1);

    if (!activeCase) {
      res.status(404).json({ error: "No active missing developer case for this project" });
      return;
    }

    res.json(formatCase(activeCase));
  } catch (err) {
    req.log.error({ err }, "Failed to get missing developer case");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/missing-developer — file a case (admin/developer)
router.post("/:id/missing-developer", requireRole("admin", "developer"), async (req, res) => {
  const projectId = req.params.id as string;
  try {
    // Validate project exists
    const [project] = await db
      .select({ id: projectsTable.id, status: projectsTable.status, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Check no active case already exists
    const [existing] = await db
      .select({ id: missingDeveloperCasesTable.id })
      .from(missingDeveloperCasesTable)
      .where(
        and(
          eq(missingDeveloperCasesTable.projectId, projectId),
          eq(missingDeveloperCasesTable.isActive, true),
        ),
      )
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "An active missing developer case already exists for this project" });
      return;
    }

    const parsed = FileMissingDeveloperCaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { gdEntryDate, gdNumber, gdDocumentUrl, remarks } = parsed.data;

    const actor = await resolveActingUser(req.userId);

    // Insert the case record
    const [newCase] = await db
      .insert(missingDeveloperCasesTable)
      .values({
        projectId,
        reportedBy: actor.id ?? null,
        reportedByName: actor.name ?? null,
        gdEntryDate,
        gdNumber: gdNumber ?? null,
        gdDocumentUrl: gdDocumentUrl ?? null,
        remarks: remarks ?? null,
        previousProjectStatus: project.status,
        status: "active",
      })
      .returning();

    // Change project status to missing_developer
    await db
      .update(projectsTable)
      .set({ status: "missing_developer", updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));

    await db.insert(activityTable).values({
      type: "missing_developer_filed",
      description: `Missing developer case filed for ${project.name}. GD entry date: ${gdEntryDate}. 45-day waiting period started.`,
      entityId: projectId,
      entityType: "project",
      projectId,
      userId: actor.id ?? null,
      metadata: { caseId: newCase.id, gdEntryDate, gdNumber: gdNumber ?? null },
    });

    req.log.info({ projectId, caseId: newCase.id, gdEntryDate }, "Missing developer case filed");
    res.status(201).json(formatCase(newCase));
  } catch (err) {
    req.log.error({ err }, "Failed to file missing developer case");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /:id/missing-developer — update remarks or resolve/cancel (admin only)
router.patch("/:id/missing-developer", requireRole("admin"), async (req, res) => {
  const projectId = req.params.id as string;
  try {
    const [activeCase] = await db
      .select()
      .from(missingDeveloperCasesTable)
      .where(
        and(
          eq(missingDeveloperCasesTable.projectId, projectId),
          eq(missingDeveloperCasesTable.isActive, true),
        ),
      )
      .limit(1);

    if (!activeCase) {
      res.status(404).json({ error: "No active missing developer case for this project" });
      return;
    }

    const parsed = UpdateMissingDeveloperCaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
      return;
    }

    const { status, remarks, resolutionNotes } = parsed.data;
    const actor = await resolveActingUser(req.userId);

    const isClosing = status === "resolved" || status === "cancelled";

    const [updated] = await db
      .update(missingDeveloperCasesTable)
      .set({
        ...(status ? { status } : {}),
        ...(remarks !== undefined ? { remarks } : {}),
        ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
        ...(isClosing ? {
          isActive: false,
          resolvedAt: new Date(),
          resolvedBy: actor.id ?? null,
          resolvedByName: actor.name ?? null,
        } : {}),
        updatedAt: new Date(),
      })
      .where(eq(missingDeveloperCasesTable.id, activeCase.id))
      .returning();

    if (isClosing) {
      // Restore the project's previous status
      const restoreStatus = (activeCase.previousProjectStatus as typeof projectsTable.$inferSelect["status"]) ?? "developing";
      await db
        .update(projectsTable)
        .set({ status: restoreStatus, updatedAt: new Date() })
        .where(eq(projectsTable.id, projectId));

      const [project] = await db
        .select({ name: projectsTable.name })
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId))
        .limit(1);

      await db.insert(activityTable).values({
        type: "missing_developer_closed",
        description: `Missing developer case ${status} for ${project?.name ?? projectId}. Project status restored to ${restoreStatus}.`,
        entityId: projectId,
        entityType: "project",
        projectId,
        userId: actor.id ?? null,
        metadata: { caseId: activeCase.id, resolution: status },
      });
    }

    req.log.info({ projectId, caseId: activeCase.id, status }, "Missing developer case updated");
    res.json(formatCase(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update missing developer case");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

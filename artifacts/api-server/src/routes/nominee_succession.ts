import { Router } from "express";
import {
  db,
  nomineeActivationWorkflowsTable,
  missingDeveloperCasesTable,
  projectNomineesTable,
  projectsTable,
  activityTable,
} from "@workspace/db";
import { eq, and, desc, inArray, gte, sql } from "drizzle-orm";

const router = Router();

const ACTIVE_WORKFLOW_STATUSES = ["pending_verification", "pending_otp"] as const;
const WAITING_PERIOD_DAYS = 45;

function computeCountdown(gdEntryDate: string) {
  const entry = new Date(gdEntryDate + "T00:00:00.000Z");
  const now = new Date();
  const msElapsed = now.getTime() - entry.getTime();
  const daysElapsed = Math.max(0, Math.floor(msElapsed / (1000 * 60 * 60 * 24)));
  const nomineeEligibleAt = new Date(entry.getTime() + WAITING_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const msRemaining = nomineeEligibleAt.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const isNomineeEligible = daysElapsed >= WAITING_PERIOD_DAYS;
  return { daysElapsed, daysRemaining, nomineeEligibleAt: nomineeEligibleAt.toISOString(), isNomineeEligible };
}

// ── GET /nominee-succession/dashboard ─────────────────────────────────────────
router.get("/dashboard", async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // All active workflows
    const activeWorkflowRows = await db
      .select({
        id: nomineeActivationWorkflowsTable.id,
        projectId: nomineeActivationWorkflowsTable.projectId,
        nomineeId: nomineeActivationWorkflowsTable.nomineeId,
        nomineeName: nomineeActivationWorkflowsTable.nomineeName,
        activationType: nomineeActivationWorkflowsTable.activationType,
        status: nomineeActivationWorkflowsTable.status,
        governanceRemarks: nomineeActivationWorkflowsTable.governanceRemarks,
        createdBy: nomineeActivationWorkflowsTable.createdBy,
        createdByName: nomineeActivationWorkflowsTable.createdByName,
        createdAt: nomineeActivationWorkflowsTable.createdAt,
        otpSentAt: nomineeActivationWorkflowsTable.otpSentAt,
        otpExpiresAt: nomineeActivationWorkflowsTable.otpExpiresAt,
        projectName: projectsTable.name,
        projectLocation: projectsTable.location,
      })
      .from(nomineeActivationWorkflowsTable)
      .leftJoin(projectsTable, eq(nomineeActivationWorkflowsTable.projectId, projectsTable.id))
      .where(inArray(nomineeActivationWorkflowsTable.status, [...ACTIVE_WORKFLOW_STATUSES]))
      .orderBy(desc(nomineeActivationWorkflowsTable.createdAt));

    // All active missing developer cases
    const missingDevRows = await db
      .select({
        id: missingDeveloperCasesTable.id,
        projectId: missingDeveloperCasesTable.projectId,
        status: missingDeveloperCasesTable.status,
        gdEntryDate: missingDeveloperCasesTable.gdEntryDate,
        gdNumber: missingDeveloperCasesTable.gdNumber,
        gdDocumentUrl: missingDeveloperCasesTable.gdDocumentUrl,
        reportedByName: missingDeveloperCasesTable.reportedByName,
        remarks: missingDeveloperCasesTable.remarks,
        createdAt: missingDeveloperCasesTable.createdAt,
        projectName: projectsTable.name,
        projectLocation: projectsTable.location,
      })
      .from(missingDeveloperCasesTable)
      .leftJoin(projectsTable, eq(missingDeveloperCasesTable.projectId, projectsTable.id))
      .where(eq(missingDeveloperCasesTable.isActive, true))
      .orderBy(desc(missingDeveloperCasesTable.createdAt));

    // Recent activations (last 30 days)
    const recentActivationRows = await db
      .select({
        id: nomineeActivationWorkflowsTable.id,
        projectId: nomineeActivationWorkflowsTable.projectId,
        nomineeName: nomineeActivationWorkflowsTable.nomineeName,
        activationType: nomineeActivationWorkflowsTable.activationType,
        activatedByName: nomineeActivationWorkflowsTable.activatedByName,
        activatedAt: nomineeActivationWorkflowsTable.activatedAt,
        governanceRemarks: nomineeActivationWorkflowsTable.governanceRemarks,
        projectName: projectsTable.name,
      })
      .from(nomineeActivationWorkflowsTable)
      .leftJoin(projectsTable, eq(nomineeActivationWorkflowsTable.projectId, projectsTable.id))
      .where(
        and(
          eq(nomineeActivationWorkflowsTable.status, "activated"),
          gte(nomineeActivationWorkflowsTable.activatedAt, thirtyDaysAgo),
        ),
      )
      .orderBy(desc(nomineeActivationWorkflowsTable.activatedAt))
      .limit(10);

    // Projects with no active nominee
    const allProjects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.isActive, true));

    const projectsWithNominees = await db
      .select({ projectId: projectNomineesTable.projectId })
      .from(projectNomineesTable)
      .where(eq(projectNomineesTable.isActive, true));

    const projectIdsWithNominee = new Set(projectsWithNominees.map((r) => r.projectId));
    const projectsWithoutNominee = allProjects.filter((p) => !projectIdsWithNominee.has(p.id));

    // Process missing dev cases with countdown
    const processedMissingDevCases = missingDevRows.map((c) => {
      const countdown = computeCountdown(c.gdEntryDate);
      const effectiveStatus =
        c.status === "active" && countdown.isNomineeEligible ? "nominee_eligible" : c.status;
      return { ...c, ...countdown, status: effectiveStatus };
    });

    const kpis = {
      totalActiveWorkflows: activeWorkflowRows.length,
      deathBasedPending: activeWorkflowRows.filter((w) => w.activationType === "death_based").length,
      voluntaryHandoverPending: activeWorkflowRows.filter((w) => w.activationType === "voluntary_handover").length,
      missingDeveloperCases: processedMissingDevCases.length,
      nomineeEligibleCases: processedMissingDevCases.filter((c) => c.isNomineeEligible).length,
      recentlyActivated: recentActivationRows.length,
      projectsWithoutNominee: projectsWithoutNominee.length,
    };

    res.json({
      kpis,
      activeWorkflows: activeWorkflowRows,
      missingDeveloperCases: processedMissingDevCases,
      recentActivations: recentActivationRows,
      projectsWithoutNominee,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load nominee succession dashboard");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /nominee-succession/authority-log ─────────────────────────────────────
router.get("/authority-log", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: nomineeActivationWorkflowsTable.id,
        projectId: nomineeActivationWorkflowsTable.projectId,
        nomineeId: nomineeActivationWorkflowsTable.nomineeId,
        nomineeName: nomineeActivationWorkflowsTable.nomineeName,
        activationType: nomineeActivationWorkflowsTable.activationType,
        status: nomineeActivationWorkflowsTable.status,
        deathCertificateUrl: nomineeActivationWorkflowsTable.deathCertificateUrl,
        declarationDeedUrl: nomineeActivationWorkflowsTable.declarationDeedUrl,
        verifiedBy: nomineeActivationWorkflowsTable.verifiedBy,
        verifiedByName: nomineeActivationWorkflowsTable.verifiedByName,
        verifiedAt: nomineeActivationWorkflowsTable.verifiedAt,
        verificationNotes: nomineeActivationWorkflowsTable.verificationNotes,
        otpVerifiedByName: nomineeActivationWorkflowsTable.otpVerifiedByName,
        otpVerifiedAt: nomineeActivationWorkflowsTable.otpVerifiedAt,
        activatedBy: nomineeActivationWorkflowsTable.activatedBy,
        activatedByName: nomineeActivationWorkflowsTable.activatedByName,
        activatedAt: nomineeActivationWorkflowsTable.activatedAt,
        governanceRemarks: nomineeActivationWorkflowsTable.governanceRemarks,
        createdByName: nomineeActivationWorkflowsTable.createdByName,
        createdAt: nomineeActivationWorkflowsTable.createdAt,
        projectName: projectsTable.name,
        projectLocation: projectsTable.location,
      })
      .from(nomineeActivationWorkflowsTable)
      .leftJoin(projectsTable, eq(nomineeActivationWorkflowsTable.projectId, projectsTable.id))
      .where(eq(nomineeActivationWorkflowsTable.status, "activated"))
      .orderBy(desc(nomineeActivationWorkflowsTable.activatedAt));

    res.json(rows.map((r) => ({
      ...r,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      otpVerifiedAt: r.otpVerifiedAt?.toISOString() ?? null,
      activatedAt: r.activatedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to load nominee authority log");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /nominee-succession/missing-developer-cases ───────────────────────────
router.get("/missing-developer-cases", async (req, res) => {
  try {
    const includeResolved = req.query.includeResolved === "true";

    const rows = await db
      .select({
        id: missingDeveloperCasesTable.id,
        projectId: missingDeveloperCasesTable.projectId,
        status: missingDeveloperCasesTable.status,
        gdEntryDate: missingDeveloperCasesTable.gdEntryDate,
        gdNumber: missingDeveloperCasesTable.gdNumber,
        gdDocumentUrl: missingDeveloperCasesTable.gdDocumentUrl,
        reportedBy: missingDeveloperCasesTable.reportedBy,
        reportedByName: missingDeveloperCasesTable.reportedByName,
        remarks: missingDeveloperCasesTable.remarks,
        resolutionNotes: missingDeveloperCasesTable.resolutionNotes,
        resolvedAt: missingDeveloperCasesTable.resolvedAt,
        resolvedByName: missingDeveloperCasesTable.resolvedByName,
        isActive: missingDeveloperCasesTable.isActive,
        createdAt: missingDeveloperCasesTable.createdAt,
        updatedAt: missingDeveloperCasesTable.updatedAt,
        projectName: projectsTable.name,
        projectLocation: projectsTable.location,
      })
      .from(missingDeveloperCasesTable)
      .leftJoin(projectsTable, eq(missingDeveloperCasesTable.projectId, projectsTable.id))
      .where(includeResolved ? undefined : eq(missingDeveloperCasesTable.isActive, true))
      .orderBy(desc(missingDeveloperCasesTable.createdAt));

    const processed = rows.map((c) => {
      const countdown = computeCountdown(c.gdEntryDate);
      const effectiveStatus =
        c.status === "active" && countdown.isNomineeEligible ? "nominee_eligible" : c.status;
      return {
        ...c,
        status: effectiveStatus,
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt?.toISOString() ?? null,
        ...countdown,
      };
    });

    res.json(processed);
  } catch (err) {
    req.log.error({ err }, "Failed to load missing developer cases");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

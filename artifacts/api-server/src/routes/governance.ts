import { Router } from "express";
import {
  db,
  projectsTable,
  agreementsTable,
  partnersTable,
  usersTable,
  userProjectAssignmentsTable,
  projectNomineesTable,
  partnerClaimantsTable,
  missingDeveloperCasesTable,
  maturityDeclarationsTable,
  maturityOtpVerificationsTable,
  nomineeActivationWorkflowsTable,
  projectClosureWorkflowsTable,
  contributionsTable,
} from "@workspace/db";
import { eq, inArray, isNull, and } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";

const router = Router();

type GovernanceSeverity = "attention_required" | "incomplete" | "pending" | "complete";

type GovernanceIssueCode =
  | "MISSING_NOMINEE"
  | "NO_PARTICIPANTS"
  | "NO_AGREEMENTS"
  | "INCOMPLETE_PROFILE"
  | "INCOMPLETE_PARTNER"
  | "NO_CLAIMANTS"
  | "MISSING_DEVELOPER"
  | "REJECTED_CONTRIBUTION"
  | "DISPUTED_CONTRIBUTION"
  | "PENDING_CONTRIBUTIONS";

interface GovernanceAlert {
  code: GovernanceIssueCode;
  severity: GovernanceSeverity;
  message: string;
}

interface ProjectGovernanceStatus {
  projectId: string;
  projectName: string;
  status: GovernanceSeverity;
  issues: GovernanceAlert[];
}

interface PartnerGovernanceStatus {
  partnerId: string;
  partnerName: string;
  status: GovernanceSeverity;
  issues: GovernanceAlert[];
}

function worstSeverity(issues: GovernanceAlert[]): GovernanceSeverity {
  if (issues.some((i) => i.severity === "attention_required")) return "attention_required";
  if (issues.some((i) => i.severity === "incomplete")) return "incomplete";
  if (issues.some((i) => i.severity === "pending")) return "pending";
  return "complete";
}

// GET /governance/summary
router.get("/summary", async (req, res) => {
  try {
    const clerkUserId = req.userId!;

    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (!userRow) {
      res.json({
        overallStatus: "complete",
        totalIssues: 0,
        projectAlerts: [],
        profileAlerts: [],
        partnerAlerts: [],
      });
      return;
    }

    const isAdminOrDev = userRow.role === "admin" || userRow.role === "developer";

    const allProjects = await db.select().from(projectsTable);

    const ownAssignments = isAdminOrDev
      ? []
      : await db
          .select()
          .from(userProjectAssignmentsTable)
          .where(
            and(
              eq(userProjectAssignmentsTable.userId, userRow.id),
              isNull(userProjectAssignmentsTable.revokedAt)
            )
          );

    const assignedProjectIds = new Set(ownAssignments.map((a) => a.projectId));
    const visibleProjects = isAdminOrDev
      ? allProjects
      : allProjects.filter((p) => assignedProjectIds.has(p.id));

    // ── Project-level governance (admin / developer only) ─────────────────
    const projectAlerts: ProjectGovernanceStatus[] = [];

    if (isAdminOrDev && visibleProjects.length > 0) {
      const projectIds = visibleProjects.map((p) => p.id);

      const [nominees, participants, agreements, missingDevCases] = await Promise.all([
        db
          .select({ projectId: projectNomineesTable.projectId })
          .from(projectNomineesTable)
          .where(
            and(
              inArray(projectNomineesTable.projectId, projectIds),
              eq(projectNomineesTable.isActive, true)
            )
          ),
        db
          .select({ projectId: userProjectAssignmentsTable.projectId })
          .from(userProjectAssignmentsTable)
          .where(
            and(
              inArray(userProjectAssignmentsTable.projectId, projectIds),
              isNull(userProjectAssignmentsTable.revokedAt)
            )
          ),
        db
          .select({ projectId: agreementsTable.projectId })
          .from(agreementsTable)
          .where(inArray(agreementsTable.projectId, projectIds)),
        db
          .select({
            projectId: missingDeveloperCasesTable.projectId,
            gdEntryDate: missingDeveloperCasesTable.gdEntryDate,
            status: missingDeveloperCasesTable.status,
          })
          .from(missingDeveloperCasesTable)
          .where(
            and(
              inArray(missingDeveloperCasesTable.projectId, projectIds),
              eq(missingDeveloperCasesTable.isActive, true),
            ),
          ),
      ]);

      const nomineeSet = new Set(nominees.map((n) => n.projectId));
      const participantSet = new Set(participants.map((p) => p.projectId));
      const agreementSet = new Set(agreements.map((a) => a.projectId));

      // Build a map of projectId → missing-dev case for alert messaging
      const missingDevMap = new Map(
        missingDevCases.map((c) => {
          const entry = new Date(c.gdEntryDate + "T00:00:00.000Z");
          const daysElapsed = Math.max(
            0,
            Math.floor((Date.now() - entry.getTime()) / (1000 * 60 * 60 * 24)),
          );
          return [c.projectId, { daysElapsed, status: c.status }];
        }),
      );

      for (const project of visibleProjects) {
        const issues: GovernanceAlert[] = [];

        const mdCase = missingDevMap.get(project.id);
        if (mdCase) {
          const isEligible =
            mdCase.status === "nominee_eligible" || mdCase.daysElapsed >= 45;
          issues.push({
            code: "MISSING_DEVELOPER",
            severity: "attention_required",
            message: isEligible
              ? `Project developer reported missing — nominee now eligible for activation (${mdCase.daysElapsed} days elapsed)`
              : `Project developer reported missing — waiting period active (${mdCase.daysElapsed}/45 days elapsed)`,
          });
        }

        if (!nomineeSet.has(project.id)) {
          issues.push({
            code: "MISSING_NOMINEE",
            severity: "attention_required",
            message: "No governance nominee registered",
          });
        }
        if (!participantSet.has(project.id)) {
          issues.push({
            code: "NO_PARTICIPANTS",
            severity: "incomplete",
            message: "No participants assigned to this project",
          });
        }
        if (!agreementSet.has(project.id)) {
          issues.push({
            code: "NO_AGREEMENTS",
            severity: "incomplete",
            message: "No active agreements linked to this project",
          });
        }

        if (issues.length > 0) {
          projectAlerts.push({
            projectId: project.id,
            projectName: project.name,
            status: worstSeverity(issues),
            issues,
          });
        }
      }
    }

    // ── Profile-level governance ──────────────────────────────────────────
    const profileAlerts: GovernanceAlert[] = [];

    if (!userRow.displayName) {
      profileAlerts.push({
        code: "INCOMPLETE_PROFILE",
        severity: "incomplete",
        message: "Display name not set on your profile",
      });
    }
    if (!userRow.phone) {
      profileAlerts.push({
        code: "INCOMPLETE_PROFILE",
        severity: "incomplete",
        message: "Phone number missing from your profile",
      });
    }
    if (!userRow.address) {
      profileAlerts.push({
        code: "INCOMPLETE_PROFILE",
        severity: "incomplete",
        message: "Address missing from your profile",
      });
    }

    if (userRow.role === "developer") {
      const devAssignments = await db
        .select({ projectId: userProjectAssignmentsTable.projectId })
        .from(userProjectAssignmentsTable)
        .where(
          and(
            eq(userProjectAssignmentsTable.userId, userRow.id),
            isNull(userProjectAssignmentsTable.revokedAt)
          )
        );

      if (devAssignments.length > 0) {
        const devProjectIds = devAssignments.map((a) => a.projectId);
        const existingNominees = await db
          .select({ projectId: projectNomineesTable.projectId })
          .from(projectNomineesTable)
          .where(
            and(
              inArray(projectNomineesTable.projectId, devProjectIds),
              eq(projectNomineesTable.isActive, true)
            )
          );

        const nomineeSet = new Set(existingNominees.map((n) => n.projectId));
        for (const { projectId } of devAssignments) {
          if (!nomineeSet.has(projectId)) {
            const project =
              visibleProjects.find((p) => p.id === projectId) ??
              allProjects.find((p) => p.id === projectId);
            profileAlerts.push({
              code: "MISSING_NOMINEE",
              severity: "attention_required",
              message: `Missing governance nominee for: ${project?.name ?? projectId}`,
            });
          }
        }
      }
    }

    // ── Partner-level governance (admin / developer only) ─────────────────
    const partnerAlerts: PartnerGovernanceStatus[] = [];

    if (isAdminOrDev && visibleProjects.length > 0) {
      const projectIds = visibleProjects.map((p) => p.id);
      const relevantAgreements = await db
        .select({
          landOwnerId: agreementsTable.landOwnerId,
          projectDeveloperId: agreementsTable.projectDeveloperId,
        })
        .from(agreementsTable)
        .where(inArray(agreementsTable.projectId, projectIds));

      const partnerIdSet = new Set<string>();
      for (const a of relevantAgreements) {
        if (a.landOwnerId) partnerIdSet.add(a.landOwnerId);
        if (a.projectDeveloperId) partnerIdSet.add(a.projectDeveloperId);
      }

      const partnerIds = [...partnerIdSet];
      if (partnerIds.length > 0) {
        const [allPartners, allClaimants] = await Promise.all([
          db
            .select()
            .from(partnersTable)
            .where(inArray(partnersTable.id, partnerIds)),
          db
            .select({ partnerId: partnerClaimantsTable.partnerId })
            .from(partnerClaimantsTable)
            .where(
              and(
                inArray(partnerClaimantsTable.partnerId, partnerIds),
                eq(partnerClaimantsTable.isActive, true)
              )
            ),
        ]);

        const claimantPartnerIds = new Set(allClaimants.map((c) => c.partnerId));

        for (const partner of allPartners) {
          if (!partner.isActive) continue;
          const issues: GovernanceAlert[] = [];

          if (!partner.phone || !partner.address) {
            issues.push({
              code: "INCOMPLETE_PARTNER",
              severity: "incomplete",
              message: "Partner contact information incomplete (phone / address)",
            });
          }
          if (!claimantPartnerIds.has(partner.id)) {
            issues.push({
              code: "NO_CLAIMANTS",
              severity: "incomplete",
              message: "No claimants registered for this partner",
            });
          }

          if (issues.length > 0) {
            partnerAlerts.push({
              partnerId: partner.id,
              partnerName: partner.name,
              status: worstSeverity(issues),
              issues,
            });
          }
        }
      }
    }

    // ── Rejected economic contributions (admin / developer) ───────────────
    // Each project with at least one rejected economic_investment contribution
    // surfaces a red governance alert so partners can request re-approval.
    if (isAdminOrDev && visibleProjects.length > 0) {
      const projectIds = visibleProjects.map((p) => p.id);
      const rejectedContribs = await db
        .select({
          projectId: contributionsTable.projectId,
        })
        .from(contributionsTable)
        .where(
          and(
            inArray(contributionsTable.projectId, projectIds),
            eq(contributionsTable.contributionType, "economic_investment"),
            eq(contributionsTable.verificationStatus, "rejected"),
            isNull(contributionsTable.deletedAt),
          ),
        );

      const rejectedByProject = new Map<string, number>();
      for (const r of rejectedContribs) {
        rejectedByProject.set(r.projectId, (rejectedByProject.get(r.projectId) ?? 0) + 1);
      }

      for (const [pid, count] of rejectedByProject.entries()) {
        const existing = projectAlerts.find((p) => p.projectId === pid);
        const alert: GovernanceAlert = {
          code: "REJECTED_CONTRIBUTION",
          severity: "attention_required",
          message: `${count} economic contribution${count > 1 ? "s have" : " has"} been rejected and require${count > 1 ? "" : "s"} resolution`,
        };
        if (existing) {
          existing.issues.push(alert);
          existing.status = worstSeverity(existing.issues);
        } else {
          const proj = visibleProjects.find((p) => p.id === pid);
          if (proj) {
            projectAlerts.push({
              projectId: pid,
              projectName: proj.name,
              status: "attention_required",
              issues: [alert],
            });
          }
        }
      }
    }

    // ── Disputed contributions (admin / developer) ────────────────────────
    // Projects with ANY disputed contribution raise an attention_required alert.
    // Disputed contributions also block lifecycle transition to mature_production.
    if (isAdminOrDev && visibleProjects.length > 0) {
      const projectIds = visibleProjects.map((p) => p.id);
      const disputedContribs = await db
        .select({ projectId: contributionsTable.projectId })
        .from(contributionsTable)
        .where(
          and(
            inArray(contributionsTable.projectId, projectIds),
            eq(contributionsTable.verificationStatus, "disputed"),
            isNull(contributionsTable.deletedAt),
          ),
        );

      const disputedByProject = new Map<string, number>();
      for (const r of disputedContribs) {
        disputedByProject.set(r.projectId, (disputedByProject.get(r.projectId) ?? 0) + 1);
      }

      for (const [pid, count] of disputedByProject.entries()) {
        const existing = projectAlerts.find((p) => p.projectId === pid);
        const alert: GovernanceAlert = {
          code: "DISPUTED_CONTRIBUTION",
          severity: "attention_required",
          message: `${count} contribution${count > 1 ? "s are" : " is"} disputed — maturity declaration is blocked until resolved`,
        };
        if (existing) {
          existing.issues.push(alert);
          existing.status = worstSeverity(existing.issues);
        } else {
          const proj = visibleProjects.find((p) => p.id === pid);
          if (proj) {
            projectAlerts.push({
              projectId: pid,
              projectName: proj.name,
              status: "attention_required",
              issues: [alert],
            });
          }
        }
      }
    }

    // ── Projects with many pending contributions (admin / developer) ──────
    // Projects with 3+ pending_verification contributions get an "incomplete"
    // alert so admins know they have a verification backlog.
    if (isAdminOrDev && visibleProjects.length > 0) {
      const projectIds = visibleProjects.map((p) => p.id);
      const pendingContribs = await db
        .select({ projectId: contributionsTable.projectId })
        .from(contributionsTable)
        .where(
          and(
            inArray(contributionsTable.projectId, projectIds),
            eq(contributionsTable.verificationStatus, "pending_verification"),
            isNull(contributionsTable.deletedAt),
          ),
        );

      const pendingByProject = new Map<string, number>();
      for (const r of pendingContribs) {
        pendingByProject.set(r.projectId, (pendingByProject.get(r.projectId) ?? 0) + 1);
      }

      for (const [pid, count] of pendingByProject.entries()) {
        if (count < 3) continue; // only surface significant backlogs
        const existing = projectAlerts.find((p) => p.projectId === pid);
        const alert: GovernanceAlert = {
          code: "PENDING_CONTRIBUTIONS",
          severity: "incomplete",
          message: `${count} contribution${count > 1 ? "s are" : " is"} awaiting verification`,
        };
        if (existing) {
          existing.issues.push(alert);
          existing.status = worstSeverity(existing.issues);
        } else {
          const proj = visibleProjects.find((p) => p.id === pid);
          if (proj) {
            projectAlerts.push({
              projectId: pid,
              projectName: proj.name,
              status: "incomplete",
              issues: [alert],
            });
          }
        }
      }
    }

    // ── Overall status ────────────────────────────────────────────────────
    const allIssues = [
      ...projectAlerts.flatMap((p) => p.issues),
      ...profileAlerts,
      ...partnerAlerts.flatMap((p) => p.issues),
    ];
    const totalIssues = allIssues.length;
    const overallStatus: GovernanceSeverity =
      totalIssues === 0
        ? "complete"
        : allIssues.some((i) => i.severity === "attention_required")
        ? "attention_required"
        : "incomplete";

    res.json({ overallStatus, totalIssues, projectAlerts, profileAlerts, partnerAlerts });
  } catch (err) {
    req.log.error({ err }, "Failed to compute governance summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /governance/tasks  (admin / developer only)
router.get("/tasks", requireRole("admin", "developer"), async (req, res) => {
  try {
    const clerkUserId = req.userId!;

    const [userRow] = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (!userRow) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const isAdminOrDev = userRow.role === "admin" || userRow.role === "developer";
    if (!isAdminOrDev) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const allProjects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
      .from(projectsTable);

    const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));

    // Lifecycle breakdown
    const lifecycleBreakdown = {
      prematurity: allProjects.filter((p) => p.lifecycleStatus === "prematurity").length,
      mature_production: allProjects.filter((p) => p.lifecycleStatus === "mature_production").length,
      closed: allProjects.filter((p) => p.lifecycleStatus === "closed").length,
      total: allProjects.length,
    };

    // Pending maturity declarations (status = pending_otp)
    const rawDeclarations = await db
      .select({
        id: maturityDeclarationsTable.id,
        projectId: maturityDeclarationsTable.projectId,
        status: maturityDeclarationsTable.status,
        initiatedByName: maturityDeclarationsTable.initiatedByName,
        createdAt: maturityDeclarationsTable.createdAt,
      })
      .from(maturityDeclarationsTable)
      .where(eq(maturityDeclarationsTable.status, "pending_otp"));

    let verificationCounts: Array<{ declarationId: string; status: string }> = [];
    if (rawDeclarations.length > 0) {
      const declarationIds = rawDeclarations.map((d) => d.id);
      verificationCounts = await db
        .select({
          declarationId: maturityOtpVerificationsTable.declarationId,
          status: maturityOtpVerificationsTable.status,
        })
        .from(maturityOtpVerificationsTable)
        .where(inArray(maturityOtpVerificationsTable.declarationId, declarationIds));
    }

    const verCountMap = new Map<string, { total: number; verified: number }>();
    for (const v of verificationCounts) {
      const entry = verCountMap.get(v.declarationId) ?? { total: 0, verified: 0 };
      entry.total += 1;
      if (v.status === "verified") entry.verified += 1;
      verCountMap.set(v.declarationId, entry);
    }

    const pendingMaturityDeclarations = rawDeclarations.map((d) => ({
      declarationId: d.id,
      projectId: d.projectId,
      projectName: projectMap.get(d.projectId) ?? d.projectId,
      status: d.status,
      initiatedByName: d.initiatedByName,
      createdAt: d.createdAt,
      totalVerifications: verCountMap.get(d.id)?.total ?? 0,
      verifiedCount: verCountMap.get(d.id)?.verified ?? 0,
    }));

    // Pending nominee activations
    const rawNomineeActivations = await db
      .select({
        id: nomineeActivationWorkflowsTable.id,
        projectId: nomineeActivationWorkflowsTable.projectId,
        activationType: nomineeActivationWorkflowsTable.activationType,
        status: nomineeActivationWorkflowsTable.status,
        createdAt: nomineeActivationWorkflowsTable.createdAt,
      })
      .from(nomineeActivationWorkflowsTable)
      .where(
        inArray(nomineeActivationWorkflowsTable.status, ["pending_verification", "pending_otp"])
      );

    const pendingNomineeActivations = rawNomineeActivations.map((w) => ({
      workflowId: w.id,
      projectId: w.projectId,
      projectName: projectMap.get(w.projectId) ?? w.projectId,
      activationType: w.activationType,
      status: w.status,
      createdAt: w.createdAt,
    }));

    // Pending closure acknowledgments
    const rawClosureWorkflows = await db
      .select({
        id: projectClosureWorkflowsTable.id,
        projectId: projectClosureWorkflowsTable.projectId,
        status: projectClosureWorkflowsTable.status,
        initiatedByName: projectClosureWorkflowsTable.initiatedByName,
        initiatedAt: projectClosureWorkflowsTable.initiatedAt,
      })
      .from(projectClosureWorkflowsTable)
      .where(
        inArray(projectClosureWorkflowsTable.status, ["pending_acknowledgment", "acknowledged"])
      );

    const pendingClosureAcknowledgments = rawClosureWorkflows.map((w) => ({
      workflowId: w.id,
      projectId: w.projectId,
      projectName: projectMap.get(w.projectId) ?? w.projectId,
      status: w.status,
      initiatedByName: w.initiatedByName,
      initiatedAt: w.initiatedAt,
    }));

    // Active missing developer cases
    const rawMissingDevCases = await db
      .select({
        id: missingDeveloperCasesTable.id,
        projectId: missingDeveloperCasesTable.projectId,
        status: missingDeveloperCasesTable.status,
        gdEntryDate: missingDeveloperCasesTable.gdEntryDate,
      })
      .from(missingDeveloperCasesTable)
      .where(eq(missingDeveloperCasesTable.isActive, true));

    const missingDeveloperCases = rawMissingDevCases.map((c) => {
      const entry = new Date(c.gdEntryDate + "T00:00:00.000Z");
      const daysElapsed = Math.max(
        0,
        Math.floor((Date.now() - entry.getTime()) / (1000 * 60 * 60 * 24))
      );
      const daysRemaining = Math.max(0, 45 - daysElapsed);
      const isNomineeEligible = c.status === "nominee_eligible" || daysElapsed >= 45;
      return {
        caseId: c.id,
        projectId: c.projectId,
        projectName: projectMap.get(c.projectId) ?? c.projectId,
        status: c.status,
        gdEntryDate: c.gdEntryDate,
        daysElapsed,
        daysRemaining,
        isNomineeEligible,
      };
    });

    res.json({
      lifecycleBreakdown,
      pendingMaturityDeclarations,
      pendingNomineeActivations,
      pendingClosureAcknowledgments,
      missingDeveloperCases,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch governance tasks");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;


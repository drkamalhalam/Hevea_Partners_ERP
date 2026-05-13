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
} from "@workspace/db";
import { eq, inArray, isNull, and } from "drizzle-orm";

const router = Router();

type GovernanceSeverity = "attention_required" | "incomplete" | "pending" | "complete";

type GovernanceIssueCode =
  | "MISSING_NOMINEE"
  | "NO_PARTICIPANTS"
  | "NO_AGREEMENTS"
  | "INCOMPLETE_PROFILE"
  | "INCOMPLETE_PARTNER"
  | "NO_CLAIMANTS";

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

      const [nominees, participants, agreements] = await Promise.all([
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
      ]);

      const nomineeSet = new Set(nominees.map((n) => n.projectId));
      const participantSet = new Set(participants.map((p) => p.projectId));
      const agreementSet = new Set(agreements.map((a) => a.projectId));

      for (const project of visibleProjects) {
        const issues: GovernanceAlert[] = [];

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

export default router;

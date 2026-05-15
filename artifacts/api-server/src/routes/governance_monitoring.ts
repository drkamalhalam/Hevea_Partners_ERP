/**
 * governance_monitoring.ts
 *
 * Governance monitoring endpoints — aggregate alerts, unified timeline,
 * and task dashboard for ownership continuity and succession workflows.
 *
 * GET /governance-monitoring/alerts   — all live alerts by category + severity
 * GET /governance-monitoring/timeline — unified chronological event history
 * GET /governance-monitoring/tasks    — actionable tasks grouped by urgency
 */

import { Router } from "express";
import {
  db,
  ownershipTransfersTable,
  transferOtpEventsTable,
  transferAuditEventsTable,
  partnerOwnershipStatesTable,
  projectNomineesTable,
  projectsTable,
  partnersTable,
  inheritanceClaimsTable,
  inheritanceClaimantSharesTable,
  inheritanceDocumentsTable,
  inheritanceOwnershipHistoryTable,
  nomineeActivationWorkflowsTable,
  missingDeveloperCasesTable,
  ownershipSnapshotsTable,
  governanceOverridesTable,
  disputesTable,
  auditLogsTable,
  settlementRecordsTable,
  maturityDeclarationsTable,
  documentsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, gt, ne, inArray, notInArray, desc, isNull, not, isNotNull, or, sql, lt, count, gte, lte, asc } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";

const router = Router();

// ── All routes: admin / developer only ────────────────────────────────────────
router.use(requireRole("admin", "developer"));

// ── Constants ──────────────────────────────────────────────────────────────────
const TERMINAL_STATUSES = ["executed", "cancelled", "expired"] as const;
const ACTIVE_TRANSFER_STATUSES = [
  "draft",
  "pending_rofr",
  "rofr_accepted",
  "rofr_rejected",
  "pending_approval",
  "approved",
] as const;

// ── GET /governance-monitoring/alerts ─────────────────────────────────────────

router.get("/alerts", async (req, res) => {
  try {
    const now = new Date();

    // ── 1. Pending transfer OTPs ────────────────────────────────────────────
    const pendingOtpRows = await db
      .select({
        id: transferOtpEventsTable.id,
        transferId: transferOtpEventsTable.transferId,
        recipientName: transferOtpEventsTable.recipientName,
        purpose: transferOtpEventsTable.purpose,
        expiresAt: transferOtpEventsTable.expiresAt,
        createdAt: transferOtpEventsTable.createdAt,
        projectId: ownershipTransfersTable.projectId,
        projectName: projectsTable.name,
        transferorName: ownershipTransfersTable.transferorName,
        transferType: ownershipTransfersTable.transferType,
        offeredPercentage: ownershipTransfersTable.offeredPercentage,
      })
      .from(transferOtpEventsTable)
      .leftJoin(ownershipTransfersTable, eq(transferOtpEventsTable.transferId, ownershipTransfersTable.id))
      .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
      .where(
        and(
          eq(transferOtpEventsTable.status, "pending"),
          gt(transferOtpEventsTable.expiresAt, now),
          eq(transferOtpEventsTable.isActive, true),
        ),
      );

    // ── 2. Ownership disputes (partnerOwnershipStates with disputed % > 0) ──
    const disputeRows = await db
      .select({
        id: partnerOwnershipStatesTable.id,
        projectId: partnerOwnershipStatesTable.projectId,
        projectName: projectsTable.name,
        partnerName: partnerOwnershipStatesTable.partnerName,
        disputedPercentage: partnerOwnershipStatesTable.disputedPercentage,
        disputeReason: partnerOwnershipStatesTable.disputeReason,
        disputedSince: partnerOwnershipStatesTable.disputedSince,
        disputeReference: partnerOwnershipStatesTable.disputeReference,
        updatedAt: partnerOwnershipStatesTable.updatedAt,
      })
      .from(partnerOwnershipStatesTable)
      .leftJoin(projectsTable, eq(partnerOwnershipStatesTable.projectId, projectsTable.id))
      .where(gt(partnerOwnershipStatesTable.disputedPercentage, "0"));

    // ── 3. Missing nominee: active projects with no active nominee ──────────
    const allActiveProjects = await db
      .select({ id: projectsTable.id, name: projectsTable.name, lifecycleStatus: projectsTable.lifecycleStatus })
      .from(projectsTable)
      .where(eq(projectsTable.isActive, true));

    const projectsWithNominee = await db
      .select({ projectId: projectNomineesTable.projectId })
      .from(projectNomineesTable)
      .where(eq(projectNomineesTable.isActive, true));

    const nomineeProjectIds = new Set(projectsWithNominee.map((r) => r.projectId));
    const missingNomineeProjects = allActiveProjects.filter((p) => !nomineeProjectIds.has(p.id));

    // ── 4. Inheritance claims with pending governance actions ───────────────
    const openClaims = await db
      .select({
        id: inheritanceClaimsTable.id,
        projectId: inheritanceClaimsTable.projectId,
        projectName: projectsTable.name,
        status: inheritanceClaimsTable.status,
        claimType: inheritanceClaimsTable.claimType,
        initiatedByName: inheritanceClaimsTable.initiatedByName,
        description: inheritanceClaimsTable.description,
        createdAt: inheritanceClaimsTable.createdAt,
        updatedAt: inheritanceClaimsTable.updatedAt,
      })
      .from(inheritanceClaimsTable)
      .leftJoin(projectsTable, eq(inheritanceClaimsTable.projectId, projectsTable.id))
      .where(
        and(
          eq(inheritanceClaimsTable.isActive, true),
          notInArray(inheritanceClaimsTable.status, ["settled", "rejected"]),
        ),
      )
      .orderBy(desc(inheritanceClaimsTable.createdAt));

    // ── 5. Pending inheritance document verifications ───────────────────────
    const pendingDocs = await db
      .select({
        id: inheritanceDocumentsTable.id,
        claimId: inheritanceDocumentsTable.claimId,
        documentType: inheritanceDocumentsTable.documentType,
        verificationStatus: inheritanceDocumentsTable.verificationStatus,
        uploadedByName: inheritanceDocumentsTable.uploadedByName,
        createdAt: inheritanceDocumentsTable.createdAt,
        projectId: inheritanceClaimsTable.projectId,
        projectName: projectsTable.name,
        claimType: inheritanceClaimsTable.claimType,
      })
      .from(inheritanceDocumentsTable)
      .leftJoin(inheritanceClaimsTable, eq(inheritanceDocumentsTable.claimId, inheritanceClaimsTable.id))
      .leftJoin(projectsTable, eq(inheritanceClaimsTable.projectId, projectsTable.id))
      .where(
        and(
          eq(inheritanceDocumentsTable.verificationStatus, "pending"),
          eq(inheritanceDocumentsTable.isActive, true),
        ),
      )
      .orderBy(desc(inheritanceDocumentsTable.createdAt));

    // ── 6. Pending share proposals (need approval) ──────────────────────────
    const pendingShares = await db
      .select({
        id: inheritanceClaimantSharesTable.id,
        claimId: inheritanceClaimantSharesTable.claimId,
        claimantId: inheritanceClaimantSharesTable.claimantId,
        proposedSharePct: inheritanceClaimantSharesTable.proposedSharePct,
        status: inheritanceClaimantSharesTable.status,
        createdAt: inheritanceClaimantSharesTable.createdAt,
        projectId: inheritanceClaimsTable.projectId,
        projectName: projectsTable.name,
      })
      .from(inheritanceClaimantSharesTable)
      .leftJoin(inheritanceClaimsTable, eq(inheritanceClaimantSharesTable.claimId, inheritanceClaimsTable.id))
      .leftJoin(projectsTable, eq(inheritanceClaimsTable.projectId, projectsTable.id))
      .where(eq(inheritanceClaimantSharesTable.status, "proposed"))
      .orderBy(desc(inheritanceClaimantSharesTable.createdAt));

    // ── 7. Invalid transfer conditions ──────────────────────────────────────
    // Transfers in active statuses that may have conditions issues:
    // a) Third-party without ROFR completed (rofr_rejected)
    // b) Approved transfers with paidAmount = 0 and payableAmount > 0 (unpaid)
    // c) ROFR deadline expired but still pending_rofr
    const activeTransfers = await db
      .select({
        id: ownershipTransfersTable.id,
        projectId: ownershipTransfersTable.projectId,
        projectName: projectsTable.name,
        status: ownershipTransfersTable.status,
        transferType: ownershipTransfersTable.transferType,
        transferorName: ownershipTransfersTable.transferorName,
        buyerName: ownershipTransfersTable.buyerName,
        offeredPercentage: ownershipTransfersTable.offeredPercentage,
        offeredValue: ownershipTransfersTable.offeredValue,
        payableAmount: ownershipTransfersTable.payableAmount,
        paidAmount: ownershipTransfersTable.paidAmount,
        rofrDeadline: ownershipTransfersTable.rofrDeadline,
        linkedSnapshotId: ownershipTransfersTable.linkedSnapshotId,
        createdAt: ownershipTransfersTable.createdAt,
        updatedAt: ownershipTransfersTable.updatedAt,
        approvedAt: ownershipTransfersTable.approvedAt,
      })
      .from(ownershipTransfersTable)
      .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
      .where(
        and(
          eq(ownershipTransfersTable.isActive, true),
          inArray(ownershipTransfersTable.status, [...ACTIVE_TRANSFER_STATUSES]),
        ),
      )
      .orderBy(desc(ownershipTransfersTable.updatedAt));

    // ── 8. Missing developer cases approaching / past 45-day threshold ───────
    const missingDevCases = await db
      .select({
        id: missingDeveloperCasesTable.id,
        projectId: missingDeveloperCasesTable.projectId,
        projectName: projectsTable.name,
        gdEntryDate: missingDeveloperCasesTable.gdEntryDate,
        gdNumber: missingDeveloperCasesTable.gdNumber,
        status: missingDeveloperCasesTable.status,
        reportedByName: missingDeveloperCasesTable.reportedByName,
        createdAt: missingDeveloperCasesTable.createdAt,
      })
      .from(missingDeveloperCasesTable)
      .leftJoin(projectsTable, eq(missingDeveloperCasesTable.projectId, projectsTable.id))
      .where(eq(missingDeveloperCasesTable.isActive, true))
      .orderBy(desc(missingDeveloperCasesTable.createdAt));

    // ── Build alert list ────────────────────────────────────────────────────
    type AlertSeverity = "critical" | "high" | "medium" | "low";
    type AlertCategory =
      | "transfer_otp"
      | "ownership_dispute"
      | "missing_nominee"
      | "inheritance_verification"
      | "missing_document"
      | "invalid_transfer"
      | "missing_developer"
      | "pending_share_approval";

    interface GovernanceAlert {
      id: string;
      category: AlertCategory;
      severity: AlertSeverity;
      title: string;
      description: string;
      projectId: string | null;
      projectName: string | null;
      entityId: string;
      entityType: string;
      actionPath: string;
      createdAt: string;
      daysOpen: number;
      metadata: Record<string, unknown>;
    }

    const alerts: GovernanceAlert[] = [];
    const daysSince = (d: Date | string | null | undefined): number => {
      if (!d) return 0;
      return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
    };

    // Transfer OTPs
    for (const otp of pendingOtpRows) {
      const minutesLeft = Math.floor((new Date(otp.expiresAt).getTime() - Date.now()) / 60000);
      alerts.push({
        id: `otp-${otp.id}`,
        category: "transfer_otp",
        severity: minutesLeft < 5 ? "critical" : "high",
        title: "Transfer OTP Awaiting Verification",
        description: `OTP for ${otp.purpose?.replace(/_/g, " ")} sent to ${otp.recipientName}. Transfer: ${otp.transferorName} → ${otp.transferType} (${parseFloat(otp.offeredPercentage ?? "0").toFixed(2)}%). Expires in ${minutesLeft} min.`,
        projectId: otp.projectId ?? null,
        projectName: otp.projectName ?? null,
        entityId: otp.transferId,
        entityType: "transfer",
        actionPath: "/ownership-transfers",
        createdAt: otp.createdAt.toISOString(),
        daysOpen: daysSince(otp.createdAt),
        metadata: { purpose: otp.purpose, recipientName: otp.recipientName, minutesLeft },
      });
    }

    // Ownership disputes
    for (const d of disputeRows) {
      const days = daysSince(d.disputedSince ?? d.updatedAt);
      alerts.push({
        id: `dispute-${d.id}`,
        category: "ownership_dispute",
        severity: days > 30 ? "critical" : days > 14 ? "high" : "medium",
        title: "Ownership Dispute Unresolved",
        description: `${d.partnerName} has ${parseFloat(d.disputedPercentage ?? "0").toFixed(4)}% ownership in dispute${d.disputeReason ? `: ${d.disputeReason}` : ""}. Project: ${d.projectName ?? "Unknown"}.`,
        projectId: d.projectId ?? null,
        projectName: d.projectName ?? null,
        entityId: d.id,
        entityType: "partner_state",
        actionPath: "/ownership-state-manager",
        createdAt: (d.disputedSince ?? d.updatedAt).toISOString(),
        daysOpen: days,
        metadata: { disputedPct: d.disputedPercentage, reference: d.disputeReference },
      });
    }

    // Missing nominees
    for (const proj of missingNomineeProjects) {
      alerts.push({
        id: `no-nominee-${proj.id}`,
        category: "missing_nominee",
        severity: proj.lifecycleStatus === "mature_production" ? "critical" : "high",
        title: "No Active Nominee Registered",
        description: `Project "${proj.name}" (${proj.lifecycleStatus?.replace(/_/g, " ") ?? "unknown"}) has no active governance nominee. Succession authority cannot be transferred without one.`,
        projectId: proj.id,
        projectName: proj.name,
        entityId: proj.id,
        entityType: "project",
        actionPath: "/nominee-succession",
        createdAt: new Date().toISOString(),
        daysOpen: 0,
        metadata: { lifecycleStatus: proj.lifecycleStatus },
      });
    }

    // Open inheritance claims
    for (const claim of openClaims) {
      const days = daysSince(claim.createdAt);
      const severity: AlertSeverity =
        claim.status === "open" && days > 60 ? "critical" :
        claim.status === "open" ? "high" :
        "medium";
      alerts.push({
        id: `claim-${claim.id}`,
        category: "inheritance_verification",
        severity,
        title: `Inheritance Claim — ${claim.status?.replace(/_/g, " ")}`,
        description: `${claim.claimType?.replace(/_/g, " ")} claim for project "${claim.projectName ?? "Unknown"}". Filed by ${claim.initiatedByName ?? "Unknown"}${claim.description ? ": " + claim.description.substring(0, 80) : ""}. Open for ${days} day(s).`,
        projectId: claim.projectId ?? null,
        projectName: claim.projectName ?? null,
        entityId: claim.id,
        entityType: "inheritance_claim",
        actionPath: "/inheritance-claims",
        createdAt: claim.createdAt.toISOString(),
        daysOpen: days,
        metadata: { status: claim.status, claimType: claim.claimType },
      });
    }

    // Pending documents
    for (const doc of pendingDocs) {
      const days = daysSince(doc.createdAt);
      alerts.push({
        id: `doc-${doc.id}`,
        category: "missing_document",
        severity: days > 14 ? "high" : "medium",
        title: "Inheritance Document Pending Verification",
        description: `${doc.documentType?.replace(/_/g, " ")} submitted by ${doc.uploadedByName ?? "Unknown"} for ${doc.claimType?.replace(/_/g, " ")} claim in "${doc.projectName ?? "Unknown"}". Awaiting verification for ${days} day(s).`,
        projectId: doc.projectId ?? null,
        projectName: doc.projectName ?? null,
        entityId: doc.claimId,
        entityType: "inheritance_claim",
        actionPath: "/inheritance-claims",
        createdAt: doc.createdAt.toISOString(),
        daysOpen: days,
        metadata: { documentType: doc.documentType, claimId: doc.claimId },
      });
    }

    // Pending share approvals
    for (const share of pendingShares) {
      const days = daysSince(share.createdAt);
      alerts.push({
        id: `share-${share.id}`,
        category: "pending_share_approval",
        severity: "medium",
        title: "Share Proposal Awaiting Approval",
        description: `${parseFloat(share.proposedSharePct ?? "0").toFixed(4)}% proposed for claimant in project "${share.projectName ?? "Unknown"}". Pending admin approval for ${days} day(s).`,
        projectId: share.projectId ?? null,
        projectName: share.projectName ?? null,
        entityId: share.claimId,
        entityType: "inheritance_claim",
        actionPath: "/inheritance-claims",
        createdAt: share.createdAt.toISOString(),
        daysOpen: days,
        metadata: { proposedSharePct: share.proposedSharePct, claimantId: share.claimantId },
      });
    }

    // Invalid / stalled transfer conditions
    for (const t of activeTransfers) {
      const days = daysSince(t.updatedAt);
      const issues: string[] = [];

      // ROFR deadline passed but still pending_rofr
      if (t.status === "pending_rofr" && t.rofrDeadline && new Date(t.rofrDeadline) < now) {
        const overdueDays = daysSince(t.rofrDeadline);
        issues.push(`ROFR deadline passed ${overdueDays} day(s) ago`);
        alerts.push({
          id: `transfer-rofr-overdue-${t.id}`,
          category: "invalid_transfer",
          severity: "critical",
          title: "ROFR Period Expired — Transfer Stalled",
          description: `Transfer from ${t.transferorName} to ${t.buyerName} (${parseFloat(t.offeredPercentage ?? "0").toFixed(2)}% in "${t.projectName ?? "Unknown"}") is past its ROFR deadline by ${overdueDays} day(s). Requires finalization or cancellation.`,
          projectId: t.projectId ?? null,
          projectName: t.projectName ?? null,
          entityId: t.id,
          entityType: "transfer",
          actionPath: "/ownership-transfers",
          createdAt: t.createdAt.toISOString(),
          daysOpen: daysSince(t.createdAt),
          metadata: { status: t.status, rofrDeadline: t.rofrDeadline, overdueDays },
        });
      }

      // Approved but unpaid third-party transfer
      if (
        t.status === "approved" &&
        t.transferType === "third_party" &&
        t.payableAmount &&
        parseFloat(t.payableAmount) > 0 &&
        parseFloat(t.paidAmount ?? "0") === 0
      ) {
        const approvalDays = daysSince(t.approvedAt);
        alerts.push({
          id: `transfer-unpaid-${t.id}`,
          category: "invalid_transfer",
          severity: approvalDays > 7 ? "high" : "medium",
          title: "Approved Transfer — Payment Not Received",
          description: `Third-party transfer from ${t.transferorName} to ${t.buyerName} approved ${approvalDays} day(s) ago. Payable ₹${Number(t.payableAmount).toLocaleString("en-IN")} — ₹0 paid. Cannot execute without payment confirmation.`,
          projectId: t.projectId ?? null,
          projectName: t.projectName ?? null,
          entityId: t.id,
          entityType: "transfer",
          actionPath: "/ownership-transfers",
          createdAt: t.createdAt.toISOString(),
          daysOpen: daysSince(t.createdAt),
          metadata: { payableAmount: t.payableAmount, paidAmount: t.paidAmount, approvalDays },
        });
      }

      // Long-stalled active transfer (>30 days with no movement)
      if (!TERMINAL_STATUSES.includes(t.status as any) && days > 30 && t.status !== "executed") {
        const alreadyAlerted = alerts.some(
          (a) => a.entityId === t.id && a.category === "invalid_transfer",
        );
        if (!alreadyAlerted) {
          alerts.push({
            id: `transfer-stalled-${t.id}`,
            category: "invalid_transfer",
            severity: "medium",
            title: "Transfer Stalled — No Activity in 30+ Days",
            description: `Transfer from ${t.transferorName} to ${t.buyerName} (${parseFloat(t.offeredPercentage ?? "0").toFixed(2)}%) in "${t.projectName ?? "Unknown"}" has been in "${t.status?.replace(/_/g, " ")}" for ${days} day(s) with no updates.`,
            projectId: t.projectId ?? null,
            projectName: t.projectName ?? null,
            entityId: t.id,
            entityType: "transfer",
            actionPath: "/ownership-transfers",
            createdAt: t.createdAt.toISOString(),
            daysOpen: daysSince(t.createdAt),
            metadata: { status: t.status, daysSinceUpdate: days },
          });
        }
      }
    }

    // Missing developer cases nearing or past 45-day activation window
    for (const c of missingDevCases) {
      if (!c.gdEntryDate) continue;
      const daysElapsed = Math.floor(
        (Date.now() - new Date(c.gdEntryDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      const isEligible = daysElapsed >= 45;
      const daysRemaining = 45 - daysElapsed;

      if (isEligible || daysElapsed >= 35) {
        alerts.push({
          id: `missing-dev-${c.id}`,
          category: "missing_developer",
          severity: isEligible ? "critical" : "high",
          title: isEligible
            ? "Nominee Activation Eligible — 45-Day Period Elapsed"
            : "Missing Developer Case — Approaching Activation Window",
          description: isEligible
            ? `GD #${c.gdNumber ?? "Unknown"} for "${c.projectName ?? "Unknown"}" has surpassed 45 days (Day ${daysElapsed}). Nominee activation may now be initiated.`
            : `GD #${c.gdNumber ?? "Unknown"} for "${c.projectName ?? "Unknown"}" is on Day ${daysElapsed}/45 — ${daysRemaining} day(s) until nominee activation eligibility.`,
          projectId: c.projectId ?? null,
          projectName: c.projectName ?? null,
          entityId: c.id,
          entityType: "missing_developer_case",
          actionPath: "/nominee-succession",
          createdAt: c.createdAt.toISOString(),
          daysOpen: daysElapsed,
          metadata: { daysElapsed, isEligible, gdNumber: c.gdNumber, daysRemaining },
        });
      }
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    const summary = {
      critical: alerts.filter((a) => a.severity === "critical").length,
      high: alerts.filter((a) => a.severity === "high").length,
      medium: alerts.filter((a) => a.severity === "medium").length,
      low: alerts.filter((a) => a.severity === "low").length,
      total: alerts.length,
    };

    const byCategory: Record<string, number> = {};
    for (const a of alerts) {
      byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    }

    // Sort: critical first, then by daysOpen desc
    alerts.sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const diff = sevOrder[a.severity] - sevOrder[b.severity];
      return diff !== 0 ? diff : b.daysOpen - a.daysOpen;
    });

    res.json({ summary, alerts, byCategory });
  } catch (err) {
    req.log.error({ err }, "Failed to load governance monitoring alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /governance-monitoring/timeline ───────────────────────────────────────

router.get("/timeline", async (req, res) => {
  try {
    const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 50;
    const limit = Math.min(Math.max(limitParam, 1), 200);

    interface TimelineEvent {
      id: string;
      type: string;
      category: string;
      timestamp: string;
      projectId: string | null;
      projectName: string | null;
      actor: string | null;
      title: string;
      description: string;
      severity: "critical" | "high" | "medium" | "info";
      entityId: string;
      entityType: string;
      actionPath: string;
      metadata: Record<string, unknown>;
    }

    const events: TimelineEvent[] = [];

    // Transfer audit events
    const transferAudit = await db
      .select({
        id: transferAuditEventsTable.id,
        transferId: transferAuditEventsTable.transferId,
        eventType: transferAuditEventsTable.eventType,
        actorName: transferAuditEventsTable.actorName,
        actorRole: transferAuditEventsTable.actorRole,
        summary: transferAuditEventsTable.summary,
        eventData: transferAuditEventsTable.eventData,
        createdAt: transferAuditEventsTable.createdAt,
        projectId: ownershipTransfersTable.projectId,
        projectName: projectsTable.name,
        transferorName: ownershipTransfersTable.transferorName,
        offeredPercentage: ownershipTransfersTable.offeredPercentage,
      })
      .from(transferAuditEventsTable)
      .leftJoin(ownershipTransfersTable, eq(transferAuditEventsTable.transferId, ownershipTransfersTable.id))
      .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
      .orderBy(desc(transferAuditEventsTable.createdAt))
      .limit(limit);

    for (const e of transferAudit) {
      const severityMap: Record<string, "critical" | "high" | "medium" | "info"> = {
        executed: "high",
        approved: "medium",
        cancelled: "medium",
        expired: "high",
        rofr_finalized: "medium",
        otp_verified: "info",
        otp_failed: "high",
        submitted: "info",
        created: "info",
      };
      events.push({
        id: `audit-${e.id}`,
        type: e.eventType,
        category: "transfer",
        timestamp: e.createdAt.toISOString(),
        projectId: e.projectId ?? null,
        projectName: e.projectName ?? null,
        actor: e.actorName ?? null,
        title: `Transfer: ${e.eventType?.replace(/_/g, " ")}`,
        description: e.summary ?? `Transfer audit event: ${e.eventType}`,
        severity: severityMap[e.eventType] ?? "info",
        entityId: e.transferId,
        entityType: "transfer",
        actionPath: "/ownership-transfers",
        metadata: {
          eventType: e.eventType,
          actorRole: e.actorRole,
          transferorName: e.transferorName,
          offeredPct: e.offeredPercentage,
          ...(e.eventData ?? {}),
        },
      });
    }

    // Nominee activation workflows (recent)
    const nomineeEvents = await db
      .select({
        id: nomineeActivationWorkflowsTable.id,
        activationType: nomineeActivationWorkflowsTable.activationType,
        status: nomineeActivationWorkflowsTable.status,
        nomineeName: nomineeActivationWorkflowsTable.nomineeName,
        createdByName: nomineeActivationWorkflowsTable.createdByName,
        activatedByName: nomineeActivationWorkflowsTable.activatedByName,
        activatedAt: nomineeActivationWorkflowsTable.activatedAt,
        governanceRemarks: nomineeActivationWorkflowsTable.governanceRemarks,
        createdAt: nomineeActivationWorkflowsTable.createdAt,
        projectId: nomineeActivationWorkflowsTable.projectId,
        projectName: projectsTable.name,
      })
      .from(nomineeActivationWorkflowsTable)
      .leftJoin(projectsTable, eq(nomineeActivationWorkflowsTable.projectId, projectsTable.id))
      .orderBy(desc(nomineeActivationWorkflowsTable.createdAt))
      .limit(30);

    for (const w of nomineeEvents) {
      const isActivated = w.status === "activated";
      events.push({
        id: `nominee-${w.id}`,
        type: "nominee_workflow",
        category: "nominee_succession",
        timestamp: (w.activatedAt ?? w.createdAt).toISOString(),
        projectId: w.projectId ?? null,
        projectName: w.projectName ?? null,
        actor: w.activatedByName ?? w.createdByName ?? null,
        title: `Nominee ${w.status?.replace(/_/g, " ")}: ${w.nomineeName}`,
        description: `${w.activationType?.replace(/_/g, " ")} workflow for nominee "${w.nomineeName}" — ${w.status?.replace(/_/g, " ")}${w.governanceRemarks ? ": " + w.governanceRemarks : ""}.`,
        severity: isActivated ? "high" : "info",
        entityId: w.id,
        entityType: "nominee_workflow",
        actionPath: "/nominee-succession",
        metadata: { activationType: w.activationType, status: w.status },
      });
    }

    // Inheritance ownership history (completed settlements)
    const inheritHistory = await db
      .select({
        id: inheritanceOwnershipHistoryTable.id,
        claimId: inheritanceOwnershipHistoryTable.claimId,
        projectId: inheritanceOwnershipHistoryTable.projectId,
        projectName: projectsTable.name,
        fromPartnerName: inheritanceOwnershipHistoryTable.fromPartnerName,
        claimantName: inheritanceOwnershipHistoryTable.claimantName,
        relationship: inheritanceOwnershipHistoryTable.relationship,
        sharePercentage: inheritanceOwnershipHistoryTable.sharePercentage,
        effectiveDate: inheritanceOwnershipHistoryTable.effectiveDate,
        recordedByName: inheritanceOwnershipHistoryTable.recordedByName,
        createdAt: inheritanceOwnershipHistoryTable.createdAt,
      })
      .from(inheritanceOwnershipHistoryTable)
      .leftJoin(projectsTable, eq(inheritanceOwnershipHistoryTable.projectId, projectsTable.id))
      .orderBy(desc(inheritanceOwnershipHistoryTable.createdAt))
      .limit(30);

    for (const h of inheritHistory) {
      events.push({
        id: `inherit-hist-${h.id}`,
        type: "inheritance_settled",
        category: "inheritance",
        timestamp: h.createdAt.toISOString(),
        projectId: h.projectId ?? null,
        projectName: h.projectName ?? null,
        actor: h.recordedByName ?? null,
        title: `Inheritance Transfer Recorded`,
        description: `${parseFloat(h.sharePercentage ?? "0").toFixed(4)}% transferred from ${h.fromPartnerName} to ${h.claimantName} (${h.relationship ?? "heir"}) in "${h.projectName ?? "Unknown"}". Effective: ${h.effectiveDate ? new Date(h.effectiveDate).toLocaleDateString("en-IN") : "—"}.`,
        severity: "high",
        entityId: h.claimId,
        entityType: "inheritance_claim",
        actionPath: "/inheritance-claims",
        metadata: {
          sharePercentage: h.sharePercentage,
          fromPartnerName: h.fromPartnerName,
          claimantName: h.claimantName,
          relationship: h.relationship,
        },
      });
    }

    // Ownership snapshots
    const snapshots = await db
      .select({
        id: ownershipSnapshotsTable.id,
        projectId: ownershipSnapshotsTable.projectId,
        projectName: projectsTable.name,
        snapshotType: ownershipSnapshotsTable.snapshotType,
        notes: ownershipSnapshotsTable.notes,
        triggeredByName: ownershipSnapshotsTable.triggeredByName,
        totalRecognizedAmount: ownershipSnapshotsTable.totalRecognizedAmount,
        createdAt: ownershipSnapshotsTable.createdAt,
      })
      .from(ownershipSnapshotsTable)
      .leftJoin(projectsTable, eq(ownershipSnapshotsTable.projectId, projectsTable.id))
      .orderBy(desc(ownershipSnapshotsTable.createdAt))
      .limit(20);

    for (const s of snapshots) {
      events.push({
        id: `snapshot-${s.id}`,
        type: "ownership_snapshot",
        category: "ownership",
        timestamp: s.createdAt.toISOString(),
        projectId: s.projectId ?? null,
        projectName: s.projectName ?? null,
        actor: s.triggeredByName ?? null,
        title: `Ownership Snapshot — ${s.snapshotType?.replace(/_/g, " ")}`,
        description: `Ownership snapshot captured for "${s.projectName ?? "Unknown"}". Total recognized: ₹${(s.totalRecognizedAmount ?? 0).toLocaleString("en-IN")}. ${s.notes ? "Notes: " + s.notes : ""}`,
        severity: "info",
        entityId: s.id,
        entityType: "ownership_snapshot",
        actionPath: "/ownership",
        metadata: {
          snapshotType: s.snapshotType,
          totalRecognizedAmount: s.totalRecognizedAmount,
          notes: s.notes,
        },
      });
    }

    // Missing developer cases (timeline entries for case creation)
    const mdcRows = await db
      .select({
        id: missingDeveloperCasesTable.id,
        projectId: missingDeveloperCasesTable.projectId,
        projectName: projectsTable.name,
        gdNumber: missingDeveloperCasesTable.gdNumber,
        gdEntryDate: missingDeveloperCasesTable.gdEntryDate,
        status: missingDeveloperCasesTable.status,
        reportedByName: missingDeveloperCasesTable.reportedByName,
        createdAt: missingDeveloperCasesTable.createdAt,
      })
      .from(missingDeveloperCasesTable)
      .leftJoin(projectsTable, eq(missingDeveloperCasesTable.projectId, projectsTable.id))
      .orderBy(desc(missingDeveloperCasesTable.createdAt))
      .limit(15);

    for (const c of mdcRows) {
      const daysElapsed = c.gdEntryDate
        ? Math.floor((Date.now() - new Date(c.gdEntryDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      events.push({
        id: `mdc-${c.id}`,
        type: "missing_developer_case",
        category: "nominee_succession",
        timestamp: c.createdAt.toISOString(),
        projectId: c.projectId ?? null,
        projectName: c.projectName ?? null,
        actor: c.reportedByName ?? null,
        title: `Missing Developer Case Filed — GD #${c.gdNumber ?? "?"}`,
        description: `Case filed for "${c.projectName ?? "Unknown"}". GD entry date: ${c.gdEntryDate ? new Date(c.gdEntryDate).toLocaleDateString("en-IN") : "—"} (Day ${daysElapsed}/45). Status: ${c.status?.replace(/_/g, " ")}.`,
        severity: daysElapsed >= 45 ? "critical" : daysElapsed >= 35 ? "high" : "medium",
        entityId: c.id,
        entityType: "missing_developer_case",
        actionPath: "/nominee-succession",
        metadata: { gdNumber: c.gdNumber, gdEntryDate: c.gdEntryDate, daysElapsed },
      });
    }

    // Sort all events by timestamp descending and slice to limit
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const paginatedEvents = events.slice(0, limit);

    res.json({
      total: events.length,
      returned: paginatedEvents.length,
      events: paginatedEvents,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load governance timeline");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /governance-monitoring/tasks ─────────────────────────────────────────

router.get("/tasks", async (req, res) => {
  try {
    interface Task {
      id: string;
      urgency: "immediate" | "this_week" | "pending";
      category: string;
      title: string;
      description: string;
      actionPath: string;
      projectId: string | null;
      projectName: string | null;
      entityId: string;
      daysOpen: number;
    }

    const tasks: Task[] = [];
    const now = new Date();
    const daysSince = (d: Date | string | null | undefined): number => {
      if (!d) return 0;
      return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
    };

    // Immediate: approved transfers pending execution
    const approvedTransfers = await db
      .select({
        id: ownershipTransfersTable.id,
        projectId: ownershipTransfersTable.projectId,
        projectName: projectsTable.name,
        transferorName: ownershipTransfersTable.transferorName,
        buyerName: ownershipTransfersTable.buyerName,
        offeredPercentage: ownershipTransfersTable.offeredPercentage,
        approvedAt: ownershipTransfersTable.approvedAt,
        createdAt: ownershipTransfersTable.createdAt,
      })
      .from(ownershipTransfersTable)
      .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
      .where(
        and(
          eq(ownershipTransfersTable.status, "approved"),
          eq(ownershipTransfersTable.isActive, true),
        ),
      );

    for (const t of approvedTransfers) {
      const days = daysSince(t.approvedAt ?? t.createdAt);
      tasks.push({
        id: `exec-${t.id}`,
        urgency: days > 7 ? "immediate" : "this_week",
        category: "transfer_execution",
        title: `Execute Approved Transfer`,
        description: `${t.transferorName} → ${t.buyerName}: ${parseFloat(t.offeredPercentage ?? "0").toFixed(2)}% in "${t.projectName ?? "?"}". Approved ${days} day(s) ago.`,
        actionPath: "/ownership-transfers",
        projectId: t.projectId ?? null,
        projectName: t.projectName ?? null,
        entityId: t.id,
        daysOpen: days,
      });
    }

    // Immediate: ROFR overdue
    const rofrOverdue = await db
      .select({
        id: ownershipTransfersTable.id,
        projectId: ownershipTransfersTable.projectId,
        projectName: projectsTable.name,
        transferorName: ownershipTransfersTable.transferorName,
        buyerName: ownershipTransfersTable.buyerName,
        offeredPercentage: ownershipTransfersTable.offeredPercentage,
        rofrDeadline: ownershipTransfersTable.rofrDeadline,
        createdAt: ownershipTransfersTable.createdAt,
      })
      .from(ownershipTransfersTable)
      .leftJoin(projectsTable, eq(ownershipTransfersTable.projectId, projectsTable.id))
      .where(
        and(
          eq(ownershipTransfersTable.status, "pending_rofr"),
          eq(ownershipTransfersTable.isActive, true),
        ),
      );

    for (const t of rofrOverdue) {
      if (t.rofrDeadline && new Date(t.rofrDeadline) < now) {
        tasks.push({
          id: `rofr-${t.id}`,
          urgency: "immediate",
          category: "rofr_finalization",
          title: "Finalize Overdue ROFR Period",
          description: `ROFR for ${t.transferorName} → ${t.buyerName} (${parseFloat(t.offeredPercentage ?? "0").toFixed(2)}%) in "${t.projectName ?? "?"}". Deadline passed — finalize or cancel.`,
          actionPath: "/ownership-transfers",
          projectId: t.projectId ?? null,
          projectName: t.projectName ?? null,
          entityId: t.id,
          daysOpen: daysSince(t.rofrDeadline),
        });
      }
    }

    // Immediate: nominee activation eligible
    const eligibleMDC = await db
      .select({
        id: missingDeveloperCasesTable.id,
        projectId: missingDeveloperCasesTable.projectId,
        projectName: projectsTable.name,
        gdNumber: missingDeveloperCasesTable.gdNumber,
        gdEntryDate: missingDeveloperCasesTable.gdEntryDate,
        createdAt: missingDeveloperCasesTable.createdAt,
      })
      .from(missingDeveloperCasesTable)
      .leftJoin(projectsTable, eq(missingDeveloperCasesTable.projectId, projectsTable.id))
      .where(
        and(
          eq(missingDeveloperCasesTable.isActive, true),
          eq(missingDeveloperCasesTable.status, "active"),
        ),
      );

    for (const c of eligibleMDC) {
      if (!c.gdEntryDate) continue;
      const daysElapsed = Math.floor(
        (Date.now() - new Date(c.gdEntryDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysElapsed >= 45) {
        tasks.push({
          id: `mdc-activate-${c.id}`,
          urgency: "immediate",
          category: "nominee_activation",
          title: "Initiate Nominee Activation",
          description: `GD #${c.gdNumber ?? "?"} for "${c.projectName ?? "?"}" reached Day ${daysElapsed}/45. Nominee can now be activated to assume governance authority.`,
          actionPath: "/nominee-succession",
          projectId: c.projectId ?? null,
          projectName: c.projectName ?? null,
          entityId: c.id,
          daysOpen: daysElapsed,
        });
      }
    }

    // This week: inheritance claims stalled at open for > 7 days
    const stalledClaims = await db
      .select({
        id: inheritanceClaimsTable.id,
        projectId: inheritanceClaimsTable.projectId,
        projectName: projectsTable.name,
        status: inheritanceClaimsTable.status,
        claimType: inheritanceClaimsTable.claimType,
        createdAt: inheritanceClaimsTable.createdAt,
      })
      .from(inheritanceClaimsTable)
      .leftJoin(projectsTable, eq(inheritanceClaimsTable.projectId, projectsTable.id))
      .where(
        and(
          eq(inheritanceClaimsTable.isActive, true),
          eq(inheritanceClaimsTable.status, "open"),
        ),
      );

    for (const c of stalledClaims) {
      const days = daysSince(c.createdAt);
      if (days >= 7) {
        tasks.push({
          id: `claim-review-${c.id}`,
          urgency: days >= 30 ? "immediate" : "this_week",
          category: "inheritance_review",
          title: "Advance Inheritance Claim to Review",
          description: `${c.claimType?.replace(/_/g, " ")} claim in "${c.projectName ?? "?"}" has been open for ${days} day(s) without review.`,
          actionPath: "/inheritance-claims",
          projectId: c.projectId ?? null,
          projectName: c.projectName ?? null,
          entityId: c.id,
          daysOpen: days,
        });
      }
    }

    // Pending: projects missing nominees
    const allProjects = await db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.isActive, true));

    const projectsWithNominee = await db
      .select({ projectId: projectNomineesTable.projectId })
      .from(projectNomineesTable)
      .where(eq(projectNomineesTable.isActive, true));

    const nomineeIds = new Set(projectsWithNominee.map((r) => r.projectId));
    for (const p of allProjects) {
      if (!nomineeIds.has(p.id)) {
        tasks.push({
          id: `register-nominee-${p.id}`,
          urgency: "pending",
          category: "nominee_registration",
          title: "Register Project Nominee",
          description: `"${p.name}" has no active nominee. Register one to ensure governance continuity in case of developer incapacity.`,
          actionPath: "/projects",
          projectId: p.id,
          projectName: p.name,
          entityId: p.id,
          daysOpen: 0,
        });
      }
    }

    // Pending: pending share approvals
    const pendingShares = await db
      .select({
        id: inheritanceClaimantSharesTable.id,
        claimId: inheritanceClaimantSharesTable.claimId,
        claimantId: inheritanceClaimantSharesTable.claimantId,
        proposedSharePct: inheritanceClaimantSharesTable.proposedSharePct,
        createdAt: inheritanceClaimantSharesTable.createdAt,
        projectId: inheritanceClaimsTable.projectId,
        projectName: projectsTable.name,
      })
      .from(inheritanceClaimantSharesTable)
      .leftJoin(inheritanceClaimsTable, eq(inheritanceClaimantSharesTable.claimId, inheritanceClaimsTable.id))
      .leftJoin(projectsTable, eq(inheritanceClaimsTable.projectId, projectsTable.id))
      .where(eq(inheritanceClaimantSharesTable.status, "proposed"));

    for (const s of pendingShares) {
      const days = daysSince(s.createdAt);
      tasks.push({
        id: `approve-share-${s.id}`,
        urgency: days >= 14 ? "this_week" : "pending",
        category: "share_approval",
        title: "Approve Share Proposal",
        description: `${parseFloat(s.proposedSharePct ?? "0").toFixed(4)}% proposed for claimant in "${s.projectName ?? "?"}". Pending for ${days} day(s).`,
        actionPath: "/inheritance-claims",
        projectId: s.projectId ?? null,
        projectName: s.projectName ?? null,
        entityId: s.claimId,
        daysOpen: days,
      });
    }

    const immediate = tasks.filter((t) => t.urgency === "immediate");
    const thisWeek = tasks.filter((t) => t.urgency === "this_week");
    const pending = tasks.filter((t) => t.urgency === "pending");

    // Sort each by daysOpen descending
    const sortFn = (a: Task, b: Task) => b.daysOpen - a.daysOpen;
    immediate.sort(sortFn);
    thisWeek.sort(sortFn);
    pending.sort(sortFn);

    res.json({
      summary: {
        immediate: immediate.length,
        thisWeek: thisWeek.length,
        pending: pending.length,
        total: tasks.length,
      },
      immediate,
      thisWeek,
      pending,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load governance tasks");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /governance-monitoring/legal-compliance ────────────────────────────
// Aggregate legal traceability and compliance alerts:
//   1. Suspicious overrides (missing reason, high frequency)
//   2. Excessive settlement adjustments (>20% deviation)
//   3. Missing governance documents (mature projects)
//   4. Long-pending disputes (>30 days open)
//   5. Audit trail gaps (active projects with no entries in 60 days)
//   6. Incomplete maturity workflow (no completed declaration)
//   7. Missing nominees (active projects)
//   8. Missing claimant documents (open inheritance claims)
// Also returns a per-project compliance matrix.

router.get("/legal-compliance", async (req, res) => {
  try {
    const now = new Date();
    const daysSince = (d: Date | string | null | undefined): number => {
      if (!d) return 0;
      return Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));
    };

    type ComplianceSeverity = "critical" | "high" | "medium" | "low" | "info";
    interface ComplianceAlert {
      id: string;
      category: string;
      severity: ComplianceSeverity;
      title: string;
      description: string;
      projectId?: string | null;
      projectName?: string | null;
      entityId?: string | null;
      entityType?: string | null;
      actionPath?: string | null;
      daysOpen: number;
      metadata?: Record<string, unknown> | null;
      detectedAt: string;
    }

    const alerts: ComplianceAlert[] = [];
    const projectIdFilter = req.query.projectId as string | undefined;

    // ── Load all active projects ────────────────────────────────────────────
    const activeProjects = await db
      .select({
        id: projectsTable.id,
        name: projectsTable.name,
        lifecycleStatus: projectsTable.lifecycleStatus,
        isActive: projectsTable.isActive,
      })
      .from(projectsTable)
      .where(eq(projectsTable.isActive, true));

    const filteredProjects = projectIdFilter
      ? activeProjects.filter((p) => p.id === projectIdFilter)
      : activeProjects;
    const filteredProjectIds = filteredProjects.map((p) => p.id);
    const projectById = new Map(filteredProjects.map((p) => [p.id, p]));

    if (filteredProjectIds.length === 0) {
      res.json({
        summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0, byCategory: {} },
        alerts: [],
        projectMatrix: [],
      });
      return;
    }

    // ── 1. Suspicious overrides ────────────────────────────────────────────
    // a) Overrides with missing/empty reason
    const overridesWithNoReason = await db
      .select({
        id: governanceOverridesTable.id,
        projectId: governanceOverridesTable.projectId,
        overrideType: governanceOverridesTable.overrideType,
        module: governanceOverridesTable.module,
        title: governanceOverridesTable.title,
        actorName: governanceOverridesTable.actorName,
        actorRole: governanceOverridesTable.actorRole,
        overrideReason: governanceOverridesTable.overrideReason,
        originalValue: governanceOverridesTable.originalValue,
        finalValue: governanceOverridesTable.finalValue,
        createdAt: governanceOverridesTable.createdAt,
      })
      .from(governanceOverridesTable)
      .where(
        and(
          inArray(governanceOverridesTable.projectId, filteredProjectIds),
          or(
            isNull(governanceOverridesTable.overrideReason),
            sql`trim(${governanceOverridesTable.overrideReason}) = ''`,
          ),
          gt(governanceOverridesTable.createdAt, new Date(Date.now() - 90 * 86400000)),
        ),
      )
      .orderBy(desc(governanceOverridesTable.createdAt));

    for (const ov of overridesWithNoReason) {
      const proj = projectById.get(ov.projectId);
      const days = daysSince(ov.createdAt);
      alerts.push({
        id: `override-no-reason-${ov.id}`,
        category: "suspicious_override",
        severity: "high",
        title: `Override Without Justification — ${ov.module ?? "Unknown Module"}`,
        description: `${ov.title} (${ov.overrideType?.replace(/_/g, " ")}) by ${ov.actorName ?? "Unknown"} (${ov.actorRole ?? "?"}) has no recorded override reason. Entered ${days}d ago.`,
        projectId: ov.projectId,
        projectName: proj?.name ?? null,
        entityId: ov.id,
        entityType: "governance_override",
        actionPath: "/governance-overrides",
        daysOpen: days,
        metadata: { overrideType: ov.overrideType, module: ov.module, actorName: ov.actorName },
        detectedAt: now.toISOString(),
      });
    }

    // b) High-frequency same-actor overrides (>3 in any single project in last 7 days)
    const recentOverrides = await db
      .select({
        projectId: governanceOverridesTable.projectId,
        actorId: governanceOverridesTable.actorId,
        actorName: governanceOverridesTable.actorName,
        cnt: sql<number>`count(*)::int`,
      })
      .from(governanceOverridesTable)
      .where(
        and(
          inArray(governanceOverridesTable.projectId, filteredProjectIds),
          gt(governanceOverridesTable.createdAt, new Date(Date.now() - 7 * 86400000)),
        ),
      )
      .groupBy(
        governanceOverridesTable.projectId,
        governanceOverridesTable.actorId,
        governanceOverridesTable.actorName,
      )
      .having(sql`count(*) > 3`);

    for (const row of recentOverrides) {
      const proj = projectById.get(row.projectId);
      alerts.push({
        id: `override-freq-${row.projectId}-${row.actorId ?? "anon"}`,
        category: "suspicious_override",
        severity: "medium",
        title: "High-Frequency Override Activity Detected",
        description: `${row.actorName ?? "Unknown actor"} made ${row.cnt} governance overrides in project "${proj?.name ?? "?"}" within the last 7 days. Unusual frequency may indicate unauthorised or unchecked activity.`,
        projectId: row.projectId,
        projectName: proj?.name ?? null,
        entityId: row.actorId ?? null,
        entityType: "user",
        actionPath: "/governance-overrides",
        daysOpen: 0,
        metadata: { actorName: row.actorName, overrideCount: row.cnt, windowDays: 7 },
        detectedAt: now.toISOString(),
      });
    }

    // ── 2. Excessive settlement adjustments (>20% deviation from recommended) ─
    const overriddenSettlements = await db
      .select({
        id: settlementRecordsTable.id,
        projectId: settlementRecordsTable.projectId,
        periodLabel: settlementRecordsTable.periodLabel,
        settlementType: settlementRecordsTable.settlementType,
        recommendedAmount: settlementRecordsTable.recommendedAmount,
        actualAmount: settlementRecordsTable.actualAmount,
        overrideCount: settlementRecordsTable.overrideCount,
        lastOverriddenByName: settlementRecordsTable.lastOverriddenByName,
        lastOverriddenAt: settlementRecordsTable.lastOverriddenAt,
        status: settlementRecordsTable.status,
      })
      .from(settlementRecordsTable)
      .where(
        and(
          inArray(settlementRecordsTable.projectId, filteredProjectIds),
          eq(settlementRecordsTable.isOverridden, true),
          isNotNull(settlementRecordsTable.recommendedAmount),
          isNotNull(settlementRecordsTable.actualAmount),
          sql`${settlementRecordsTable.recommendedAmount}::numeric > 0`,
        ),
      )
      .orderBy(desc(settlementRecordsTable.lastOverriddenAt));

    for (const sr of overriddenSettlements) {
      const rec = parseFloat(sr.recommendedAmount ?? "0");
      const actual = parseFloat(sr.actualAmount ?? "0");
      if (rec <= 0) continue;
      const deviationPct = Math.abs((actual - rec) / rec) * 100;
      if (deviationPct < 20) continue;

      const proj = projectById.get(sr.projectId);
      const days = daysSince(sr.lastOverriddenAt);
      const severity: ComplianceSeverity = deviationPct > 50 ? "critical" : deviationPct > 35 ? "high" : "medium";

      alerts.push({
        id: `settlement-deviation-${sr.id}`,
        category: "excessive_settlement",
        severity,
        title: `Settlement Deviation ${deviationPct.toFixed(1)}% — ${sr.settlementType?.replace(/_/g, " ")}`,
        description: `Period "${sr.periodLabel}" in "${proj?.name ?? "?"}" — recommended ₹${rec.toLocaleString("en-IN")} vs actual ₹${actual.toLocaleString("en-IN")} (${deviationPct.toFixed(1)}% deviation). ${sr.overrideCount} override(s) applied${sr.lastOverriddenByName ? ` by ${sr.lastOverriddenByName}` : ""}. Status: ${sr.status}.`,
        projectId: sr.projectId,
        projectName: proj?.name ?? null,
        entityId: sr.id,
        entityType: "settlement_record",
        actionPath: "/settlement-governance",
        daysOpen: days,
        metadata: { deviationPct, recommendedAmount: rec, actualAmount: actual, overrideCount: sr.overrideCount },
        detectedAt: now.toISOString(),
      });
    }

    // ── 3. Missing governance documents (mature_production projects) ────────
    const matureProjects = filteredProjects.filter((p) => p.lifecycleStatus === "mature_production");
    if (matureProjects.length > 0) {
      const matureProjectIds = matureProjects.map((p) => p.id);
      const projectsWithGovDocs = await db
        .select({ projectId: documentsTable.projectId })
        .from(documentsTable)
        .where(
          and(
            inArray(documentsTable.projectId, matureProjectIds),
            eq(documentsTable.category, "governance"),
            eq(documentsTable.status, "active"),
          ),
        );
      const projectsWithDocSet = new Set(projectsWithGovDocs.map((r) => r.projectId));

      for (const proj of matureProjects) {
        if (!projectsWithDocSet.has(proj.id)) {
          alerts.push({
            id: `missing-gov-doc-${proj.id}`,
            category: "missing_governance_doc",
            severity: "high",
            title: "No Governance Documents on File",
            description: `Project "${proj.name}" is in Mature Production but has no active governance category documents (board resolutions, regulatory filings, compliance records).`,
            projectId: proj.id,
            projectName: proj.name,
            entityId: proj.id,
            entityType: "project",
            actionPath: "/documents",
            daysOpen: 0,
            metadata: { lifecycleStatus: proj.lifecycleStatus },
            detectedAt: now.toISOString(),
          });
        }
      }
    }

    // ── 4. Long-pending disputes (>30 days, non-resolved) ──────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const openDisputes = await db
      .select({
        id: disputesTable.id,
        projectId: disputesTable.projectId,
        disputeType: disputesTable.disputeType,
        status: disputesTable.status,
        severity: disputesTable.severity,
        title: disputesTable.title,
        createdAt: disputesTable.createdAt,
        raisedByName: disputesTable.raisedByName,
      })
      .from(disputesTable)
      .where(
        and(
          inArray(disputesTable.projectId, filteredProjectIds),
          inArray(disputesTable.status, ["open", "under_review", "escalated"]),
          lt(disputesTable.createdAt, thirtyDaysAgo),
        ),
      )
      .orderBy(asc(disputesTable.createdAt));

    for (const d of openDisputes) {
      const proj = projectById.get(d.projectId);
      const days = daysSince(d.createdAt);
      const baseSeverity = d.severity === "critical" ? "critical" : d.severity === "high" ? "high" : "medium";
      const effectiveSeverity: ComplianceSeverity = days > 90 ? "critical" : baseSeverity;

      alerts.push({
        id: `dispute-pending-${d.id}`,
        category: "long_pending_dispute",
        severity: effectiveSeverity,
        title: `Stalled Dispute — ${d.disputeType?.replace(/_/g, " ")} (${days}d)`,
        description: `"${d.title}" in "${proj?.name ?? "?"}" has been in "${d.status?.replace(/_/g, " ")}" status for ${days} day(s)${d.raisedByName ? ` (raised by ${d.raisedByName})` : ""}. Unresolved disputes must be reviewed for legal traceability compliance.`,
        projectId: d.projectId,
        projectName: proj?.name ?? null,
        entityId: d.id,
        entityType: "dispute",
        actionPath: "/disputes",
        daysOpen: days,
        metadata: { disputeType: d.disputeType, status: d.status, severity: d.severity },
        detectedAt: now.toISOString(),
      });
    }

    // ── 5. Audit trail gaps (active projects with no entries in last 60 days) ─
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);
    const recentAuditProjectIds = await db
      .select({ projectId: auditLogsTable.projectId })
      .from(auditLogsTable)
      .where(
        and(
          isNotNull(auditLogsTable.projectId),
          gt(auditLogsTable.createdAt, sixtyDaysAgo),
          inArray(auditLogsTable.projectId, filteredProjectIds),
        ),
      )
      .groupBy(auditLogsTable.projectId);

    const auditedProjectSet = new Set(
      recentAuditProjectIds.map((r) => r.projectId).filter(Boolean) as string[],
    );

    for (const proj of filteredProjects) {
      if (!auditedProjectSet.has(proj.id)) {
        alerts.push({
          id: `audit-gap-${proj.id}`,
          category: "audit_gap",
          severity: proj.lifecycleStatus === "mature_production" ? "high" : "medium",
          title: "Audit Trail Gap — No Activity in 60+ Days",
          description: `Project "${proj.name}" (${proj.lifecycleStatus?.replace(/_/g, " ") ?? "unknown"}) has no recorded audit events in the last 60 days. Prolonged gaps in the audit trail may indicate compliance blind spots.`,
          projectId: proj.id,
          projectName: proj.name,
          entityId: proj.id,
          entityType: "project",
          actionPath: "/audit-log",
          daysOpen: 60,
          metadata: { lifecycleStatus: proj.lifecycleStatus, windowDays: 60 },
          detectedAt: now.toISOString(),
        });
      }
    }

    // ── 6. Incomplete maturity workflow ────────────────────────────────────
    if (matureProjects.length > 0) {
      const matureProjectIds = matureProjects.map((p) => p.id);

      // Projects with a declaration stuck in pending_otp > 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
      const stalledDeclarations = await db
        .select({
          id: maturityDeclarationsTable.id,
          projectId: maturityDeclarationsTable.projectId,
          status: maturityDeclarationsTable.status,
          initiatedByName: maturityDeclarationsTable.initiatedByName,
          createdAt: maturityDeclarationsTable.createdAt,
        })
        .from(maturityDeclarationsTable)
        .where(
          and(
            inArray(maturityDeclarationsTable.projectId, matureProjectIds),
            eq(maturityDeclarationsTable.status, "pending_otp"),
            lt(maturityDeclarationsTable.createdAt, sevenDaysAgo),
          ),
        );

      for (const decl of stalledDeclarations) {
        const proj = projectById.get(decl.projectId);
        const days = daysSince(decl.createdAt);
        alerts.push({
          id: `maturity-stalled-${decl.id}`,
          category: "incomplete_maturity",
          severity: days > 30 ? "high" : "medium",
          title: "Maturity Declaration Stalled — Awaiting OTP",
          description: `Maturity declaration for "${proj?.name ?? "?"}" initiated by ${decl.initiatedByName ?? "Unknown"} has been pending OTP verification for ${days} day(s). Incomplete OTP verification blocks official lifecycle confirmation.`,
          projectId: decl.projectId,
          projectName: proj?.name ?? null,
          entityId: decl.id,
          entityType: "maturity_declaration",
          actionPath: "/projects",
          daysOpen: days,
          metadata: { declarationStatus: decl.status, daysStalled: days },
          detectedAt: now.toISOString(),
        });
      }

      // Mature projects with no completed declaration at all
      const completedDeclarationProjectIds = await db
        .select({ projectId: maturityDeclarationsTable.projectId })
        .from(maturityDeclarationsTable)
        .where(
          and(
            inArray(maturityDeclarationsTable.projectId, matureProjectIds),
            eq(maturityDeclarationsTable.status, "completed"),
          ),
        );
      const completedDeclSet = new Set(completedDeclarationProjectIds.map((r) => r.projectId));
      const stalledDeclProjectIds = new Set(stalledDeclarations.map((d) => d.projectId));

      for (const proj of matureProjects) {
        if (!completedDeclSet.has(proj.id) && !stalledDeclProjectIds.has(proj.id)) {
          alerts.push({
            id: `maturity-no-decl-${proj.id}`,
            category: "incomplete_maturity",
            severity: "high",
            title: "Mature Project — No Completed Maturity Declaration",
            description: `Project "${proj.name}" has lifecycle status Mature Production but no completed maturity declaration on record. This is required for full legal lifecycle confirmation.`,
            projectId: proj.id,
            projectName: proj.name,
            entityId: proj.id,
            entityType: "project",
            actionPath: "/projects",
            daysOpen: 0,
            metadata: { lifecycleStatus: proj.lifecycleStatus },
            detectedAt: now.toISOString(),
          });
        }
      }
    }

    // ── 7. Missing nominees (active projects without an active nominee) ─────
    const nomineeCoveredProjectIds = await db
      .select({ projectId: projectNomineesTable.projectId })
      .from(projectNomineesTable)
      .where(
        and(
          inArray(projectNomineesTable.projectId, filteredProjectIds),
          eq(projectNomineesTable.isActive, true),
        ),
      );
    const nomineeProjectSet = new Set(nomineeCoveredProjectIds.map((r) => r.projectId));

    for (const proj of filteredProjects) {
      if (!nomineeProjectSet.has(proj.id)) {
        alerts.push({
          id: `missing-nominee-legal-${proj.id}`,
          category: "missing_nominee",
          severity: proj.lifecycleStatus === "mature_production" ? "critical" : "high",
          title: "No Active Nominee — Succession Authority Gap",
          description: `Project "${proj.name}" (${proj.lifecycleStatus?.replace(/_/g, " ") ?? "?"}) has no active governance nominee. Without a registered nominee, succession authority cannot transfer, creating a legal continuity risk.`,
          projectId: proj.id,
          projectName: proj.name,
          entityId: proj.id,
          entityType: "project",
          actionPath: "/nominee-succession",
          daysOpen: 0,
          metadata: { lifecycleStatus: proj.lifecycleStatus },
          detectedAt: now.toISOString(),
        });
      }
    }

    // ── 8. Missing claimant documents (open claims with no documents) ───────
    const openInheritanceClaims = await db
      .select({
        id: inheritanceClaimsTable.id,
        projectId: inheritanceClaimsTable.projectId,
        claimType: inheritanceClaimsTable.claimType,
        status: inheritanceClaimsTable.status,
        initiatedByName: inheritanceClaimsTable.initiatedByName,
        createdAt: inheritanceClaimsTable.createdAt,
      })
      .from(inheritanceClaimsTable)
      .where(
        and(
          inArray(inheritanceClaimsTable.projectId, filteredProjectIds),
          eq(inheritanceClaimsTable.isActive, true),
          notInArray(inheritanceClaimsTable.status, ["settled", "rejected"]),
        ),
      );

    if (openInheritanceClaims.length > 0) {
      const openClaimIds = openInheritanceClaims.map((c) => c.id);
      const claimsWithDocs = await db
        .select({ claimId: inheritanceDocumentsTable.claimId })
        .from(inheritanceDocumentsTable)
        .where(
          and(
            inArray(inheritanceDocumentsTable.claimId, openClaimIds),
            eq(inheritanceDocumentsTable.isActive, true),
          ),
        )
        .groupBy(inheritanceDocumentsTable.claimId);

      const claimsWithDocSet = new Set(claimsWithDocs.map((r) => r.claimId));

      for (const claim of openInheritanceClaims) {
        if (!claimsWithDocSet.has(claim.id)) {
          const proj = projectById.get(claim.projectId);
          const days = daysSince(claim.createdAt);
          alerts.push({
            id: `claim-no-docs-${claim.id}`,
            category: "missing_claimant_doc",
            severity: days > 30 ? "high" : "medium",
            title: "Inheritance Claim — No Supporting Documents",
            description: `${claim.claimType?.replace(/_/g, " ")} claim by ${claim.initiatedByName ?? "Unknown"} in "${proj?.name ?? "?"}" has been open for ${days} day(s) with no documents submitted. Legal verification cannot proceed without documentation.`,
            projectId: claim.projectId,
            projectName: proj?.name ?? null,
            entityId: claim.id,
            entityType: "inheritance_claim",
            actionPath: "/inheritance-claims",
            daysOpen: days,
            metadata: { claimType: claim.claimType, status: claim.status, daysOpen: days },
            detectedAt: now.toISOString(),
          });
        }
      }
    }

    // ── Summary ────────────────────────────────────────────────────────────
    const summary = {
      critical: alerts.filter((a) => a.severity === "critical").length,
      high: alerts.filter((a) => a.severity === "high").length,
      medium: alerts.filter((a) => a.severity === "medium").length,
      low: alerts.filter((a) => a.severity === "low").length,
      total: alerts.length,
      byCategory: alerts.reduce<Record<string, number>>((acc, a) => {
        acc[a.category] = (acc[a.category] ?? 0) + 1;
        return acc;
      }, {}),
    };

    // Sort: critical first, then by daysOpen desc
    alerts.sort((a, b) => {
      const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const sDiff = (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5);
      return sDiff !== 0 ? sDiff : b.daysOpen - a.daysOpen;
    });

    // ── Per-project compliance matrix ──────────────────────────────────────
    type OverallRisk = "critical" | "high" | "medium" | "low" | "healthy";

    interface ProjectCheck {
      projectId: string;
      projectName: string;
      lifecycleStatus: string;
      overallRisk: OverallRisk;
      checks: {
        hasNominee: boolean;
        hasGovernanceDocs: boolean;
        hasCompletedMaturity: boolean;
        hasOpenDisputes: boolean;
        hasAuditTrail: boolean;
        hasOverrideIssues: boolean;
      };
      alertCount: number;
    }

    // Build sets for matrix lookups
    const projectsWithOpenDisputes = new Set(
      openDisputes.map((d) => d.projectId),
    );
    const projectsWithOverrideIssues = new Set([
      ...overridesWithNoReason.map((o) => o.projectId),
      ...recentOverrides.map((o) => o.projectId),
    ]);
    const projectsWithGovDocs = new Set(
      matureProjects
        .map((p) => p.id)
        .filter((id) => {
          // Check if in missing gov doc alerts — if not, has docs
          return !alerts.some((a) => a.category === "missing_governance_doc" && a.projectId === id);
        }),
    );
    const completedDeclProjectIds = new Set(
      matureProjects
        .map((p) => p.id)
        .filter((id) => !alerts.some((a) => a.category === "incomplete_maturity" && a.projectId === id)),
    );

    const projectMatrix: ProjectCheck[] = filteredProjects.map((proj) => {
      const hasNominee = nomineeProjectSet.has(proj.id);
      const hasGovernanceDocs = proj.lifecycleStatus !== "mature_production" || projectsWithGovDocs.has(proj.id);
      const hasCompletedMaturity = proj.lifecycleStatus !== "mature_production" || completedDeclProjectIds.has(proj.id);
      const hasOpenDisputes = projectsWithOpenDisputes.has(proj.id);
      const hasAuditTrail = auditedProjectSet.has(proj.id);
      const hasOverrideIssues = projectsWithOverrideIssues.has(proj.id);

      const projectAlerts = alerts.filter((a) => a.projectId === proj.id);
      const hasCritical = projectAlerts.some((a) => a.severity === "critical");
      const hasHigh = projectAlerts.some((a) => a.severity === "high");
      const hasMedium = projectAlerts.some((a) => a.severity === "medium");

      const overallRisk: OverallRisk = hasCritical ? "critical"
        : hasHigh ? "high"
        : hasMedium ? "medium"
        : projectAlerts.length > 0 ? "low"
        : "healthy";

      return {
        projectId: proj.id,
        projectName: proj.name,
        lifecycleStatus: proj.lifecycleStatus ?? "prematurity",
        overallRisk,
        checks: {
          hasNominee,
          hasGovernanceDocs,
          hasCompletedMaturity,
          hasOpenDisputes,
          hasAuditTrail,
          hasOverrideIssues,
        },
        alertCount: projectAlerts.length,
      };
    });

    res.json({ summary, alerts, projectMatrix });
  } catch (err) {
    req.log.error({ err }, "Failed to load legal compliance data");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

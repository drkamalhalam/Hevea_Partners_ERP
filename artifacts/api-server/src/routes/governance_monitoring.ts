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
} from "@workspace/db";
import { eq, and, gt, ne, inArray, notInArray, desc, isNull, not, isNotNull, or, sql } from "drizzle-orm";
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

export default router;

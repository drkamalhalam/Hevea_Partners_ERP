/**
 * timelineLogger.ts
 *
 * Fire-and-forget utility for writing immutable project timeline events.
 * Never throws, never blocks the caller.
 *
 * Usage:
 *   import { writeTimeline } from "../lib/timelineLogger";
 *
 *   writeTimeline(req, {
 *     projectId: "uuid",
 *     eventType: TL.AGREEMENT_ACTIVATED,
 *     title: "Agreement activated — all parties verified",
 *     severity: "critical",
 *     relatedTable: "agreements",
 *     relatedRecordId: agreement.id,
 *     metadata: { agreementRef: agreement.agreementRef },
 *   });
 */

import { Request } from "express";
import { eq } from "drizzle-orm";
import { db, projectTimelineEventsTable, usersTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { logger } from "./logger";

// ── Event type constants ───────────────────────────────────────────────────────

export const TL = {
  // Agreements
  AGREEMENT_ACTIVATED: "agreement_activated",
  AGREEMENT_GENERATED: "agreement_generated",

  // Contributions
  CONTRIBUTION_APPROVED: "contribution_approved",
  CONTRIBUTION_REJECTED: "contribution_rejected",
  CONTRIBUTION_DISPUTED: "contribution_disputed",
  CONTRIBUTION_VERIFIED: "contribution_verified",

  // Expenditures
  EXPENDITURE_APPROVED: "expenditure_approved",
  EXPENDITURE_REJECTED: "expenditure_rejected",

  // Lifecycle
  LIFECYCLE_CHANGED: "lifecycle_changed",
  MATURITY_DECLARED: "maturity_declared",
  PROJECT_CLOSED: "project_closed",

  // Ownership
  OWNERSHIP_FROZEN: "ownership_frozen",
  OWNERSHIP_FREEZE_LIFTED: "ownership_freeze_lifted",
  OWNERSHIP_TRANSFER_INITIATED: "ownership_transfer_initiated",
  OWNERSHIP_TRANSFER_EXECUTED: "ownership_transfer_executed",

  // Inheritance
  INHERITANCE_CLAIM_FILED: "inheritance_claim_filed",
  INHERITANCE_CLAIM_APPROVED: "inheritance_claim_approved",
  INHERITANCE_OWNERSHIP_RECORDED: "inheritance_ownership_recorded",

  // Nominee
  NOMINEE_ACTIVATED: "nominee_activated",
  NOMINEE_WORKFLOW_INITIATED: "nominee_workflow_initiated",

  // Settlement / Distribution
  DISTRIBUTION_SESSION_OPENED: "distribution_session_opened",
  SETTLEMENT_DISTRIBUTED: "settlement_distributed",
  DISTRIBUTION_OVERRIDE: "distribution_override",

  // LCA
  LCA_APPLIED: "lca_applied",

  // Governance
  GOVERNANCE_NOTE: "governance_note",
} as const;

export type TimelineEventType = (typeof TL)[keyof typeof TL];

// ── Severity ──────────────────────────────────────────────────────────────────

export type TimelineSeverity = "info" | "important" | "critical";

// ── Entry interface ───────────────────────────────────────────────────────────

export interface TimelineEntry {
  projectId: string;
  eventType: TimelineEventType | string;
  title: string;
  description?: string | null;
  severity?: TimelineSeverity;
  relatedTable?: string | null;
  relatedRecordId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date | null;
  /** Pre-resolved actor — if omitted, resolved from Clerk session on req */
  actor?: {
    id: string;
    name?: string | null;
    role?: string | null;
  } | null;
}

// ── Writer ────────────────────────────────────────────────────────────────────

/**
 * Append an immutable event to the project timeline.
 * Fire-and-forget: never awaited, never throws.
 */
export function writeTimeline(req: Request, entry: TimelineEntry): void {
  const doInsert = async () => {
    let actorId: string | null = null;
    let actorName: string | null = null;
    let actorRole: string | null = null;

    if (entry.actor) {
      actorId = entry.actor.id ?? null;
      actorName = entry.actor.name ?? null;
      actorRole = entry.actor.role ?? null;
    } else {
      const { userId: clerkUserId } = getAuth(req);
      if (clerkUserId) {
        const [user] = await db
          .select({
            id: usersTable.id,
            displayName: usersTable.displayName,
            role: usersTable.role,
          })
          .from(usersTable)
          .where(eq(usersTable.clerkUserId, clerkUserId))
          .limit(1);
        if (user) {
          actorId = user.id;
          actorName = user.displayName ?? null;
          actorRole = user.role ?? null;
        }
      }
    }

    await db.insert(projectTimelineEventsTable).values({
      projectId: entry.projectId,
      eventType: entry.eventType,
      title: entry.title,
      description: entry.description ?? null,
      severity: entry.severity ?? "info",
      actorId: actorId ?? undefined,
      actorName: actorName ?? null,
      actorRole: actorRole ?? null,
      relatedTable: entry.relatedTable ?? null,
      relatedRecordId: entry.relatedRecordId ?? null,
      metadata: entry.metadata ?? null,
      occurredAt: entry.occurredAt ?? new Date(),
    });
  };

  doInsert().catch((err) => {
    logger.error({ err, entry }, "Failed to write project timeline event");
  });
}

/**
 * disputeLogger.ts
 *
 * Fire-and-forget utility for creating dispute traceability records when
 * existing routes trigger dispute events.
 *
 * Creates both the parent dispute record and the initial "raised" event row.
 * Callers do NOT await — disputes are non-blocking.
 *
 * Usage:
 *   import { logDispute, DT } from "../lib/disputeLogger";
 *   void logDispute(req, {
 *     projectId: updated.projectId,
 *     disputeType: DT.CONTRIBUTION,
 *     severity: "medium",
 *     title: `Contribution disputed — ${existing[0].contributionType}`,
 *     description: disputeNotes,
 *     relatedTable: "contributions",
 *     relatedRecordId: id,
 *     metadata: { amount: existing[0].amount, contributionType: existing[0].contributionType },
 *   });
 */

import type { Request } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  usersTable,
  disputesTable,
  disputeResolutionEventsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ── Dispute type constants ────────────────────────────────────────────────────

export const DT = {
  CONTRIBUTION: "contribution",
  EXPENDITURE: "expenditure",
  SETTLEMENT: "settlement",
  OWNERSHIP: "ownership",
  INHERITANCE: "inheritance",
  GOVERNANCE: "governance",
} as const;

export type DisputeType = (typeof DT)[keyof typeof DT];

// ── Severity ─────────────────────────────────────────────────────────────────

export type DisputeSeverity = "low" | "medium" | "high" | "critical";

// ── Entry shape ───────────────────────────────────────────────────────────────

export interface DisputeEntry {
  projectId: string;
  disputeType: DisputeType | string;
  severity?: DisputeSeverity;
  title: string;
  description?: string | null;
  relatedTable?: string | null;
  relatedRecordId?: string | null;
  supportingDocuments?: Record<string, unknown>[] | null;
  metadata?: Record<string, unknown> | null;
  raisedAt?: Date;
  /** Pre-resolved actor (skip Clerk lookup if caller already has it) */
  actor?: {
    id: string | null;
    name: string | null;
    role: string | null;
  } | null;
}

// ── Internal: resolve actor ────────────────────────────────────────────────────

async function resolveActor(req: Request): Promise<{
  id: string | null;
  name: string | null;
  role: string | null;
}> {
  try {
    const { userId: clerkUserId } = getAuth(req);
    if (!clerkUserId) return { id: null, name: null, role: null };
    const [user] = await db
      .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (!user) return { id: null, name: null, role: null };
    return { id: user.id, name: user.displayName ?? null, role: user.role };
  } catch {
    return { id: null, name: null, role: null };
  }
}

// ── Public: fire-and-forget dispute creation ──────────────────────────────────

export function logDispute(req: Request, entry: DisputeEntry): void {
  (async () => {
    try {
      const actor = entry.actor ?? (await resolveActor(req));

      const [dispute] = await db
        .insert(disputesTable)
        .values({
          projectId: entry.projectId,
          disputeType: entry.disputeType,
          status: "open",
          severity: entry.severity ?? "medium",
          title: entry.title,
          description: entry.description ?? null,
          raisedById: actor.id ?? undefined,
          raisedByName: actor.name ?? null,
          raisedByRole: actor.role ?? null,
          raisedAt: entry.raisedAt ?? new Date(),
          relatedTable: entry.relatedTable ?? null,
          relatedRecordId: entry.relatedRecordId ?? null,
          supportingDocuments: entry.supportingDocuments ?? null,
          metadata: entry.metadata ?? null,
        })
        .returning();

      // Write initial "raised" event
      await db.insert(disputeResolutionEventsTable).values({
        disputeId: dispute.id,
        projectId: entry.projectId,
        eventType: "raised",
        previousStatus: null,
        newStatus: "open",
        description: entry.description ?? entry.title,
        actorId: actor.id ?? undefined,
        actorName: actor.name ?? null,
        actorRole: actor.role ?? null,
        metadata: entry.metadata ?? null,
      });
    } catch (err) {
      logger.error({ err, entry }, "disputeLogger: failed to create dispute record");
    }
  })();
}

/**
 * overrideLogger.ts
 *
 * Fire-and-forget utility for writing governance override records.
 * Mirrors the pattern of timelineLogger.ts — callers do NOT await.
 *
 * Usage:
 *   import { writeOverride, OV } from "../lib/overrideLogger";
 *   void writeOverride(req, {
 *     projectId: updated.projectId,
 *     overrideType: OV.SETTLEMENT_OVERRIDE,
 *     module: "settlement",
 *     title: "Settlement amount overridden",
 *     originalValue: { amount: existing.recommendedAmount },
 *     finalValue: { amount: actualAmount },
 *     overrideReason: overrideRemarks,
 *     relatedTable: "settlement_records",
 *     relatedRecordId: id,
 *   });
 */

import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, governanceOverridesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ── Override type constants ────────────────────────────────────────────────────

export const OV = {
  SETTLEMENT_OVERRIDE: "settlement_distribution",
  SETTLEMENT_FINALIZED: "settlement_finalized",
  SETTLEMENT_REOPENED: "settlement_reopened",
  CONTRIBUTION_DISPUTE_RESOLVED: "contribution_dispute_resolved",
  CONTRIBUTION_DISPUTE_REJECTED: "contribution_dispute_rejected",
  LCA_LEDGER_ADJUSTED: "lca_ledger_adjustment",
  TRANSFER_PRICE_OVERRIDE: "transfer_price_override",
  OWNERSHIP_TRANSFER: "ownership_transfer",
  EXPENDITURE_APPROVED: "expenditure_approved",
  EXPENDITURE_REJECTED: "expenditure_rejected",
  GOVERNANCE_MANUAL_NOTE: "governance_manual_note",
} as const;

export type OverrideType = (typeof OV)[keyof typeof OV];

// ── Entry shape ────────────────────────────────────────────────────────────────

export interface OverrideEntry {
  projectId: string;
  overrideType: OverrideType | string;
  module: string;
  title: string;
  description?: string | null;
  originalValue?: Record<string, unknown> | null;
  finalValue?: Record<string, unknown> | null;
  overrideReason?: string | null;
  relatedTable?: string | null;
  relatedRecordId?: string | null;
  supportingDocuments?: Record<string, unknown>[] | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
}

// ── Internal: resolve actor from Clerk session ────────────────────────────────

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

// ── Public: fire-and-forget write ─────────────────────────────────────────────

export function writeOverride(req: Request, entry: OverrideEntry): void {
  (async () => {
    try {
      const actor = await resolveActor(req);

      await db.insert(governanceOverridesTable).values({
        projectId: entry.projectId,
        overrideType: entry.overrideType,
        module: entry.module,
        title: entry.title,
        description: entry.description ?? null,
        originalValue: entry.originalValue ?? null,
        finalValue: entry.finalValue ?? null,
        overrideReason: entry.overrideReason ?? null,
        actorId: actor.id ?? undefined,
        actorName: actor.name ?? null,
        actorRole: actor.role ?? null,
        relatedTable: entry.relatedTable ?? null,
        relatedRecordId: entry.relatedRecordId ?? null,
        supportingDocuments: entry.supportingDocuments ?? null,
        metadata: entry.metadata ?? null,
        occurredAt: entry.occurredAt ?? new Date(),
      });
    } catch (err) {
      logger.error({ err, entry }, "overrideLogger: failed to write governance override");
    }
  })();
}

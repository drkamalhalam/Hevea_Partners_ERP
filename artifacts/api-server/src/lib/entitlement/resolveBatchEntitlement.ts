/**
 * entitlement/resolveBatchEntitlement.ts
 *
 * V3 Wave 3 — Resolve per-partner ownership entitlement percentages for a
 * single production batch, applying the R10 chronological transfer chain.
 *
 * Algorithm (R10 Binary Handling):
 *   1. Find the latest ownership snapshot with snapshot_at ≤ batchCreatedAt.
 *      If batchCreatedAt is null (line item not batch-linked), fall back to
 *      snapshot_at ≤ recognizedAt.
 *   2. If still no snapshot found → throw NoSnapshotError (event stays in
 *      sale_event_journal for admin reprocess after snapshot is created).
 *   3. Find all executed ownership transfers with:
 *        effective_date > baselineDate AND effective_date ≤ recognizedAt
 *      (these represent ownership changes between batch creation and sale
 *       recognition that shift entitlement to the new owner).
 *   4. Apply each transfer in chronological order: transferor loses
 *      offeredPercentage; buyer gains it. Partners with 0% are removed.
 *   5. Drift guard: sum of all percentages must equal 100.00 ± 0.01.
 *      On drift throw OwnershipDriftError so the event is flagged for review.
 *
 * Returns Map<partnerId, EntitlementEntry>. Callers must not mutate the map.
 */

import { and, eq, lte, gt, desc } from "drizzle-orm";
import Decimal from "decimal.js-light";
import {
  db as appDb,
  ownershipSnapshotsTable,
  ownershipTransfersTable,
} from "@workspace/db";
import type { OwnershipSnapshotEntry } from "@workspace/db";
import { NoSnapshotError, OwnershipDriftError } from "./errors.js";

type AppDb = typeof appDb;

export interface EntitlementEntry {
  partnerId: string;
  partnerName: string;
  /** Ownership % as a Decimal (e.g. Decimal("15.5") = 15.5%). */
  percentage: Decimal;
}

export async function resolveBatchEntitlement(
  db: AppDb,
  projectId: string,
  batchCreatedAt: Date | null,
  recognizedAt: Date,
): Promise<Map<string, EntitlementEntry>> {
  const baselineDate = batchCreatedAt ?? recognizedAt;

  // ── Step 1: Baseline snapshot (latest on or before baselineDate) ───────────
  const [latestSnapshot] = await db
    .select({
      id: ownershipSnapshotsTable.id,
      entries: ownershipSnapshotsTable.entries,
    })
    .from(ownershipSnapshotsTable)
    .where(
      and(
        eq(ownershipSnapshotsTable.projectId, projectId),
        lte(ownershipSnapshotsTable.snapshotAt, baselineDate),
      ),
    )
    .orderBy(desc(ownershipSnapshotsTable.snapshotAt))
    .limit(1);

  // Fallback: use recognizedAt if baseline lookup missed and batchCreatedAt was set.
  let resolvedSnapshot = latestSnapshot;
  if (!resolvedSnapshot && batchCreatedAt !== null) {
    const [fallback] = await db
      .select({
        id: ownershipSnapshotsTable.id,
        entries: ownershipSnapshotsTable.entries,
      })
      .from(ownershipSnapshotsTable)
      .where(
        and(
          eq(ownershipSnapshotsTable.projectId, projectId),
          lte(ownershipSnapshotsTable.snapshotAt, recognizedAt),
        ),
      )
      .orderBy(desc(ownershipSnapshotsTable.snapshotAt))
      .limit(1);
    resolvedSnapshot = fallback;
  }

  if (!resolvedSnapshot) {
    throw new NoSnapshotError(projectId, recognizedAt.toISOString());
  }

  // ── Step 2: Build entitlement map from snapshot entries ───────────────────
  const entitlements = new Map<string, EntitlementEntry>();
  const entries = resolvedSnapshot.entries as OwnershipSnapshotEntry[];

  for (const entry of entries) {
    if (!entry.partnerId) continue;
    entitlements.set(entry.partnerId, {
      partnerId: entry.partnerId,
      partnerName: entry.partnerName,
      percentage: new Decimal(entry.percentage),
    });
  }

  // ── Step 3: Apply executed transfers between baselineDate and recognizedAt ─
  if (batchCreatedAt !== null) {
    const baseDateStr = baselineDate.toISOString().slice(0, 10);
    const recDateStr = recognizedAt.toISOString().slice(0, 10);

    const transfers = await db
      .select({
        transferorPartnerId: ownershipTransfersTable.transferorPartnerId,
        buyerPartnerId: ownershipTransfersTable.buyerPartnerId,
        buyerName: ownershipTransfersTable.buyerName,
        offeredPercentage: ownershipTransfersTable.offeredPercentage,
      })
      .from(ownershipTransfersTable)
      .where(
        and(
          eq(ownershipTransfersTable.projectId, projectId),
          eq(ownershipTransfersTable.status, "executed"),
          gt(ownershipTransfersTable.effectiveDate, baseDateStr),
          lte(ownershipTransfersTable.effectiveDate, recDateStr),
        ),
      )
      .orderBy(ownershipTransfersTable.effectiveDate);

    for (const tx of transfers) {
      if (!tx.buyerPartnerId) continue;

      const pct = new Decimal(tx.offeredPercentage ?? "0");

      const from = entitlements.get(tx.transferorPartnerId);
      if (from) {
        entitlements.set(tx.transferorPartnerId, {
          ...from,
          percentage: from.percentage.minus(pct),
        });
      }

      const to = entitlements.get(tx.buyerPartnerId);
      if (to) {
        entitlements.set(tx.buyerPartnerId, {
          ...to,
          percentage: to.percentage.plus(pct),
        });
      } else {
        entitlements.set(tx.buyerPartnerId, {
          partnerId: tx.buyerPartnerId,
          partnerName: tx.buyerName,
          percentage: pct,
        });
      }
    }
  }

  // ── Step 4: Drift guard ────────────────────────────────────────────────────
  const sum = Array.from(entitlements.values()).reduce(
    (acc, e) => acc.plus(e.percentage),
    new Decimal(0),
  );

  const DRIFT_TOLERANCE = new Decimal("0.01");
  if (sum.minus(100).abs().greaterThan(DRIFT_TOLERANCE)) {
    throw new OwnershipDriftError(resolvedSnapshot.id, sum.toNumber(), {
      projectId,
      baselineDate: baselineDate.toISOString(),
      recognizedAt: recognizedAt.toISOString(),
    });
  }

  // Remove zero-or-negative percentage entries.
  for (const [id, entry] of entitlements) {
    if (entry.percentage.lessThanOrEqualTo(0)) {
      entitlements.delete(id);
    }
  }

  return entitlements;
}

/**
 * entitlement/resolveBatchEntitlement.ts
 *
 * V3 Wave 3 — Resolve per-partner ownership entitlement percentages for a
 * single production batch, applying the R10 Handling-Aware transfer chain.
 *
 * Algorithm (R10 Handling-Aware):
 *   1. Find the latest ownership snapshot with snapshot_at ≤ batchCreatedAt.
 *      If batchCreatedAt is null (line item not batch-linked), fall back to
 *      snapshot_at ≤ recognizedAt.
 *   2. If still no snapshot found → throw NoSnapshotError (event stays in
 *      sale_event_journal for admin reprocess after snapshot is created).
 *   3. Find all executed ownership transfers with:
 *        effective_date > baselineDate AND effective_date ≤ recognizedAt
 *      (these represent ownership changes between batch creation and sale
 *       recognition that may shift entitlement to the new owner).
 *   4. Apply each transfer via applyTransferEntitlements, which respects
 *      stockEntitlementHandling:
 *        retain_with_seller + no KG → skip (seller retains full entitlement)
 *        retain_with_seller + KG    → apply (transferredKg/totalKg) fraction only
 *        transfer_to_buyer / null   → apply full offeredPercentage (default)
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

/**
 * Shape of a transfer row as returned by the Step 3 DB query.
 * Exported so unit tests can construct fixtures without an actual DB.
 */
export interface TransferRecord {
  transferorPartnerId: string;
  buyerPartnerId: string | null;
  buyerName: string;
  offeredPercentage: string | null;
  /** null → treated as transfer_to_buyer (backward-compatible default). */
  stockEntitlementHandling: string | null;
  stockEntitlementKg: string | null;
  stockEntitlementRetainedKg: string | null;
  stockEntitlementTransferredKg: string | null;
}

/**
 * Apply a chronological sequence of executed ownership transfers to an
 * entitlement map, respecting the stockEntitlementHandling flag on each.
 *
 * Behaviour by handling value:
 *   'retain_with_seller', no KG fields:
 *     Skip — seller retains 100% of their entitlement for this pre-transfer batch.
 *   'retain_with_seller', KG fields complete (totalKg > 0):
 *     Shift only (transferredKg / totalKg) × offeredPercentage to buyer.
 *     Seller retains the remainder for this batch.
 *   'transfer_to_buyer' or null:
 *     Apply full offeredPercentage shift (existing behavior, backward-compatible).
 *
 * Mutates and returns the same map. Drift guard is NOT applied here — the
 * caller (resolveBatchEntitlement) owns that responsibility. Because each
 * path (skip / partial / full) is symmetric — transferor loses exactly what
 * buyer gains — the total percentage sum is always preserved.
 */
export function applyTransferEntitlements(
  entitlements: Map<string, EntitlementEntry>,
  transfers: TransferRecord[],
): Map<string, EntitlementEntry> {
  for (const tx of transfers) {
    if (!tx.buyerPartnerId) continue;

    const fullPct = new Decimal(tx.offeredPercentage ?? "0");
    const handling = tx.stockEntitlementHandling;

    let effectivePct: Decimal;

    if (handling === "retain_with_seller") {
      const totalKg =
        tx.stockEntitlementKg ? new Decimal(tx.stockEntitlementKg) : null;
      const transferKg =
        tx.stockEntitlementTransferredKg
          ? new Decimal(tx.stockEntitlementTransferredKg)
          : null;

      if (totalKg && totalKg.greaterThan(0) && transferKg !== null) {
        // Partial KG split: only the transferred fraction of offeredPct shifts.
        effectivePct = fullPct.mul(transferKg.div(totalKg));
      } else {
        // Full retain: skip this transfer for this pre-transfer batch.
        continue;
      }
    } else {
      // transfer_to_buyer (or null / unknown): apply full percentage.
      effectivePct = fullPct;
    }

    // Zero effective shift (e.g. transferredKg = 0) — no economic effect; skip.
    if (effectivePct.lessThanOrEqualTo(0)) continue;

    // Apply the (possibly reduced) symmetric percentage shift.
    const from = entitlements.get(tx.transferorPartnerId);
    if (from) {
      entitlements.set(tx.transferorPartnerId, {
        ...from,
        percentage: from.percentage.minus(effectivePct),
      });
    }

    const to = entitlements.get(tx.buyerPartnerId);
    if (to) {
      entitlements.set(tx.buyerPartnerId, {
        ...to,
        percentage: to.percentage.plus(effectivePct),
      });
    } else {
      entitlements.set(tx.buyerPartnerId, {
        partnerId: tx.buyerPartnerId,
        partnerName: tx.buyerName,
        percentage: effectivePct,
      });
    }
  }

  return entitlements;
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
        transferorPartnerId:           ownershipTransfersTable.transferorPartnerId,
        buyerPartnerId:                ownershipTransfersTable.buyerPartnerId,
        buyerName:                     ownershipTransfersTable.buyerName,
        offeredPercentage:             ownershipTransfersTable.offeredPercentage,
        stockEntitlementHandling:      ownershipTransfersTable.stockEntitlementHandling,
        stockEntitlementKg:            ownershipTransfersTable.stockEntitlementKg,
        stockEntitlementRetainedKg:    ownershipTransfersTable.stockEntitlementRetainedKg,
        stockEntitlementTransferredKg: ownershipTransfersTable.stockEntitlementTransferredKg,
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

    applyTransferEntitlements(entitlements, transfers);
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

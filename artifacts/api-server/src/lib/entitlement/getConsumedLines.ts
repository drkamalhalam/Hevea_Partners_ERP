/**
 * entitlement/getConsumedLines.ts
 *
 * V3 Wave 3 — Load a sales transaction's line items and resolve per-partner
 * consumed quantities and gross revenue amounts using ownership entitlement.
 *
 * For each line item:
 *   • If batchId is set → look up production_batches.created_at as T_B and
 *     call resolveBatchEntitlement(projectId, T_B, recognizedAt).
 *   • If batchId is null → call resolveBatchEntitlement(projectId, null,
 *     recognizedAt) — uses the latest snapshot on or before recognizedAt.
 *
 * Per-partner entitlement across all line items is aggregated:
 *   consumedQuantityTotal = Σ (line.quantity × partner_pct / 100)
 *   grossTotal            = Σ (line.grossAmount × partner_pct / 100)
 *
 * Returns an array of PartnerLineAggregate.
 */

import { eq } from "drizzle-orm";
import Decimal from "decimal.js-light";
import {
  db as appDb,
  salesTransactionsTable,
  salesLineItemsTable,
  productionBatchesTable,
} from "@workspace/db";
import { toMoney } from "../money/index.js";
import { resolveBatchEntitlement } from "./resolveBatchEntitlement.js";
import type { EntitlementEntry } from "./resolveBatchEntitlement.js";
import { EntitlementError } from "./errors.js";

type AppDb = typeof appDb;

export interface PartnerLineAggregate {
  partnerId: string;
  partnerName: string;
  consumedQuantityTotal: Decimal;
  grossTotal: Decimal;
  /** Ownership % at recognizedAt (from last-resolved line — for audit). */
  ownershipPctAtTime: Decimal;
}

export async function getConsumedLines(
  db: AppDb,
  txId: string,
  recognizedAt: Date,
): Promise<PartnerLineAggregate[]> {
  const [tx] = await db
    .select({ id: salesTransactionsTable.id, projectId: salesTransactionsTable.projectId })
    .from(salesTransactionsTable)
    .where(eq(salesTransactionsTable.id, txId))
    .limit(1);

  if (!tx) {
    throw new EntitlementError("SALE_NOT_FOUND", `Sale transaction ${txId} not found`, { txId });
  }

  const lineItems = await db
    .select({
      batchId: salesLineItemsTable.batchId,
      quantity: salesLineItemsTable.quantity,
      grossAmount: salesLineItemsTable.grossAmount,
    })
    .from(salesLineItemsTable)
    .where(eq(salesLineItemsTable.transactionId, txId));

  const aggregates = new Map<
    string,
    { entry: EntitlementEntry; consumedQty: Decimal; gross: Decimal }
  >();

  for (const line of lineItems) {
    let batchCreatedAt: Date | null = null;
    if (line.batchId) {
      const [batch] = await db
        .select({ createdAt: productionBatchesTable.createdAt })
        .from(productionBatchesTable)
        .where(eq(productionBatchesTable.id, line.batchId))
        .limit(1);
      if (batch?.createdAt) batchCreatedAt = batch.createdAt;
    }

    const entitlements = await resolveBatchEntitlement(
      db,
      tx.projectId,
      batchCreatedAt,
      recognizedAt,
    );

    // numericFlex returns number at runtime; toMoney handles number input.
    const lineQty = toMoney(line.quantity as unknown as number);
    const lineGross = toMoney(line.grossAmount as unknown as number);

    for (const [partnerId, entry] of entitlements) {
      const pctFraction = entry.percentage.div(100);
      const partnerQty = lineQty.times(pctFraction);
      const partnerGross = lineGross.times(pctFraction);

      const existing = aggregates.get(partnerId);
      if (existing) {
        existing.consumedQty = existing.consumedQty.plus(partnerQty);
        existing.gross = existing.gross.plus(partnerGross);
        existing.entry = entry;
      } else {
        aggregates.set(partnerId, { entry, consumedQty: partnerQty, gross: partnerGross });
      }
    }
  }

  return Array.from(aggregates.entries()).map(([partnerId, agg]) => ({
    partnerId,
    partnerName: agg.entry.partnerName,
    consumedQuantityTotal: agg.consumedQty,
    grossTotal: agg.gross,
    ownershipPctAtTime: agg.entry.percentage,
  }));
}

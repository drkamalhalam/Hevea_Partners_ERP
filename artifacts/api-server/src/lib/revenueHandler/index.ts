/**
 * revenueHandler/index.ts
 *
 * V3 Wave 3 — Revenue handler barrel + emitSaleRecognized helper.
 *
 * emitSaleRecognized: single-call integration point for sale confirmation
 * routes. It publishes the event to sale_event_journal and, if
 * FIN_REVENUE_ATTRIBUTION_ENABLED is ON, immediately calls processOne
 * inline (synchronous inline processing per R6 design).
 *
 * Emission is gated by FIN_SALE_EVENT_EMISSION_ENABLED.
 * Attribution is gated by FIN_REVENUE_ATTRIBUTION_ENABLED.
 *
 * With both flags OFF (current production state), this function is a no-op
 * and existing route behavior is unchanged.
 */

import type { Logger } from "pino";
import {
  db as appDb,
  salesTransactionsTable,
  buyersTable,
  partnersTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publishSaleEvent } from "../saleEvents/publish.js";
import { processOne } from "./processOne.js";
import { getFinFlag } from "../featureFlags.js";

type AppDb = typeof appDb;

export interface EmitSaleRecognizedInput {
  saleTxId: string;
  projectId: string;
  recognizedAt: Date;
  log: Logger;
}

export interface EmitSaleRecognizedResult {
  emitted: boolean;
  eventId: string | null;
  attributed: boolean;
  reason: string;
}

/**
 * Determine if the buyer on a sale transaction is an internal partner
 * (a partner record whose personMasterId matches the buyer's personMasterId).
 */
async function isInternalPartnerBuyer(
  db: AppDb,
  buyerId: string | null,
): Promise<string | null> {
  if (!buyerId) return null;

  const [buyer] = await db
    .select({ personMasterId: buyersTable.personMasterId })
    .from(buyersTable)
    .where(eq(buyersTable.id, buyerId))
    .limit(1);

  if (!buyer?.personMasterId) return null;

  const [partner] = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(eq(partnersTable.personMasterId, buyer.personMasterId))
    .limit(1);

  return partner?.id ?? null;
}

export async function emitSaleRecognized(
  db: AppDb,
  input: EmitSaleRecognizedInput,
): Promise<EmitSaleRecognizedResult> {
  const { saleTxId, projectId, recognizedAt, log } = input;

  if (!getFinFlag("FIN_SALE_EVENT_EMISSION_ENABLED")) {
    return { emitted: false, eventId: null, attributed: false, reason: "emission_flag_off" };
  }

  const [tx] = await db
    .select({
      saleNumber: salesTransactionsTable.saleNumber,
      totalGrossRevenue: salesTransactionsTable.totalGrossRevenue,
      totalNetRevenue: salesTransactionsTable.totalNetRevenue,
      buyerId: salesTransactionsTable.buyerId,
    })
    .from(salesTransactionsTable)
    .where(eq(salesTransactionsTable.id, saleTxId))
    .limit(1);

  if (!tx) {
    log.warn({ saleTxId }, "emitSaleRecognized: sale transaction not found");
    return { emitted: false, eventId: null, attributed: false, reason: "sale_not_found" };
  }

  const buyerPartnerId = await isInternalPartnerBuyer(db, tx.buyerId ?? null);
  const isInternal = buyerPartnerId !== null;
  const occurredAt = recognizedAt.toISOString();

  // totalGrossRevenue / totalNetRevenue are numericFlex → number at runtime
  const grossStr = String(tx.totalGrossRevenue ?? 0);
  const netStr = String(tx.totalNetRevenue ?? 0);

  let publishResult;
  if (isInternal) {
    publishResult = await publishSaleEvent(db as any, {
      eventType: "InternalPartnerPurchaseCompleted",
      saleReferenceType: "sales_transaction",
      saleReferenceId: saleTxId,
      projectId,
      occurredAt,
      payload: {
        saleId: saleTxId,
        projectId,
        buyerPartnerId: buyerPartnerId!,
        recognizedAt: occurredAt,
        totalGrossRevenue: grossStr,
        totalNetRevenue: netStr,
        currency: "INR",
      },
    });
  } else {
    publishResult = await publishSaleEvent(db as any, {
      eventType: "SaleFinanciallyRecognized",
      saleReferenceType: "sales_transaction",
      saleReferenceId: saleTxId,
      projectId,
      occurredAt,
      payload: {
        saleId: saleTxId,
        projectId,
        saleNumber: tx.saleNumber,
        recognizedAt: occurredAt,
        totalGrossRevenue: grossStr,
        totalNetRevenue: netStr,
        currency: "INR",
        lineItemCount: 0,
        deductionCount: 0,
      },
    });
  }

  if (!publishResult.created && publishResult.reason !== "duplicate") {
    log.warn({ saleTxId, reason: publishResult.reason }, "emitSaleRecognized: publish failed");
    return { emitted: false, eventId: null, attributed: false, reason: publishResult.reason };
  }

  const eventId = publishResult.eventId ?? saleTxId;

  log.info({ saleTxId, eventId, isInternal }, "emitSaleRecognized: event published");

  if (!getFinFlag("FIN_REVENUE_ATTRIBUTION_ENABLED") || !publishResult.eventId) {
    return { emitted: true, eventId, attributed: false, reason: "attribution_flag_off" };
  }

  const processResult = await processOne(db, eventId);
  log.info({ saleTxId, eventId, outcome: processResult.outcome }, "emitSaleRecognized: attribution complete");

  return {
    emitted: true,
    eventId,
    attributed: processResult.outcome === "processed",
    reason: processResult.outcome,
  };
}

export { processOne } from "./processOne.js";
export { processPending } from "./processPending.js";
export { categorizeEvent } from "./categorize.js";

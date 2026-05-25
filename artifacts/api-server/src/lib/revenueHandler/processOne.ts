/**
 * revenueHandler/processOne.ts
 *
 * V3 Wave 3 — Per-event revenue attribution handler.
 *
 * Processes a single sale_event_journal row identified by eventId. The handler
 * is idempotent: it claims the event via processed_sale_events before writing
 * any rows; a second call with the same eventId returns `already_processed`.
 *
 * Flag gates:
 *   FIN_REVENUE_ATTRIBUTION_ENABLED — must be ON for the handler to run.
 *   FIN_LEDGER_ENABLED              — must be ON for partner_financial_ledger
 *                                     rows to be written. When OFF attribution
 *                                     lines are written (dry-run mode) but no
 *                                     ledger credits are created.
 *
 * For each entitled partner:
 *   Unblocked → insert revenue_attribution_lines + partner_financial_ledger
 *               (revenue_credit). ledger_entry_id links attribution to ledger.
 *   Blocked   → insert revenue_attribution_lines (ledger_entry_id = NULL,
 *               notes = 'entitlement_held') + held_distribution_ledger row.
 *
 * Deduction split: pro_rata_kg. Each partner's share of totalDeductions is
 * proportional to their consumedQuantityTotal / totalConsumedQuantity.
 *
 * All money arithmetic uses lib/money (decimal.js-light, HALF_UP, 2 dp).
 * numericFlex columns require number (not string) at insert time.
 */

import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db as appDb,
  saleEventJournalTable,
  salesTransactionsTable,
  revenueAttributionLinesTable,
  partnerFinancialLedgerTable,
  heldDistributionLedgerTable,
} from "@workspace/db";
import { getFinFlag } from "../featureFlags.js";
import { claimSaleEvent } from "../saleEvents/claim.js";
import {
  toMoney,
  fromMoney,
  splitMoney,
  ZERO,
  Decimal,
} from "../money/index.js";
import { getBlockedPartnerIds } from "../entitlement/blockedPartners.js";
import { getConsumedLines } from "../entitlement/getConsumedLines.js";
import { categorizeEvent } from "./categorize.js";
import type { SaleEventType } from "../saleEvents/schemas.js";

type AppDb = typeof appDb;

const HANDLER_NAME = "sale_revenue_handler";

export type ProcessOneOutcome =
  | "processed"
  | "already_processed"
  | "flag_disabled"
  | "skipped_event_type"
  | "event_not_found"
  | "sale_not_found"
  | "error";

export interface ProcessOneResult {
  outcome: ProcessOneOutcome;
  eventId: string;
  partnerCount?: number;
  heldCount?: number;
  creditCount?: number;
  errorMessage?: string;
}

/** Convert a Decimal to a 2-dp number suitable for numericFlex inserts. */
function toNum2(d: Decimal): number {
  return parseFloat(d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));
}

/** Convert a Decimal to a 4-dp number for quantity columns. */
function toNum4(d: Decimal): number {
  return parseFloat(d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
}

export async function processOne(
  db: AppDb,
  eventId: string,
): Promise<ProcessOneResult> {
  // ── Flag gate ──────────────────────────────────────────────────────────────
  if (!getFinFlag("FIN_REVENUE_ATTRIBUTION_ENABLED")) {
    return { outcome: "flag_disabled", eventId };
  }

  // ── Load event from journal ────────────────────────────────────────────────
  const [journalRow] = await db
    .select()
    .from(saleEventJournalTable)
    .where(eq(saleEventJournalTable.eventId, eventId))
    .limit(1);

  if (!journalRow) {
    return { outcome: "event_not_found", eventId };
  }

  const eventType = journalRow.eventType as SaleEventType;

  // ── Categorize (skip unsupported event types) ─────────────────────────────
  const categorization = categorizeEvent(eventType);
  if (!categorization) {
    return { outcome: "skipped_event_type", eventId };
  }

  // ── Idempotency claim ──────────────────────────────────────────────────────
  const { claimed } = await claimSaleEvent(db, {
    eventId,
    handler: HANDLER_NAME,
    notes: `Wave-3 revenue attribution for ${eventType}`,
  });
  if (!claimed) {
    return { outcome: "already_processed", eventId };
  }

  try {
    const recognizedAt = journalRow.occurredAt;
    const saleReferenceId = journalRow.saleReferenceId;
    const projectId = journalRow.projectId;
    const { revenueCategory, saleExecutorType } = categorization;

    // ── Load sale transaction ────────────────────────────────────────────────
    const [tx] = await db
      .select({ totalDeductions: salesTransactionsTable.totalDeductions })
      .from(salesTransactionsTable)
      .where(eq(salesTransactionsTable.id, saleReferenceId))
      .limit(1);

    if (!tx) {
      return {
        outcome: "sale_not_found",
        eventId,
        errorMessage: `Sale ${saleReferenceId} not found`,
      };
    }

    // totalDeductions is numericFlex → number at runtime
    const totalDeductionsD = toMoney(tx.totalDeductions as unknown as number);

    // ── Resolve blocked partners ──────────────────────────────────────────────
    const blockedIds = await getBlockedPartnerIds(db, projectId);

    // ── Resolve per-partner consumed lines ────────────────────────────────────
    const partnerLines = await getConsumedLines(db, saleReferenceId, recognizedAt);

    if (partnerLines.length === 0) {
      return { outcome: "processed", eventId, partnerCount: 0, heldCount: 0, creditCount: 0 };
    }

    // ── Split deductions pro_rata_kg ──────────────────────────────────────────
    const totalConsumedQty = partnerLines.reduce(
      (acc, p) => acc.plus(p.consumedQuantityTotal),
      ZERO,
    );

    const deductionRatios = partnerLines.map((p) =>
      totalConsumedQty.isZero() ? ZERO : p.consumedQuantityTotal.div(totalConsumedQty),
    );
    const deductionSplits = splitMoney(totalDeductionsD, deductionRatios);

    // ── Write attribution + ledger rows ───────────────────────────────────────
    let heldCount = 0;
    let creditCount = 0;
    const writeLedger = getFinFlag("FIN_LEDGER_ENABLED");

    for (let i = 0; i < partnerLines.length; i++) {
      const partner = partnerLines[i]!;
      const deductionShare = deductionSplits[i] ?? ZERO;

      const grossD = partner.grossTotal;
      const costD = deductionShare;
      const netD = grossD.minus(costD);
      const recognizedD = netD;

      // numericFlex insert requires number type
      const grossNum = toNum2(grossD);
      const costNum = toNum2(costD);
      const netNum = toNum2(netD);
      const recNum = toNum2(recognizedD);
      const qtyNum = toNum4(partner.consumedQuantityTotal);

      const isBlocked = blockedIds.has(partner.partnerId);

      if (isBlocked) {
        // ── Held path ─────────────────────────────────────────────────────────
        const attrId = randomUUID();

        await db.insert(revenueAttributionLinesTable).values({
          id: attrId,
          projectId,
          partnerId: partner.partnerId,
          saleReferenceType: journalRow.saleReferenceType,
          saleReferenceId,
          revenueCategory,
          saleExecutorType,
          consumedQuantity: qtyNum,
          consumedUnit: "kg",
          deductionAllocationBasis: "pro_rata_kg",
          grossRevenueAmount: grossNum,
          costDeductionAmount: costNum,
          netRevenueAmount: netNum,
          recognizedPartnerRevenue: recNum,
          ledgerEntryId: null,
          notes: "entitlement_held",
        }).onConflictDoNothing();

        // held_distribution_ledger uses standard numeric → string for amounts
        await db.insert(heldDistributionLedgerTable).values({
          projectId,
          partnerId: partner.partnerId,
          partnerName: partner.partnerName,
          holdType: "revenue_entitlement",
          sourceId: attrId,
          sourceType: "revenue_attribution",
          sourceDescription: `Revenue held for ${revenueCategory} — event ${eventId}`,
          heldAmount: fromMoney(recognizedD),
          ownershipPctAtTime: partner.ownershipPctAtTime.toFixed(8),
          holdReason: "inheritance_pending",
          holdNotes: `Sale event ${eventId}; partner blocked at recognition time`,
          status: "held",
        });

        heldCount++;
      } else if (writeLedger) {
        // ── Credit path (full ledger write) ───────────────────────────────────
        const ledgerId = randomUUID();

        await db.insert(partnerFinancialLedgerTable).values({
          id: ledgerId,
          projectId,
          partnerId: partner.partnerId,
          entryType: "revenue_credit",
          direction: "credit",
          amount: recNum, // numericFlex → number
          entryDate: recognizedAt,
          referenceType: "sales_transaction",
          referenceId: saleReferenceId,
          createdByHandler: HANDLER_NAME,
          description: `Revenue credit: ${revenueCategory} — ${fromMoney(recognizedD)} INR`,
          metadata: {
            eventId,
            revenueCategory,
            grossRevenueAmount: fromMoney(grossD),
            costDeductionAmount: fromMoney(costD),
            netRevenueAmount: fromMoney(netD),
            consumedQuantityKg: partner.consumedQuantityTotal.toFixed(4),
            ownershipPctAtTime: partner.ownershipPctAtTime.toFixed(8),
          },
        }).onConflictDoNothing();

        await db.insert(revenueAttributionLinesTable).values({
          projectId,
          partnerId: partner.partnerId,
          saleReferenceType: journalRow.saleReferenceType,
          saleReferenceId,
          revenueCategory,
          saleExecutorType,
          consumedQuantity: qtyNum,
          consumedUnit: "kg",
          deductionAllocationBasis: "pro_rata_kg",
          grossRevenueAmount: grossNum,
          costDeductionAmount: costNum,
          netRevenueAmount: netNum,
          recognizedPartnerRevenue: recNum,
          ledgerEntryId: ledgerId,
          notes: null,
        }).onConflictDoNothing();

        creditCount++;
      } else {
        // FIN_LEDGER_ENABLED=OFF: attribution-only dry-run mode.
        await db.insert(revenueAttributionLinesTable).values({
          projectId,
          partnerId: partner.partnerId,
          saleReferenceType: journalRow.saleReferenceType,
          saleReferenceId,
          revenueCategory,
          saleExecutorType,
          consumedQuantity: qtyNum,
          consumedUnit: "kg",
          deductionAllocationBasis: "pro_rata_kg",
          grossRevenueAmount: grossNum,
          costDeductionAmount: costNum,
          netRevenueAmount: netNum,
          recognizedPartnerRevenue: recNum,
          ledgerEntryId: null,
          notes: "ledger_disabled_dry_run",
        }).onConflictDoNothing();
        creditCount++;
      }
    }

    return { outcome: "processed", eventId, partnerCount: partnerLines.length, heldCount, creditCount };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { outcome: "error", eventId, errorMessage: msg };
  }
}

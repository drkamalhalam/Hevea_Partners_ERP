/**
 * revenueHandler/processPending.ts
 *
 * V3 Wave 3 — Sweep unprocessed sale_event_journal rows through the
 * revenue handler.
 *
 * An event is "pending" if no row exists in processed_sale_events with
 * processed_by_handler = 'sale_revenue_handler' for that event_id.
 *
 * Designed to be called from the admin reprocess endpoint and future
 * scheduled sweeps. Processes up to `limit` events per call (default 50)
 * to avoid long-running transactions.
 *
 * Returns a summary of outcomes across all processed events.
 */

import { sql, eq, and, notInArray } from "drizzle-orm";
import {
  db as appDb,
  saleEventJournalTable,
  processedSaleEventsTable,
} from "@workspace/db";
import { getFinFlag } from "../featureFlags.js";
import { processOne, type ProcessOneResult } from "./processOne.js";

type AppDb = typeof appDb;

export interface ProcessPendingOptions {
  limit?: number;
  projectId?: string;
}

export interface ProcessPendingSummary {
  total: number;
  processed: number;
  alreadyProcessed: number;
  skipped: number;
  errors: number;
  flagDisabled: number;
  results: ProcessOneResult[];
}

const HANDLER_NAME = "sale_revenue_handler";

export async function processPending(
  db: AppDb,
  opts: ProcessPendingOptions = {},
): Promise<ProcessPendingSummary> {
  const limit = opts.limit ?? 50;

  if (!getFinFlag("FIN_REVENUE_ATTRIBUTION_ENABLED")) {
    return {
      total: 0,
      processed: 0,
      alreadyProcessed: 0,
      skipped: 0,
      errors: 0,
      flagDisabled: 1,
      results: [],
    };
  }

  // ── Find event IDs already claimed by this handler ────────────────────────
  const claimedRows = await db
    .select({ eventId: processedSaleEventsTable.eventId })
    .from(processedSaleEventsTable)
    .where(eq(processedSaleEventsTable.processedByHandler, HANDLER_NAME));

  const claimedEventIds = claimedRows.map((r) => r.eventId);

  // ── Fetch pending events (exclude SaleCancelled — out of Wave 3 scope) ────
  let query = db
    .select({ eventId: saleEventJournalTable.eventId })
    .from(saleEventJournalTable)
    .where(
      and(
        ...(claimedEventIds.length > 0
          ? [notInArray(saleEventJournalTable.eventId, claimedEventIds)]
          : []),
        ...(opts.projectId
          ? [eq(saleEventJournalTable.projectId, opts.projectId)]
          : []),
        sql`${saleEventJournalTable.eventType} != 'SaleCancelled'`,
      ),
    )
    .limit(limit);

  const pendingRows = await query;

  const results: ProcessOneResult[] = [];
  for (const row of pendingRows) {
    const result = await processOne(db, row.eventId);
    results.push(result);
  }

  const summary: ProcessPendingSummary = {
    total: results.length,
    processed: results.filter((r) => r.outcome === "processed").length,
    alreadyProcessed: results.filter((r) => r.outcome === "already_processed").length,
    skipped: results.filter((r) => r.outcome === "skipped_event_type" || r.outcome === "event_not_found").length,
    errors: results.filter((r) => r.outcome === "error").length,
    flagDisabled: results.filter((r) => r.outcome === "flag_disabled").length,
    results,
  };

  return summary;
}

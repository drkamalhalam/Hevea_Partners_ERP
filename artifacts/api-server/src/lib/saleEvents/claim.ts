/**
 * saleEvents/claim.ts
 *
 * V3 Wave 2 — Per-handler idempotency claim helper.
 *
 * Composite UNIQUE(event_id, processed_by_handler) on processed_sale_events
 * lets each handler independently claim a given event exactly once. Returns
 * `true` iff this call inserted the claim row (i.e., the handler should
 * proceed with processing). Returns `false` if a prior claim exists.
 *
 * Wave 2 has zero callers.
 */

import { sql } from "drizzle-orm";
import { processedSaleEventsTable } from "@workspace/db/schema";

export interface ClaimSaleEventInput {
  eventId: string;
  handler: string;
  notes?: string;
}

export interface ClaimSaleEventResult {
  claimed: boolean;
}

type DbHandle = {
  execute: (query: ReturnType<typeof sql>) => Promise<{
    rows: Array<{ id: string }>;
  }>;
};

export async function claimSaleEvent(
  db: DbHandle,
  input: ClaimSaleEventInput,
): Promise<ClaimSaleEventResult> {
  const { eventId, handler, notes } = input;
  const result = await db.execute(sql`
    INSERT INTO ${processedSaleEventsTable}
      (event_id, processed_by_handler, notes)
    VALUES (
      ${eventId}::uuid,
      ${handler},
      ${notes ?? null}
    )
    ON CONFLICT (event_id, processed_by_handler) DO NOTHING
    RETURNING id
  `);
  return { claimed: result.rows.length > 0 };
}

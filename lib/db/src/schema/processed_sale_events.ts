/**
 * processed_sale_events.ts
 *
 * V3 Partner Financial Ledger — Wave 1 (schema only).
 *
 * Idempotency tracker. UNIQUE on event_id guarantees at-most-once
 * processing of any envelope from sale_event_journal.
 */

import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const processedSaleEventsTable = pgTable(
  "processed_sale_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),

    /** Handler that processed the event (e.g., sale_revenue_handler). */
    processedByHandler: text("processed_by_handler").notNull(),

    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Optional notes (e.g., short outcome). */
    notes: text("notes"),
  },
  (t) => ({
    uniqueEventId: uniqueIndex("pse_event_id_uq").on(t.eventId),
  }),
);

export type ProcessedSaleEvent = typeof processedSaleEventsTable.$inferSelect;
export type ProcessedSaleEventInsert =
  typeof processedSaleEventsTable.$inferInsert;

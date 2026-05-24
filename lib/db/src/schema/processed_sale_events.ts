/**
 * processed_sale_events.ts
 *
 * V3 Partner Financial Ledger — Wave 1 schema, Wave 2 uniqueness refinement.
 *
 * Idempotency tracker. Composite UNIQUE on (event_id, processed_by_handler)
 * guarantees at-most-once processing per (event, handler) pair, allowing
 * multiple independent consumers to fan-out over the same envelope.
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
    uniqueEventHandler: uniqueIndex("pse_event_handler_uq").on(
      t.eventId,
      t.processedByHandler,
    ),
  }),
);

export type ProcessedSaleEvent = typeof processedSaleEventsTable.$inferSelect;
export type ProcessedSaleEventInsert =
  typeof processedSaleEventsTable.$inferInsert;

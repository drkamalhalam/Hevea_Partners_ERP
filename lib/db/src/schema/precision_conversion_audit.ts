import { pgTable, uuid, text, timestamp, real, doublePrecision, index } from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";

/**
 * precision_conversion_audit — append-only record of every row whose
 * monetary column was migrated from `real` (float4) to `numeric(15,2)`.
 *
 * NPF Stage 2 mandates:
 *   - Per-row capture of (table, pk, column, original, converted, delta).
 *   - Append-only: NO update/delete routes ever expose this table.
 *   - Non-zero deltas (rounding events) are surfaced via the data-health
 *     "values exceeding target precision" diagnostic.
 *
 * Population strategy:
 *   - For empty target tables at migration time (e.g. dev DB on first push),
 *     no rows are inserted — there is nothing to convert. The schema exists
 *     so future re-migrations or production cut-overs can write to it.
 *   - For production cut-overs the operator runs a one-shot SQL snapshot
 *     BEFORE the ALTER COLUMN, inserting one row per source row.
 */
export const precisionConversionAuditTable = pgTable(
  "precision_conversion_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Source table name (e.g. "contributions"). */
    sourceTable: text("source_table").notNull(),

    /** Source row primary key. */
    sourceRowId: uuid("source_row_id").notNull(),

    /** Source column name (e.g. "amount"). */
    sourceColumn: text("source_column").notNull(),

    /** Original value from the `real` column. Stored as double for exact echo. */
    originalValue: doublePrecision("original_value"),

    /** Value after ALTER + ROUND(..., 2). */
    convertedValue: numericFlex("converted_value", { precision: 15, scale: 2 }),

    /** convertedValue - originalValue (signed). Non-zero ⇒ rounding event. */
    delta: doublePrecision("delta"),

    /** When the migration row was captured. */
    migratedAt: timestamp("migrated_at").notNull().defaultNow(),

    /** Optional note (script name, batch id, operator). */
    notes: text("notes"),
  },
  (t) => ({
    bySource: index("pca_source_idx").on(t.sourceTable, t.sourceColumn),
    byRow: index("pca_row_idx").on(t.sourceTable, t.sourceRowId),
  }),
);

export type PrecisionConversionAudit = typeof precisionConversionAuditTable.$inferSelect;
export type InsertPrecisionConversionAudit = typeof precisionConversionAuditTable.$inferInsert;

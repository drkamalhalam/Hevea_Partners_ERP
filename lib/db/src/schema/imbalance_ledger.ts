import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { burdenRecordsTable } from "./burden";

/**
 * imbalanceLedgerTable — double-entry style imbalance accounting.
 *
 * Each row is a signed transaction for one party in one project:
 *   amount > 0 → credit  (this party is owed money by the other)
 *   amount < 0 → debit   (this party owes money to the other)
 *
 * Developer and landowner entries for the same event always sum to zero.
 * Running balance is computed on the fly: SUM(amount) up to a given row.
 *
 * Entry types:
 *   burden_imbalance  — created automatically from a new burden record with imbalance
 *   recovery          — created automatically when a recovery payment is recorded
 *   waiver            — created automatically when an imbalance is waived
 *   manual            — manual adjustment entered by admin
 *   carry_forward     — explicit period carry-forward entry
 *
 * Future settlement engines will consume these rows to produce settlement
 * proposals. This table is the source of truth for all imbalance positions.
 */
export const imbalanceLedgerTable = pgTable("imbalance_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── Scope ─────────────────────────────────────────────────────────────────
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // 'developer' or 'landowner'
  partyRole: text("party_role").notNull(),

  // ── Amount ────────────────────────────────────────────────────────────────
  // Signed: positive = credit (owed to this party), negative = debit (owed by this party)
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),

  // ── Classification ────────────────────────────────────────────────────────
  entryType: text("entry_type").notNull(),

  // Optional link to the burden record that triggered this entry
  burdenRecordId: uuid("burden_record_id").references(
    () => burdenRecordsTable.id,
    { onDelete: "set null" },
  ),

  // Accounting period (YYYY-MM), optional
  period: text("period"),

  // Human-readable description
  description: text("description").notNull(),
  notes: text("notes"),

  // ── Soft delete ───────────────────────────────────────────────────────────
  isActive: boolean("is_active").notNull().default(true),

  // ── Audit ─────────────────────────────────────────────────────────────────
  createdById: uuid("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

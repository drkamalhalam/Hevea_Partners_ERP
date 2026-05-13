import {
  pgTable,
  uuid,
  text,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { landownerLedgerTable } from "./landowner_accounting";

/**
 * burdenRecoveryAdjustmentsTable
 *
 * Tracks operational costs that were temporarily paid by a non-landowner
 * participant (e.g. the developer) in a 50% revenue model project, and
 * must be recovered from the landowner's 50% revenue share.
 *
 * CRITICAL INVARIANT: Recording a recovery adjustment NEVER creates or
 * transfers ownership rights. isOwnershipCreating is always false.
 *
 * How it works in a 50% revenue model:
 *   1. A participant (sourcePartner) pays an operational cost on behalf of
 *      the landowner (targetPartner).
 *   2. A BurdenRecoveryAdjustment records the event and the recoverable amount.
 *   3. Recovery events (burdenRecoveryEventsTable) record each deduction from
 *      the landowner's revenue share as it is settled.
 *   4. Once recoveredAmount >= recoverableAmount the status transitions to
 *      "recovered".
 */
export const burdenRecoveryAdjustmentsTable = pgTable(
  "burden_recovery_adjustments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // ── Project scope ──────────────────────────────────────────────────────
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),

    // ── Parties ───────────────────────────────────────────────────────────
    sourcePartnerId: uuid("source_partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    // The participant who temporarily paid the cost (e.g. developer).

    targetPartnerId: uuid("target_partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),
    // The landowner whose share will bear this cost.

    // ── Description ────────────────────────────────────────────────────────
    description: text("description").notNull(),

    costCategory: text("cost_category"),
    // Free-text category: e.g. "tapping labour", "fertiliser", "transport"

    // ── Amounts ────────────────────────────────────────────────────────────
    totalAmount: real("total_amount").notNull(),
    // Full cost originally paid by the source participant (always positive).

    recoverableAmount: real("recoverable_amount").notNull(),
    // Portion charged to this landowner's share. Usually == totalAmount
    // but may be less if costs are shared across multiple landowners.

    recoveredAmount: real("recovered_amount").notNull().default(0),
    // Running total recovered so far (updated atomically on each event).

    // ── Revenue model ──────────────────────────────────────────────────────
    revenueModelType: text("revenue_model_type")
      .notNull()
      .default("fifty_percent_revenue"),
    // Always "fifty_percent_revenue" for this system.

    // ── Period ────────────────────────────────────────────────────────────
    periodLabel: text("period_label").notNull(),
    periodStart: text("period_start").notNull(), // YYYY-MM-DD
    periodEnd: text("period_end").notNull(),       // YYYY-MM-DD

    // ── Recovery status ────────────────────────────────────────────────────
    recoveryStatus: text("recovery_status").notNull().default("pending"),
    // pending | partial | recovered | waived

    // ── Optional link to landowner ledger ─────────────────────────────────
    linkedLedgerEntryId: uuid("linked_ledger_entry_id").references(
      () => landownerLedgerTable.id,
      { onDelete: "set null" },
    ),
    // If an operational_burden entry was already created in the landowner
    // ledger for this cost, link it here for traceability.

    // ── OWNERSHIP FIREWALL ─────────────────────────────────────────────────
    isOwnershipCreating: boolean("is_ownership_creating")
      .notNull()
      .default(false),
    // MUST always remain false. Persisted so auditors can verify the invariant.

    notes: text("notes"),

    // ── Audit ─────────────────────────────────────────────────────────────
    recordedById: uuid("recorded_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    recordedByName: text("recorded_by_name").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * burdenRecoveryEventsTable
 *
 * Append-only ledger of individual recovery transactions.
 * Each row records one deduction from the landowner's revenue share.
 * The adjustmentId row is updated atomically (recoveredAmount, recoveryStatus).
 */
export const burdenRecoveryEventsTable = pgTable("burden_recovery_events", {
  id: uuid("id").defaultRandom().primaryKey(),

  adjustmentId: uuid("adjustment_id")
    .notNull()
    .references(() => burdenRecoveryAdjustmentsTable.id, {
      onDelete: "cascade",
    }),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  amountRecovered: real("amount_recovered").notNull(),
  // Amount deducted from landowner share in this single recovery event.

  recoveryDate: text("recovery_date").notNull(), // YYYY-MM-DD

  recoveryRef: text("recovery_ref"),
  // Optional reference: invoice number, cheque no., ledger entry ID, etc.

  notes: text("notes"),

  recordedById: uuid("recorded_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  recordedByName: text("recorded_by_name").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

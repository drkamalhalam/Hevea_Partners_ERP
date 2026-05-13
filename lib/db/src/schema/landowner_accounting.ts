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

/**
 * landownerLedgerTable — landowner-side accounting ledger.
 *
 * Tracks four distinct financial flows, all scoped to a (project, partner) pair:
 *   revenue_entitlement — credits in the landowner's favour (their gross revenue share)
 *   operational_burden  — debits charged against the landowner (their operational cost share)
 *   recoverable_adjustment — credit or debit adjustments that can be netted off
 *   lca_credit          — LCA advances already paid to/by the landowner (informational)
 *   other_credit / other_debit — catch-all entries
 *
 * DELIBERATELY SEPARATE from:
 *   - contributions / economic participant pool accounting
 *   - ownership snapshot / freeze systems
 *
 * Net position formula (confirmed entries only):
 *   net = Σ(credit amounts) − Σ(debit amounts)
 *       + lca_receivable (from lca_ledger, computed at query time)
 *
 * Future integration hooks:
 *   - ownershipPct comes from the ownership model (currently manual)
 *   - grossRevenue can be auto-populated from sales entries when that module is live
 *   - revenueModelType signals which model applies (contribution | fifty_percent_revenue)
 */
export const landownerLedgerTable = pgTable("landowner_ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  // ── Entry classification ───────────────────────────────────────────────────
  // entry_type groups entries for reporting. direction is stored explicitly.
  entryType: text("entry_type").notNull(),
  // Valid values: revenue_entitlement | operational_burden |
  //   recoverable_adjustment | lca_credit | other_credit | other_debit

  direction: text("direction").notNull(),
  // Valid values: credit | debit

  // ── Period ────────────────────────────────────────────────────────────────
  periodLabel: text("period_label").notNull(),
  // Human-readable period label, e.g. "FY 2024-25 Q1", "2024-03"

  periodStart: text("period_start").notNull(),
  // YYYY-MM-DD

  periodEnd: text("period_end").notNull(),
  // YYYY-MM-DD

  // ── Core financials ───────────────────────────────────────────────────────
  description: text("description").notNull(),

  amount: real("amount").notNull(),
  // Always stored positive. direction field determines sign in summaries.

  // ── Revenue entitlement metadata (type=revenue_entitlement only) ──────────
  grossRevenue: real("gross_revenue"),
  // Total project gross revenue for this period (before any split)

  ownershipPct: real("ownership_pct"),
  // Landowner's ownership percentage at the time this entry was recorded

  revenueModelType: text("revenue_model_type"),
  // contribution | fifty_percent_revenue — which revenue model applies

  // ── Recoverability (type=operational_burden) ──────────────────────────────
  isRecoverable: boolean("is_recoverable").notNull().default(false),

  recoveredAmount: real("recovered_amount").notNull().default(0),

  recoveryStatus: text("recovery_status").notNull().default("none"),
  // none | partial | full

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  status: text("status").notNull().default("draft"),
  // draft | confirmed | disputed | reversed

  notes: text("notes"),

  // ── Audit ─────────────────────────────────────────────────────────────────
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
});

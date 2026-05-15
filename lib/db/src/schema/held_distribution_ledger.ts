/**
 * held_distribution_ledger.ts
 *
 * Tracks profit, sale proceeds, and other distributions that are being held
 * because the recipient partner's ownership is under dispute or lock.
 *
 * Business rules enforced at API layer:
 *   - Only the disputed/locked share of a distribution is held.
 *   - The rest of the project's profit distribution continues normally.
 *   - Held amounts are released by admin action with a required release reason.
 *   - Historical records are write-once; release is recorded via releasedAt + status.
 *
 * Status state machine: held → released | forfeited
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

export const heldDistributionLedgerTable = pgTable("held_distribution_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  partnerName: text("partner_name").notNull(),

  // ── Hold classification ───────────────────────────────────────────────────
  // profit_distribution | sale_proceeds | lca_credit | revenue_entitlement | other
  holdType: text("hold_type").notNull(),

  // ── Source tracing ────────────────────────────────────────────────────────
  sourceId: uuid("source_id"), // FK to distribution session / sale / event
  sourceType: text("source_type"), // 'fifty_pct_session' | 'sales_transaction' | 'lca_event' | 'manual'
  sourceDescription: text("source_description").notNull(),

  periodYear: integer("period_year"),

  // ── Amounts ───────────────────────────────────────────────────────────────
  // INR amounts stored with 2 dp
  heldAmount: numeric("held_amount", { precision: 15, scale: 2 }).notNull(),

  // Ownership % at the time this hold was created (snapshot for audit)
  ownershipPctAtTime: numeric("ownership_pct_at_time", {
    precision: 12,
    scale: 8,
  }),

  // ── Reason for holding ───────────────────────────────────────────────────
  // 'ownership_dispute' | 'payment_dispute' | 'governance_lock' | 'inheritance_pending' | 'admin_hold'
  holdReason: text("hold_reason").notNull(),
  holdNotes: text("hold_notes"),

  // ── Status ────────────────────────────────────────────────────────────────
  // held → released | forfeited
  status: text("status").notNull().default("held"),

  // ── Release info ─────────────────────────────────────────────────────────
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedAmount: numeric("released_amount", { precision: 15, scale: 2 }),
  // 'original_partner' | 'dispute_settlement' | 'alternative_party' | 'forfeited'
  releasedTo: text("released_to"),
  releaseNotes: text("release_notes").notNull().default(""),
  releasedBy: uuid("released_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  releasedByName: text("released_by_name"),

  // ── Audit ─────────────────────────────────────────────────────────────────
  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type HeldDistributionLedger =
  typeof heldDistributionLedgerTable.$inferSelect;
export type HeldDistributionLedgerInsert =
  typeof heldDistributionLedgerTable.$inferInsert;

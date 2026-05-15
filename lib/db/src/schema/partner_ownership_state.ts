/**
 * partner_ownership_state.ts
 *
 * Per-(project, partner) ownership state breakdown.
 *
 * Tracks how a partner's total ownership percentage is divided into:
 *   - transferable  : freely transferable to another party
 *   - locked        : locked by governance decision / admin action
 *   - disputed      : under active dispute (profit held separately)
 *   - reserved      : temporarily reserved by a pending transfer request
 *
 * totalPercentage should always equal sum of the four state columns.
 *
 * Updated by:
 *   - Transfer execution (reserved → transferred, remaining → transferable)
 *   - Dispute actions (transferable → disputed / disputed → transferable)
 *   - Admin lock actions
 *
 * High-precision decimals (12,8) to support repeated splitting without drift.
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { usersTable } from "./users";

export const partnerOwnershipStatesTable = pgTable("partner_ownership_states", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  partnerName: text("partner_name").notNull(),

  // ── Ownership breakdown (high-precision, sum = totalPercentage) ────────────
  totalPercentage: numeric("total_percentage", { precision: 12, scale: 8 })
    .notNull()
    .default("0"),

  transferablePercentage: numeric("transferable_percentage", {
    precision: 12,
    scale: 8,
  })
    .notNull()
    .default("0"),

  lockedPercentage: numeric("locked_percentage", { precision: 12, scale: 8 })
    .notNull()
    .default("0"),

  disputedPercentage: numeric("disputed_percentage", {
    precision: 12,
    scale: 8,
  })
    .notNull()
    .default("0"),

  reservedPercentage: numeric("reserved_percentage", {
    precision: 12,
    scale: 8,
  })
    .notNull()
    .default("0"),

  // ── Dispute tracking ──────────────────────────────────────────────────────
  disputeReason: text("dispute_reason"),
  disputedSince: timestamp("disputed_since", { withTimezone: true }),
  disputeReference: text("dispute_reference"), // e.g. case ID / notes

  // ── Lock tracking ─────────────────────────────────────────────────────────
  lockReason: text("lock_reason"),
  lockedSince: timestamp("locked_since", { withTimezone: true }),

  // ── Notes ─────────────────────────────────────────────────────────────────
  notes: text("notes"),

  updatedBy: uuid("updated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  updatedByName: text("updated_by_name"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PartnerOwnershipState =
  typeof partnerOwnershipStatesTable.$inferSelect;
export type PartnerOwnershipStateInsert =
  typeof partnerOwnershipStatesTable.$inferInsert;

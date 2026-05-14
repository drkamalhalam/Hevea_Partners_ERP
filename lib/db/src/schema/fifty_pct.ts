/**
 * fifty_pct.ts
 *
 * DB schema for the 50% Revenue Model settlement engine.
 *
 * Architecture:
 *   Gross Revenue × 50% → Landowner Side (bears all operational costs + LCA)
 *   Gross Revenue × 50% → Economic Participant Pool (never reduced by costs)
 *
 * EPP is distributed by verified economic participation percentages.
 * Land contribution itself is EXCLUDED from EPP — only additional verified
 * economic contributions participate in the EPP.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  numeric,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";

// ── Main settlement session ────────────────────────────────────────────────

export const fiftyPctSessionsTable = pgTable("fifty_pct_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // Period
  periodLabel: text("period_label").notNull(),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  periodYear: integer("period_year"),

  // Revenue
  grossRevenue: numeric("gross_revenue", { precision: 15, scale: 2 }).notNull(),
  revenueSource: text("revenue_source").notNull().default("manual"),
  linkedSaleIds: jsonb("linked_sale_ids").notNull().default([]),

  // 50/50 split (always equal halves)
  landownerSplit: numeric("landowner_split", { precision: 15, scale: 2 }).notNull(),
  participantPoolSplit: numeric("participant_pool_split", { precision: 15, scale: 2 }).notNull(),

  // Landowner-side deductions
  operationalCost: numeric("operational_cost", { precision: 15, scale: 2 }).notNull().default("0"),
  lcaAmount: numeric("lca_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  lcaSource: text("lca_source").notNull().default("manual"),

  // Landowner net (computed: landownerSplit − opCost − lca, floored at 0)
  landownerNet: numeric("landowner_net", { precision: 15, scale: 2 }).notNull().default("0"),

  // EPP summary (denormalised for quick display — entries in epp_entries table)
  eppTotalAllocated: numeric("epp_total_allocated", { precision: 15, scale: 2 }).notNull().default("0"),
  eppRemainder: numeric("epp_remainder", { precision: 15, scale: 2 }).notNull().default("0"),

  // Lifecycle
  status: text("status").notNull().default("draft"),
  notes: text("notes"),

  // Audit
  calculatedBy: uuid("calculated_by").references(() => usersTable.id, { onDelete: "set null" }),
  calculatedByName: text("calculated_by_name"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: uuid("confirmed_by").references(() => usersTable.id, { onDelete: "set null" }),
  confirmedByName: text("confirmed_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── EPP participant entry ──────────────────────────────────────────────────

export const eppEntriesTable = pgTable("epp_entries", {
  id: uuid("id").primaryKey().defaultRandom(),

  sessionId: uuid("session_id")
    .notNull()
    .references(() => fiftyPctSessionsTable.id, { onDelete: "cascade" }),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // Participant (nullable — may be an external entity not in partners table)
  participantId: uuid("participant_id").references(() => partnersTable.id, {
    onDelete: "set null",
  }),
  participantKey: text("participant_key").notNull(),
  participantName: text("participant_name").notNull(),

  // Participation
  participationPct: numeric("participation_pct", { precision: 8, scale: 4 }).notNull(),
  allocatedAmount: numeric("allocated_amount", { precision: 15, scale: 2 }).notNull().default("0"),

  // Contribution type — land contribution must NOT appear here
  // economic_only: pure economic contribution (investment, development work, etc.)
  // landowner_additional: landowner has additional economic contribution beyond their land
  // external: third-party contributor not in partner registry
  contributionType: text("contribution_type").notNull().default("economic_only"),
  isLandownerAdditional: boolean("is_landowner_additional").notNull().default(false),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── TypeScript types ───────────────────────────────────────────────────────

export type FiftyPctSession = typeof fiftyPctSessionsTable.$inferSelect;
export type FiftyPctSessionInsert = typeof fiftyPctSessionsTable.$inferInsert;
export type EppEntry = typeof eppEntriesTable.$inferSelect;
export type EppEntryInsert = typeof eppEntriesTable.$inferInsert;

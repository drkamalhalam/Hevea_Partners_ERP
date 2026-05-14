/**
 * settlement_overrides.ts
 *
 * Manual settlement override and finalization system.
 *
 * Architecture:
 *   - settlementRecordsTable   — one record per (project, partner, period, type)
 *   - settlementOverrideEventsTable — IMMUTABLE audit trail; never updated or deleted
 *
 * Status machine (forward-only except reopen):
 *   draft → recommended → overridden → finalized
 *               ↘ disputed (from any non-finalized state)
 *   finalized → draft  (reopen — admin only, creates audit event)
 *
 * Authority model:
 *   - Any authenticated user may call /override (propose + apply in one step)
 *   - Admin / developer / Project-Developer role may finalize
 *   - Admin only may reopen a finalized record
 *   - Every state change writes an immutable event row
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";

// ── Settlement records ─────────────────────────────────────────────────────

export const settlementRecordsTable = pgTable("settlement_records", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Scope
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  partnerId: uuid("partner_id")
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  // Source linkage (optional — links back to the engine that generated the recommendation)
  settlementType: text("settlement_type").notNull(), // 'fifty_pct' | 'payable' | 'lca' | 'loss_absorption' | 'manual'
  sourceReferenceId: uuid("source_reference_id"), // FK into the source table (not enforced at DB level for flexibility)

  // Period
  periodLabel: text("period_label").notNull(),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),

  // ── Recommended settlement (system-generated, write-once after first set) ──
  recommendedAmount: numeric("recommended_amount", { precision: 15, scale: 2 }),
  recommendedBreakdown: jsonb("recommended_breakdown"), // point-in-time snapshot
  recommendedAt: timestamp("recommended_at", { withTimezone: true }),
  recommendedBy: uuid("recommended_by").references(() => usersTable.id, { onDelete: "set null" }),
  recommendedByName: text("recommended_by_name"),

  // ── Actual settlement (editable until finalized) ──────────────────────────
  actualAmount: numeric("actual_amount", { precision: 15, scale: 2 }),
  actualBreakdown: jsonb("actual_breakdown"),

  // ── Override metadata ─────────────────────────────────────────────────────
  isOverridden: boolean("is_overridden").notNull().default(false),
  overrideRemarks: text("override_remarks"),
  overrideCount: integer("override_count").notNull().default(0),
  lastOverriddenAt: timestamp("last_overridden_at", { withTimezone: true }),
  lastOverriddenBy: uuid("last_overridden_by").references(() => usersTable.id, { onDelete: "set null" }),
  lastOverriddenByName: text("last_overridden_by_name"),
  lastOverriddenByRole: text("last_overridden_by_role"),

  // ── Status machine ────────────────────────────────────────────────────────
  status: text("status").notNull().default("draft"),
  // 'draft' | 'recommended' | 'overridden' | 'finalized' | 'disputed'

  // ── Finalization ──────────────────────────────────────────────────────────
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  finalizedBy: uuid("finalized_by").references(() => usersTable.id, { onDelete: "set null" }),
  finalizedByName: text("finalized_by_name"),
  finalizedByRole: text("finalized_by_role"),
  finalizationNotes: text("finalization_notes"),

  // ── General ───────────────────────────────────────────────────────────────
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),

  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Settlement override events (IMMUTABLE audit trail) ────────────────────

export const settlementOverrideEventsTable = pgTable("settlement_override_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Parent record
  settlementRecordId: uuid("settlement_record_id")
    .notNull()
    .references(() => settlementRecordsTable.id, { onDelete: "restrict" }),

  // Denormalized for query efficiency (events must remain readable even if parent is archived)
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  partnerId: uuid("partner_id").references(() => partnersTable.id, { onDelete: "set null" }),

  // Event classification
  // 'created' | 'recommendation_set' | 'overridden' | 'finalized' | 'disputed' | 'reopened'
  eventType: text("event_type").notNull(),

  // Change capture — full before/after snapshot for tamper-evident audit
  previousAmount: numeric("previous_amount", { precision: 15, scale: 2 }),
  newAmount: numeric("new_amount", { precision: 15, scale: 2 }),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),

  // Actor
  performedBy: uuid("performed_by").references(() => usersTable.id, { onDelete: "set null" }),
  performedByName: text("performed_by_name"),
  performedByRole: text("performed_by_role"),

  // Reason / remarks
  remarks: text("remarks"),

  // Additional snapshot context (breakdown, metadata, etc.)
  metadata: jsonb("metadata"),

  // Immutable timestamp — never updated
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
});

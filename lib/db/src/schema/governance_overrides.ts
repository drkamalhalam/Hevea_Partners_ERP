/**
 * governance_overrides.ts
 *
 * Immutable record of every manual override, governance action, and deviation
 * from system-recommended values across all modules.
 *
 * Write-once: no UPDATE or DELETE routes exist on this table.
 * Every row is a permanent, tamper-evident entry in the legal audit trail.
 *
 * Override types:
 *   settlement_distribution   — settlement amount overridden from recommendation
 *   settlement_finalized       — settlement record finalized (locked)
 *   settlement_reopened        — finalized settlement reopened by admin
 *   contribution_dispute_resolved — disputed contribution re-verified
 *   contribution_dispute_rejected — disputed contribution rejected
 *   lca_ledger_adjustment      — LCA ledger entry manually adjusted or waived
 *   transfer_price_override    — valuation final price overridden
 *   ownership_transfer         — ownership share transfer executed
 *   expenditure_approved       — expenditure approved after verification
 *   expenditure_rejected       — expenditure rejected after verification
 *   governance_manual_note     — free-form admin governance note
 */

import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const governanceOverridesTable = pgTable("governance_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Scope
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  // Classification
  overrideType: text("override_type").notNull(),
  module: text("module").notNull(),
  // contributions | expenditures | settlement | lca | ownership | valuations | governance

  // Human-readable summary
  title: text("title").notNull(),
  description: text("description"),

  // ── Core audit data ──────────────────────────────────────────────────────────
  originalValue: jsonb("original_value"),  // point-in-time snapshot before override
  finalValue: jsonb("final_value"),        // what was actually applied
  overrideReason: text("override_reason"),

  // ── Actor ────────────────────────────────────────────────────────────────────
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  actorRole: text("actor_role"),

  // ── Linked record ────────────────────────────────────────────────────────────
  relatedTable: text("related_table"),
  relatedRecordId: text("related_record_id"),

  // ── Supporting documents (placeholder for future doc attachment) ─────────────
  supportingDocuments: jsonb("supporting_documents"),
  // Format: [{ label: string, url: string, uploadedAt: string }]

  // ── Extra context ────────────────────────────────────────────────────────────
  metadata: jsonb("metadata"),

  // ── Immutable timestamps ─────────────────────────────────────────────────────
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GovernanceOverride = typeof governanceOverridesTable.$inferSelect;
export type GovernanceOverrideInsert = typeof governanceOverridesTable.$inferInsert;

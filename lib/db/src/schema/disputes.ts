/**
 * disputes.ts
 *
 * Unified dispute and conflict traceability system.
 *
 * Architecture:
 *   - disputesTable              — mutable main dispute record (status-tracked)
 *   - disputeResolutionEventsTable — IMMUTABLE resolution event history (never deleted)
 *
 * Dispute types:
 *   contribution   — disputed contribution verification
 *   expenditure    — disputed expenditure or verification decision
 *   settlement     — disputed settlement amount/recommendation
 *   ownership      — disputed ownership percentage
 *   inheritance    — disputed inheritance claim or share
 *   governance     — governance conflict or procedural dispute
 *
 * Status machine:
 *   open → under_review → resolved
 *              ↘ escalated (from open or under_review)
 *   Any non-resolved state → withdrawn
 *
 * Important: Project operations continue while disputes are recorded.
 * No route should gate project operations on dispute status.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

// ── Main dispute record ──────────────────────────────────────────────────────

export const disputesTable = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Scope
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  // Classification
  disputeType: text("dispute_type").notNull(),
  // contribution | expenditure | settlement | ownership | inheritance | governance

  status: text("status").notNull().default("open"),
  // open | under_review | resolved | withdrawn | escalated

  severity: text("severity").notNull().default("medium"),
  // low | medium | high | critical

  // ── Content ────────────────────────────────────────────────────────────────
  title: text("title").notNull(),
  description: text("description"),

  // ── Who raised it ──────────────────────────────────────────────────────────
  raisedById: uuid("raised_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  raisedByName: text("raised_by_name"),
  raisedByRole: text("raised_by_role"),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),

  // ── Linked record (the entity being disputed) ──────────────────────────────
  relatedTable: text("related_table"),
  relatedRecordId: text("related_record_id"),

  // ── Supporting documents placeholder ──────────────────────────────────────
  supportingDocuments: jsonb("supporting_documents"),
  // Format: [{ label: string, url: string, uploadedAt: string }]

  // ── Resolution ─────────────────────────────────────────────────────────────
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: uuid("resolved_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  resolvedByName: text("resolved_by_name"),
  resolvedByRole: text("resolved_by_role"),
  resolutionSummary: text("resolution_summary"),

  // ── Extra context ──────────────────────────────────────────────────────────
  metadata: jsonb("metadata"),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Immutable resolution event history ───────────────────────────────────────

export const disputeResolutionEventsTable = pgTable("dispute_resolution_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Parent
  disputeId: uuid("dispute_id")
    .notNull()
    .references(() => disputesTable.id, { onDelete: "cascade" }),

  // Denormalized for query efficiency
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  // Event classification
  // raised | under_review | note_added | resolved | withdrawn | escalated
  eventType: text("event_type").notNull(),

  // Change capture
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  description: text("description"),

  // Actor
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorName: text("actor_name"),
  actorRole: text("actor_role"),

  // Additional context
  metadata: jsonb("metadata"),

  // Immutable timestamp — never updated
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type Dispute = typeof disputesTable.$inferSelect;
export type DisputeInsert = typeof disputesTable.$inferInsert;
export type DisputeResolutionEvent = typeof disputeResolutionEventsTable.$inferSelect;

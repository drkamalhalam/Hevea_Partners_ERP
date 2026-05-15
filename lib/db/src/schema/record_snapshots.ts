/**
 * record_snapshots.ts
 *
 * Unified, append-only historical snapshot archive.
 *
 * Each row captures the complete serialized state of an important business
 * record at a specific point in time.  Once written, rows are NEVER modified
 * or deleted through the application — this is the immutability guarantee that
 * makes the table legally meaningful.
 *
 * Supported snapshot types (snapshotType field):
 *   ownership_state       — all partner_ownership_states for a project
 *   agreement             — agreement row + latest generation snapshot
 *   settlement_session    — fifty_pct_session + EPP entries
 *   distribution_preview  — full distribution_previews row
 *   financial_position    — landowner ledger summary per partner per project
 *   lca_position          — full lca_ledger for a project
 *
 * entityId is stored as text (not uuid) to remain agnostic of the referenced
 * table's PK type.  entityType records the canonical table name.
 *
 * triggerType documents what caused the snapshot:
 *   manual                — admin / developer explicitly requested
 *   auto_pre_transfer     — auto-captured before an ownership transfer is executed
 *   auto_pre_settlement   — auto-captured before a settlement is confirmed
 *   auto_lifecycle        — auto-captured on project lifecycle transition
 *   auto_maturity         — auto-captured at maturity declaration
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const recordSnapshotsTable = pgTable("record_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── What was snapshotted ──────────────────────────────────────────────────
  snapshotType: text("snapshot_type").notNull(),
  entityId: text("entity_id"),         // UUID of source record (text for type-agnosticism)
  entityType: text("entity_type").notNull(), // table name, e.g. 'agreements'

  // ── Context ───────────────────────────────────────────────────────────────
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  projectName: text("project_name"), // denormalized — survives project renames

  // ── Human labels ─────────────────────────────────────────────────────────
  label: text("label"),   // e.g. "Pre-transfer baseline", "FY 2024-25 close"
  notes: text("notes"),

  // ── The immutable payload ─────────────────────────────────────────────────
  snapshotData: jsonb("snapshot_data")
    .$type<Record<string, unknown>>()
    .notNull(),

  // ── Provenance ────────────────────────────────────────────────────────────
  triggerType: text("trigger_type").notNull().default("manual"),

  capturedById: uuid("captured_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  capturedByName: text("captured_by_name"),
  capturedByRole: text("captured_by_role"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RecordSnapshot = typeof recordSnapshotsTable.$inferSelect;
export type InsertRecordSnapshot = typeof recordSnapshotsTable.$inferInsert;

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * project_timeline_events — immutable evidentiary history of every
 * significant governance, financial and operational event for each project.
 *
 * This table is append-only. No updates or deletes should ever occur on it.
 * It serves as the legal/evidentiary record of all material project events.
 *
 * eventType vocabulary (non-exhaustive — use the constants in timelineLogger.ts):
 *   agreement_activated          lifecycle_changed
 *   contribution_approved        ownership_frozen
 *   contribution_rejected        ownership_freeze_lifted
 *   contribution_disputed        ownership_transfer_initiated
 *   contribution_verified        ownership_transfer_executed
 *   expenditure_approved         inheritance_claim_filed
 *   expenditure_rejected         inheritance_claim_approved
 *   maturity_declared            nominee_activated
 *   project_closed               distribution_session_opened
 *   settlement_distributed       governance_note
 */
export const projectTimelineEventsTable = pgTable("project_timeline_events", {
  id: uuid("id").defaultRandom().primaryKey(),

  /** The project this event belongs to */
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  /** Structured event type — matches constants in timelineLogger.ts */
  eventType: text("event_type").notNull(),

  /** Short, human-readable title displayed in the timeline */
  title: text("title").notNull(),

  /** Longer narrative / context (optional) */
  description: text("description"),

  /**
   * Severity:
   *   info      — routine operational event
   *   important — notable governance event requiring attention
   *   critical  — irreversible / high-impact event (maturity, closure, freeze)
   */
  severity: text("severity").notNull().default("info"),

  /** Actor who triggered the event (null for system-generated events) */
  actorId: uuid("actor_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  actorName: text("actor_name"),
  actorRole: text("actor_role"),

  /** Pointer to the record that triggered this event (for deep-linking) */
  relatedTable: text("related_table"),
  relatedRecordId: text("related_record_id"),

  /** Arbitrary structured context: old→new status, amounts, remarks, etc. */
  metadata: jsonb("metadata"),

  /** When the real-world event occurred (defaults to insertion time) */
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProjectTimelineEvent =
  typeof projectTimelineEventsTable.$inferSelect;
export type ProjectTimelineEventInsert =
  typeof projectTimelineEventsTable.$inferInsert;

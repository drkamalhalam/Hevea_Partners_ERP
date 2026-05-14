/**
 * governance_meetings.ts
 *
 * Partnership governance records: formal meetings, resolutions, and voting.
 * These are the official governance paper trail for the JV partnership.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// ── Governance Meetings ────────────────────────────────────────────────────
// Formal meeting records: committee meetings, partner general meetings, etc.

export const governanceMeetingsTable = pgTable("governance_meetings", {
  id: uuid("id").primaryKey().defaultRandom(),

  title: text("title").notNull(),
  meetingType: text("meeting_type").notNull().default("general"),
  // Types: general, committee, emergency, annual_review, project_review

  status: text("status").notNull().default("scheduled"),
  // scheduled → in_progress → completed → cancelled

  meetingDate: date("meeting_date").notNull(),
  meetingTime: text("meeting_time"),
  venue: text("venue"),
  agenda: text("agenda"),
  minutes: text("minutes"),
  attendeesJson: jsonb("attendees_json"), // [{ name, role, partnerId? }]
  quorumMet: boolean("quorum_met"),
  totalAttendees: integer("total_attendees"),

  // Optional project scope (null = all projects / JV-wide)
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  // Audit
  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name"),
  completedBy: uuid("completed_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  completedByName: text("completed_by_name"),
  completedAt: timestamp("completed_at", { withTimezone: true }),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Governance Resolutions ─────────────────────────────────────────────────
// Formal decisions / resolutions passed at governance meetings.

export const governanceResolutionsTable = pgTable("governance_resolutions", {
  id: uuid("id").primaryKey().defaultRandom(),

  meetingId: uuid("meeting_id")
    .notNull()
    .references(() => governanceMeetingsTable.id, { onDelete: "restrict" }),

  resolutionNumber: text("resolution_number"),
  title: text("title").notNull(),
  description: text("description"),

  status: text("status").notNull().default("proposed"),
  // proposed → passed → rejected → deferred → implemented

  // Voting record (can be empty if consensus-based)
  votesFor: integer("votes_for").default(0),
  votesAgainst: integer("votes_against").default(0),
  votesAbstain: integer("votes_abstain").default(0),
  votingMethod: text("voting_method").default("show_of_hands"),
  // show_of_hands, written_ballot, consensus, unanimous

  implementationDeadline: date("implementation_deadline"),
  implementationNotes: text("implementation_notes"),
  implementedAt: timestamp("implemented_at", { withTimezone: true }),

  // Optional project scope
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  // Audit
  recordedBy: uuid("recorded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  recordedByName: text("recorded_by_name"),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Types ─────────────────────────────────────────────────────────────────
export type GovernanceMeeting =
  typeof governanceMeetingsTable.$inferSelect;
export type GovernanceMeetingInsert =
  typeof governanceMeetingsTable.$inferInsert;
export type GovernanceResolution =
  typeof governanceResolutionsTable.$inferSelect;
export type GovernanceResolutionInsert =
  typeof governanceResolutionsTable.$inferInsert;

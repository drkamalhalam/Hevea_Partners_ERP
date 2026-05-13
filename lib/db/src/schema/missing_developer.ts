import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { pgEnum } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * Status lifecycle for a missing developer case:
 *
 *   active           — GD filed; 45-day countdown running; project status → missing_developer
 *   nominee_eligible — 45 days elapsed since gdEntryDate; nominee can be activated
 *   resolved         — developer returned or case closed normally; project status restored
 *   cancelled        — case was filed in error and cancelled by admin
 *
 * Note: the system computes eligibility at query time from gdEntryDate arithmetic.
 * The status field is manually advanced by admins (or can be auto-advanced on read).
 */
export const missingDeveloperCaseStatusEnum = pgEnum(
  "missing_developer_case_status",
  ["active", "nominee_eligible", "resolved", "cancelled"],
);

/**
 * missing_developer_cases — one active record per project when the project
 * developer is reported missing.
 *
 * The project continues operating normally during the waiting period.
 * After 45 days from gdEntryDate the nominee becomes eligible for activation
 * (activation itself is a separate governance step not implemented here).
 *
 * Governance data stored:
 *   - GD document URL  (placeholder — future: object storage URL)
 *   - GD entry date    (used for countdown arithmetic)
 *   - GD reference number
 *   - Countdown status (derived from date arithmetic, reflected in status)
 *   - Governance remarks
 */
export const missingDeveloperCasesTable = pgTable("missing_developer_cases", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  status: missingDeveloperCaseStatusEnum("status").notNull().default("active"),

  /** Who filed the report in this system */
  reportedBy: uuid("reported_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  reportedByName: text("reported_by_name"),

  /** GD reference number (e.g. GD/TRP/2026/00123) */
  gdNumber: text("gd_number"),

  /** Placeholder URL for the GD document scan (object storage, future) */
  gdDocumentUrl: text("gd_document_url"),

  /**
   * Date the GD was actually entered at the police station (YYYY-MM-DD).
   * The 45-day countdown starts from this date.
   */
  gdEntryDate: text("gd_entry_date").notNull(),

  /** Governance remarks (context, observations, instructions) */
  remarks: text("remarks"),

  /** Previous project status before it was changed to missing_developer */
  previousProjectStatus: text("previous_project_status"),

  /** When and by whom the case was resolved */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  resolvedByName: text("resolved_by_name"),
  resolutionNotes: text("resolution_notes"),

  /** false = case is closed (resolved/cancelled) */
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type MissingDeveloperCase =
  typeof missingDeveloperCasesTable.$inferSelect;

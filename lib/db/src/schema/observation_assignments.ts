import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * observationAssignmentsTable
 *
 * Records when a trusted observer is assigned to watch a project's
 * production operations within a time window.
 *
 * The system automatically tags collection entries with observerActive = YES
 * when any observation assignment is active at entry time.
 *
 * Design rules:
 *   1. endDatetime may be null (open-ended observation session).
 *   2. No accusation or enforcement semantics — purely a variance-reporting
 *      structure for future analytics (avg production with/without observer).
 *   3. observerName is denormalised for audit stability.
 *   4. createdByName is denormalised for audit stability.
 */
export const observationAssignmentsTable = pgTable(
  "observation_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),

    observerUserId: uuid("observer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),

    observerName: text("observer_name"),

    startDatetime: timestamp("start_datetime", { withTimezone: true }).notNull(),

    endDatetime: timestamp("end_datetime", { withTimezone: true }),

    notes: text("notes"),

    createdById: uuid("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

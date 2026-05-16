import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { personMasterTable } from "./person_master";
import { usersTable } from "./users";

/**
 * project_workforce_assignments
 *
 * Canonical workforce assignment table backed by Person Registry.
 * ALL workforce identity originates from person_master — no manual UUIDs.
 *
 * Design rules:
 *   1. personId MUST reference person_master — no free-text identity.
 *   2. personNameSnapshot is a denormalised name for audit stability.
 *   3. Deactivation is soft — set isActive = false; never delete rows.
 *   4. assignmentType drives UI grouping: 'employee' | 'observer' | 'supervisor'.
 *   5. observationType is only set when assignmentType = 'observer'.
 */
export const projectWorkforceAssignmentsTable = pgTable(
  "project_workforce_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    personId: uuid("person_id")
      .notNull()
      .references(() => personMasterTable.id, { onDelete: "restrict" }),

    personNameSnapshot: text("person_name_snapshot"),

    roleType: text("role_type").notNull(),

    assignmentType: text("assignment_type").notNull(),

    startDate: text("start_date"),

    endDate: text("end_date"),

    isActive: boolean("is_active").notNull().default(true),

    notes: text("notes"),

    observationType: text("observation_type"),

    assignedById: uuid("assigned_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    assignedByName: text("assigned_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

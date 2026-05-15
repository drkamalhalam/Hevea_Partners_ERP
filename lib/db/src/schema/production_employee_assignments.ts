import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  text,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { productionEmployeeRoleEnum } from "./enums";

/**
 * productionEmployeeAssignmentsTable
 *
 * Links employee users to plantation projects for production tracking.
 * Supports multiple employees per project and multiple roles.
 * Architecture is future-ready for performance-based payment and
 * productivity analytics.
 *
 * Design rules:
 *   1. One row per (project, employee, role) combination.
 *   2. Deactivation is soft — set isActive = false; never delete.
 *   3. assignedByName is a denormalised snapshot for audit stability.
 *   4. When an employee logs in, the system reads this table to auto-fill
 *      their project and identity — employees never choose a project manually.
 */
export const productionEmployeeAssignmentsTable = pgTable(
  "production_employee_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    employeeId: uuid("employee_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    role: productionEmployeeRoleEnum("role").notNull().default("collector"),

    assignedById: uuid("assigned_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    assignedByName: text("assigned_by_name"),

    employeeName: text("employee_name"),

    assignedDate: text("assigned_date").notNull(),

    isActive: boolean("is_active").notNull().default(true),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

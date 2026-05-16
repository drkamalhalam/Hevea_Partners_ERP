import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";
import { projectsTable } from "./projects";
import { personRoleTypeEnum } from "./enums";

/**
 * person_role_assignments — dynamic role assignment engine.
 *
 * Maps one person_master to one or many roles, optionally scoped to
 * a specific project. A person can hold multiple roles simultaneously:
 *
 *   Kamal Halam:
 *     → DEVELOPER  in Project A
 *     → LANDOWNER  in Project B
 *     → INVESTOR   in Project C
 *     → WITNESS    in Project D
 *     (all referencing the same person_master row)
 *
 * Global roles (buyer, store_keeper, etc.) have projectId = null.
 * Project-scoped roles (landowner, developer, witness) have projectId set.
 *
 * Unique constraint prevents the same person holding the same role
 * twice within the same project.
 */
export const personRoleAssignmentsTable = pgTable("person_role_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),

  personMasterId: uuid("person_master_id")
    .notNull()
    .references(() => personMasterTable.id, { onDelete: "cascade" }),

  /** Role being assigned */
  role: personRoleTypeEnum("role").notNull(),

  /**
   * Project this role is scoped to. Null for global roles
   * (e.g. buyer, store_keeper) that span all projects.
   */
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),

  /** Whether this role assignment is currently active */
  isActive: boolean("is_active").notNull().default(true),

  /** Optional notes about why/how this role was assigned */
  notes: text("notes"),

  /** When this role assignment was deactivated (if applicable) */
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => [
  unique("person_role_project_uq").on(t.personMasterId, t.role, t.projectId),
]);

export const insertPersonRoleAssignmentSchema = createInsertSchema(personRoleAssignmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPersonRoleAssignment = z.infer<typeof insertPersonRoleAssignmentSchema>;
export type PersonRoleAssignment = typeof personRoleAssignmentsTable.$inferSelect;

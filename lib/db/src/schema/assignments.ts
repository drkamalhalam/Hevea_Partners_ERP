import {
  pgTable,
  uuid,
  timestamp,
  date,
  text,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { userRoleEnum } from "./enums";

/**
 * user_project_assignments — maps users to the projects they can access.
 * Only needed for roles without global access (landowner, investor, employee,
 * operational_staff). Admin and developer bypass this table.
 *
 * `revokedAt` supports soft-revocation without deleting the audit trail.
 * `isActive` reflects current participation status (can be toggled by admin/developer).
 * `joinDate`, `remarks`, `participationNotes` support the partner relationship system.
 */
export const userProjectAssignmentsTable = pgTable(
  "user_project_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    projectRole: userRoleEnum("project_role"),
    isActive: boolean("is_active").notNull().default(true),
    joinDate: date("join_date"),
    remarks: text("remarks"),
    participationNotes: text("participation_notes"),
    assignedBy: uuid("assigned_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("unique_user_project").on(t.userId, t.projectId)],
);

export type UserProjectAssignment =
  typeof userProjectAssignmentsTable.$inferSelect;

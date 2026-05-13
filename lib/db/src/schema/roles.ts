import { pgTable, serial, text, integer, timestamp, pgEnum, unique } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "developer",
  "landowner",
  "investor",
  "employee",
  "operational_staff",
]);

export const userRolesTable = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  role: userRoleEnum("role").notNull().default("employee"),
  displayName: text("display_name"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

export const userProjectAssignmentsTable = pgTable(
  "user_project_assignments",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("unique_user_project").on(t.clerkUserId, t.projectId)]
);

export type UserRole = typeof userRolesTable.$inferSelect;
export type UserProjectAssignment = typeof userProjectAssignmentsTable.$inferSelect;
export type UserRoleEnum = typeof userRoleEnum.enumValues[number];

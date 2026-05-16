import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";
import { taskTypeEnum, taskStatusEnum, taskPriorityEnum } from "./enums";

/**
 * operational_tasks — task assignment and tracking for employees and
 * operational staff. Admin/developer create and assign tasks; assignees
 * start, update, and complete them.
 *
 * Access rules:
 *   admin / developer       — full CRUD, can see all tasks
 *   employee / operational_staff — read + status-update on own assigned tasks only
 *   landowner / investor    — no access
 */
export const operationalTasksTable = pgTable("operational_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),

  title: text("title").notNull(),
  description: text("description"),

  taskType: taskTypeEnum("task_type").notNull().default("general"),
  status: taskStatusEnum("status").notNull().default("pending"),
  priority: taskPriorityEnum("priority").notNull().default("normal"),

  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  projectName: text("project_name"),

  // Identity-centric assignment: points to person_master (governance identity).
  // This is the primary assignment field — a person does not need a login account.
  assignedToPersonId: uuid("assigned_to_person_id").references(
    () => personMasterTable.id,
    { onDelete: "set null" }
  ),
  assignedToPersonName: text("assigned_to_person_name"),

  // Legacy user-account assignment (preserved for backward compatibility).
  // Populated automatically when the assigned person has a linked user account.
  assignedToId: uuid("assigned_to_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  assignedToName: text("assigned_to_name"),
  assignedToRole: text("assigned_to_role"),

  assignedById: uuid("assigned_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  assignedByName: text("assigned_by_name"),

  dueDate: date("due_date"),
  notes: text("notes"),

  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedById: uuid("completed_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  completedByName: text("completed_by_name"),

  linkedEntityType: text("linked_entity_type"),
  linkedEntityId: uuid("linked_entity_id"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

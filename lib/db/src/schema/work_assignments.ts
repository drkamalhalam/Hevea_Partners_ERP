import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { workAssignmentTypeEnum, workAssignmentStatusEnum } from "./enums";
import { personMasterTable } from "./person_master";
import { projectsTable } from "./projects";
import { storesTable } from "./multi_store";
import { usersTable } from "./users";

/**
 * work_assignments — unified operational assignment table.
 *
 * This is the canonical table for all operational work assignments in the system.
 * All five assignment types are stored here with type-specific nullable fields.
 *
 * Design rules:
 *   1. personMasterId MUST reference person_master — no free-text identity.
 *   2. personNameSnapshot is denormalised for audit stability.
 *   3. Never hard-delete — archive only.
 *   4. status is the authoritative lifecycle gate; isActive is derived.
 *   5. auditEvents for this assignment are stored in work_assignment_audit.
 *
 * Field applicability by type:
 *   collection_entry:      projectId, expenditurePermission
 *   store_entry:           projectId, storeId, place, expenditurePermission
 *   observer:              projectId (nullable if allProjects), projectCoverage, startDate, endDate
 *   store_sale_operator:   storeId, startDate, endDate
 *   general_responsibility: title, description, projectId (optional), startDate, endDate
 */
export const workAssignmentsTable = pgTable("work_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── Assignment type & status ─────────────────────────────────────────────
  assignmentType: workAssignmentTypeEnum("assignment_type").notNull(),
  status: workAssignmentStatusEnum("status").notNull().default("active"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  statusReason: text("status_reason"),

  // ── Person (registry-backed) ─────────────────────────────────────────────
  personMasterId: uuid("person_master_id")
    .notNull()
    .references(() => personMasterTable.id, { onDelete: "restrict" }),
  personNameSnapshot: text("person_name_snapshot"),

  // ── Project context (nullable for store_sale_operator) ───────────────────
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "restrict",
  }),
  projectNameSnapshot: text("project_name_snapshot"),

  // ── Observer: project coverage ───────────────────────────────────────────
  // "all_projects" or "selected_projects"
  projectCoverage: text("project_coverage"),

  // ── Store context (store_entry, store_sale_operator) ─────────────────────
  storeId: uuid("store_id").references(() => storesTable.id, {
    onDelete: "restrict",
  }),
  storeNameSnapshot: text("store_name_snapshot"),

  // ── Place (store_entry) ──────────────────────────────────────────────────
  place: text("place"),

  // ── Permissions ──────────────────────────────────────────────────────────
  expenditurePermission: boolean("expenditure_permission").notNull().default(false),

  // ── General responsibility fields ────────────────────────────────────────
  title: text("title"),
  description: text("description"),

  // ── Date range ───────────────────────────────────────────────────────────
  startDate: date("start_date"),
  endDate: date("end_date"),

  // ── Audit ────────────────────────────────────────────────────────────────
  assignedBy: uuid("assigned_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  assignedByName: text("assigned_by_name_snapshot"),

  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkAssignment = typeof workAssignmentsTable.$inferSelect;
export type WorkAssignmentInsert = typeof workAssignmentsTable.$inferInsert;

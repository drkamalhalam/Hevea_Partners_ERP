import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectLifecycleStatusEnum } from "./enums";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * Immutable audit trail of project lifecycle transitions.
 * Every row records a single state change (including the initial entry).
 * fromStatus is NULL only for the first recorded entry (project creation).
 *
 * Designed for future extension:
 *   - Add `approvedBy` / `approvedAt` columns for multi-party approval workflows
 *   - Add `metadata` JSONB for workflow-specific payloads
 *   - Add `workflowId` FK when an approval workflow engine is integrated
 */
export const projectLifecycleHistoryTable = pgTable(
  "project_lifecycle_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: projectLifecycleStatusEnum("to_status").notNull(),
    remarks: text("remarks"),
    changedBy: uuid("changed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    changedByName: text("changed_by_name"),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type ProjectLifecycleHistory =
  typeof projectLifecycleHistoryTable.$inferSelect;

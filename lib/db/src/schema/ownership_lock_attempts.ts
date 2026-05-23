import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * ownership_lock_attempts — write-once audit trail of ownership-affecting
 * actions that were BLOCKED by the ownership guard (freeze, maturity, or
 * closed-lifecycle enforcement).
 *
 * Successful actions are recorded by writeAudit in audit_logs as usual; this
 * table only records blocked attempts so governance teams can monitor pressure
 * against locked projects.
 *
 * No UPDATE/DELETE routes — append-only.
 */
export const ownershipLockAttemptsTable = pgTable(
  "ownership_lock_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    actorId: uuid("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),

    // Short identifier of the route/action that was attempted.
    // e.g. "contribution.create", "contribution.patch", "contribution.delete",
    //      "contribution.verify", "contribution.dispute_re_verify".
    attemptedAction: text("attempted_action").notNull(),

    // Snapshot of project + freeze state at moment of block.
    lifecycleStatus: text("lifecycle_status").notNull(),
    freezeStatus: text("freeze_status"),

    // Reason returned to the caller (also used in the error body).
    rejectionReason: text("rejection_reason").notNull(),
    errorCode: text("error_code").notNull(),

    // Optional context: target record being mutated (e.g. contributionId).
    targetTable: text("target_table"),
    targetRecordId: uuid("target_record_id"),

    metadata: text("metadata"), // free-form JSON string

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectIdx: index("ownership_lock_attempts_project_idx").on(t.projectId),
    createdAtIdx: index("ownership_lock_attempts_created_at_idx").on(
      t.createdAt,
    ),
  }),
);

export type OwnershipLockAttempt =
  typeof ownershipLockAttemptsTable.$inferSelect;

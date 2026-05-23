import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { personMasterTable } from "./person_master";
import { usersTable } from "./users";

/**
 * identity_validation_failures — write-once audit trail of attempts to
 * perform an ownership-sensitive action that failed partner-identity
 * validation (missing/inactive partner, broken person_master link, or
 * inactive person_master). Successful actions go through the usual
 * audit_logs path; this table only records BLOCKED attempts so governance
 * teams can monitor identity-attribution pressure.
 *
 * No UPDATE/DELETE routes — append-only.
 */
export const identityValidationFailuresTable = pgTable(
  "identity_validation_failures",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    actorId: uuid("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),

    // Project context, if known at the time of the failure.
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),

    // The partner the call referenced, when one was supplied.
    partnerId: uuid("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),

    // The person_master the call referenced, when one was supplied.
    personMasterId: uuid("person_master_id").references(
      () => personMasterTable.id,
      { onDelete: "set null" },
    ),

    // Short identifier of the route/action that was attempted.
    // e.g. "partner.create", "partner.patch", "contribution.create",
    //      "contribution.verify", "transfer.create", "transfer.execute",
    //      "inheritance.finalize".
    attemptedAction: text("attempted_action").notNull(),

    // Closed enum of failure codes — kept in sync with PartnerIdentityFailureCode
    // in partnerIdentityGuard.ts.
    failureCode: text("failure_code").notNull(),

    // Human-readable reason returned to the caller.
    rejectionReason: text("rejection_reason").notNull(),

    // Optional context: target record being mutated.
    targetTable: text("target_table"),
    targetRecordId: uuid("target_record_id"),

    // Free-form JSON string of additional context (do not store secrets).
    metadata: text("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    actionIdx: index("identity_validation_failures_action_idx").on(
      t.attemptedAction,
    ),
    projectIdx: index("identity_validation_failures_project_idx").on(
      t.projectId,
    ),
    partnerIdx: index("identity_validation_failures_partner_idx").on(
      t.partnerId,
    ),
    createdAtIdx: index("identity_validation_failures_created_at_idx").on(
      t.createdAt,
    ),
  }),
);

export type IdentityValidationFailure =
  typeof identityValidationFailuresTable.$inferSelect;

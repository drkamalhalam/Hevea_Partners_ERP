import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { expendituresTable } from "./expenditures";
import {
  expenditureVerificationRequestStatusEnum,
  expenditureVerificationEventTypeEnum,
} from "./enums";

/**
 * expenditureVerificationRequestsTable
 *
 * One row per expenditure — tracks who must verify and the current resolution.
 * Created automatically when an expenditure is submitted (draft → pending_review).
 *
 * Routing rules (encoded in `routingReason`):
 *   - Recorder is developer → requiredVerifierRole = "landowner"
 *   - Recorder is landowner → requiredVerifierRole = "developer"
 *   - Recorder is employee / operational_staff → requiredVerifierRole = "developer"
 *   - Agreement revenue model = "fifty_percent_revenue" AND operational cost
 *     category → requiredVerifierRole forced to "landowner"
 */
export const expenditureVerificationRequestsTable = pgTable(
  "expenditure_verification_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // One-to-one: each expenditure has at most one live verification request
    expenditureId: uuid("expenditure_id")
      .notNull()
      .unique()
      .references(() => expendituresTable.id, { onDelete: "cascade" }),

    // Denormalised for efficient pending-verification queries
    projectId: uuid("project_id").notNull(),

    // ── Routing ────────────────────────────────────────────────────────────
    requiredVerifierRole: text("required_verifier_role").notNull(), // "landowner" | "developer" | "admin"
    requiredVerifierId: uuid("required_verifier_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    requiredVerifierName: text("required_verifier_name"),
    routingReason: text("routing_reason").notNull(),

    // ── Status ─────────────────────────────────────────────────────────────
    status: expenditureVerificationRequestStatusEnum("status")
      .notNull()
      .default("pending"),

    // ── OTP placeholder ────────────────────────────────────────────────────
    otpCode: text("otp_code"),
    otpSentAt: timestamp("otp_sent_at", { withTimezone: true }),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),

    // ── Resolution ─────────────────────────────────────────────────────────
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    resolvedByName: text("resolved_by_name"),
    resolverNotes: text("resolver_notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

/**
 * expenditureVerificationEventsTable
 *
 * Immutable audit trail. One row per state transition or notable event
 * in the verification lifecycle of an expenditure.
 * Never updated or deleted — append-only.
 */
export const expenditureVerificationEventsTable = pgTable(
  "expenditure_verification_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    expenditureId: uuid("expenditure_id")
      .notNull()
      .references(() => expendituresTable.id, { onDelete: "cascade" }),

    verificationRequestId: uuid("verification_request_id").references(
      () => expenditureVerificationRequestsTable.id,
      { onDelete: "set null" },
    ),

    // ── Event details ──────────────────────────────────────────────────────
    eventType: expenditureVerificationEventTypeEnum("event_type").notNull(),

    actorId: uuid("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role"),

    notes: text("notes"),
    metadata: jsonb("metadata"),

    // Append-only — no updatedAt
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

// Convenience boolean flag on expenditures (added via migration below)
// expendituresTable.hasVerificationRequest — not a column in the schema file
// but queried by joining expenditureVerificationRequestsTable

export type ExpenditureVerificationRequest =
  typeof expenditureVerificationRequestsTable.$inferSelect;
export type ExpenditureVerificationEvent =
  typeof expenditureVerificationEventsTable.$inferSelect;

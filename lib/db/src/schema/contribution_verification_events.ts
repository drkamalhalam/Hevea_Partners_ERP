import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { contributionsTable } from "./contributions";
import { contributionVerificationEventTypeEnum } from "./enums";

/**
 * contributionVerificationEventsTable — immutable audit trail.
 *
 * Every state change in the contribution verification workflow appends a new
 * row here. Rows are WRITE-ONCE — never updated or deleted through the
 * application. This provides a tamper-evident chronological history of every
 * verification_requested, approved, rejected, re_approved, and verifier_changed
 * action, including OTP events (placeholder).
 */
export const contributionVerificationEventsTable = pgTable(
  "contribution_verification_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // The contribution this event belongs to
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributionsTable.id, { onDelete: "cascade" }),

    // Type of event
    eventType: contributionVerificationEventTypeEnum("event_type").notNull(),

    // Actor — who performed this action
    actorId: uuid("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name"), // denormalized snapshot

    // Target user — the verifier being assigned (for verification_requested / verifier_changed)
    targetUserId: uuid("target_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    targetUserName: text("target_user_name"), // denormalized snapshot

    // Human-readable notes attached to this event (rejection reason, approval notes, etc.)
    notes: text("notes"),

    // ── OTP placeholder columns ───────────────────────────────────────────────
    // These are reserved for a future OTP-based counterparty verification flow.
    // Not populated in the current implementation.
    otpSentAt: timestamp("otp_sent_at", { withTimezone: true }),
    otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type ContributionVerificationEvent =
  typeof contributionVerificationEventsTable.$inferSelect;
export type InsertContributionVerificationEvent =
  typeof contributionVerificationEventsTable.$inferInsert;

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  agreementActivationStatusEnum,
  agreementActivationPartyEnum,
  agreementActivationOtpStatusEnum,
} from "./enums";
import { agreementsTable } from "./agreements";
import { usersTable } from "./users";
import { partnersTable } from "./partners";

/**
 * agreement_activations — one activation workflow session per attempt.
 *
 * An agreement may have multiple records over time (e.g. a cancelled attempt
 * followed by a successful one), but only one can be in pending_otp status
 * at a time (enforced at the application layer).
 *
 * When all OTP rows are verified → status = completed → agreement status = active.
 * When cancelled/rejected → agreement status reverts to draft.
 */
export const agreementActivationsTable = pgTable("agreement_activations", {
  id: uuid("id").defaultRandom().primaryKey(),
  agreementId: uuid("agreement_id")
    .notNull()
    .references(() => agreementsTable.id, { onDelete: "cascade" }),
  status: agreementActivationStatusEnum("status")
    .notNull()
    .default("pending_otp"),
  initiatedBy: uuid("initiated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  initiatedByName: text("initiated_by_name"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * agreement_activation_otps — one row per party per activation workflow.
 *
 * Generated when activation is initiated (one for landowner, one for developer).
 * otpCode stored plain-text (placeholder system only — in production would be
 * dispatched via SMS/email and NOT stored in cleartext).
 */
export const agreementActivationOtpsTable = pgTable(
  "agreement_activation_otps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    activationId: uuid("activation_id")
      .notNull()
      .references(() => agreementActivationsTable.id, { onDelete: "cascade" }),
    partyRole: agreementActivationPartyEnum("party_role").notNull(),
    partyName: text("party_name").notNull(),
    partyPhone: text("party_phone"),
    partnerId: uuid("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    otpCode: text("otp_code").notNull(),
    status: agreementActivationOtpStatusEnum("status")
      .notNull()
      .default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type AgreementActivation =
  typeof agreementActivationsTable.$inferSelect;
export type AgreementActivationOtp =
  typeof agreementActivationOtpsTable.$inferSelect;

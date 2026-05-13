import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import {
  maturityDeclarationStatusEnum,
  maturityOtpPartyEnum,
  maturityOtpStatusEnum,
} from "./enums";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { partnersTable } from "./partners";

/**
 * maturity_declarations — one per maturity workflow attempt for a project.
 *
 * A project may have multiple declaration records over time (e.g. a cancelled
 * attempt followed by a successful one), but only one can be in pending_otp
 * status at a time (enforced at the application layer).
 *
 * blockerSnapshot — JSON snapshot of the blocker check result at initiation
 * ownershipSnapshotPlaceholder — reserved for future ownership freeze logic
 */
export const maturityDeclarationsTable = pgTable("maturity_declarations", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  status: maturityDeclarationStatusEnum("status")
    .notNull()
    .default("pending_otp"),
  initiatedBy: uuid("initiated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  initiatedByName: text("initiated_by_name"),
  blockerSnapshot: jsonb("blocker_snapshot"),
  ownershipSnapshotPlaceholder: jsonb("ownership_snapshot_placeholder"),
  cancelledBy: uuid("cancelled_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * maturity_otp_verifications — one row per party per declaration.
 *
 * Each declaration generates OTP rows for the initiating developer and each
 * unique landowner from the project's active agreements.
 *
 * otpCode is stored in plain text (placeholder system only). In production
 * this would be dispatched via SMS/email and not stored in cleartext.
 *
 * otpCodePlaceholder column does not exist in DB — it is computed at the
 * API layer and exposed only when status = "sent".
 */
export const maturityOtpVerificationsTable = pgTable(
  "maturity_otp_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    declarationId: uuid("declaration_id")
      .notNull()
      .references(() => maturityDeclarationsTable.id, { onDelete: "cascade" }),
    partyRole: maturityOtpPartyEnum("party_role").notNull(),
    partyUserId: uuid("party_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    partyName: text("party_name").notNull(),
    partyPhone: text("party_phone"),
    partnerId: uuid("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    otpCode: text("otp_code").notNull(),
    status: maturityOtpStatusEnum("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type MaturityDeclaration =
  typeof maturityDeclarationsTable.$inferSelect;
export type MaturityOtpVerification =
  typeof maturityOtpVerificationsTable.$inferSelect;

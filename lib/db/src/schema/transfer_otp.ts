/**
 * transfer_otp.ts
 *
 * OTP event history for all transfer-related verification gates.
 *
 * Every OTP generation and every verification attempt (success or failure)
 * is recorded here as an append-only audit trail.
 *
 * Placeholder delivery (dev mode):
 *   - The plaintext code is stored in `otpPlaintext` ONLY while delivery is
 *     "placeholder". When a real SMS/email provider is wired, set delivery
 *     to "sms" or "email", remove otpPlaintext, and store a bcrypt hash in
 *     `otpCodeHash` instead.
 *   - The API returns `devModePlaintextCode` in the response body when
 *     delivery === "placeholder" so the frontend can display it.
 *
 * Immutability: rows are never updated. A new row is inserted for each
 * attempt. The status column on the *pending* row is updated exactly once
 * (to verified/expired/cancelled) and then frozen.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { ownershipTransfersTable } from "./ownership_transfers";
import { usersTable } from "./users";
import {
  transferOtpPurposeEnum,
  transferOtpStatusEnum,
  transferOtpDeliveryEnum,
} from "./enums";

export const transferOtpEventsTable = pgTable("transfer_otp_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  transferId: uuid("transfer_id")
    .notNull()
    .references(() => ownershipTransfersTable.id, { onDelete: "cascade" }),

  purpose: transferOtpPurposeEnum("purpose").notNull(),

  // Who the OTP is for (may be a partner, not necessarily a system user)
  recipientUserId: uuid("recipient_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  recipientName: text("recipient_name").notNull(),
  recipientContact: text("recipient_contact"), // phone or email for future delivery

  // ── Code storage ─────────────────────────────────────────────────────────
  // Dev-mode only: plaintext stored for placeholder delivery.
  // Replace with bcrypt hash when real provider is wired.
  otpPlaintext: text("otp_plaintext"),
  otpCodeHash: text("otp_code_hash"), // future: bcrypt hash

  delivery: transferOtpDeliveryEnum("delivery").notNull().default("placeholder"),

  status: transferOtpStatusEnum("status").notNull().default("pending"),

  // Lifetime: 15 minutes from generation
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  // Verification tracking
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedByUserId: uuid("verified_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  verifiedByName: text("verified_by_name"),

  // Failed attempt counter (max 5 before auto-cancel)
  failedAttempts: integer("failed_attempts").notNull().default(0),

  // Context: which ROFR offer this OTP is gating (nullable for non-ROFR purposes)
  rofrOfferId: uuid("rofr_offer_id"),
  // (soft FK to transfer_rofr_offers to avoid circular imports)

  // Who requested the OTP
  requestedByUserId: uuid("requested_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  requestedByName: text("requested_by_name"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransferOtpEvent = typeof transferOtpEventsTable.$inferSelect;
export type InsertTransferOtpEvent = typeof transferOtpEventsTable.$inferInsert;

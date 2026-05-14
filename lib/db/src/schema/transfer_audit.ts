/**
 * transfer_audit.ts
 *
 * Immutable audit event log for ownership share transfers.
 *
 * Every state change, OTP event, and ROFR decision writes one row here.
 * Rows are NEVER updated or deleted — this is a pure append-only log.
 *
 * eventData is a typed JSONB payload specific to each event type:
 *   created           → { transferType, offeredPct, buyerName }
 *   submitted         → { skipRofr, newStatus }
 *   rofr_offer_sent   → { partnerId, partnerName, offerId, deadline }
 *   rofr_response_recorded → { partnerId, partnerName, offerId, response, otpId }
 *   rofr_finalized    → { outcome, pendingCount, acceptedCount, rejectedCount }
 *   otp_generated     → { otpId, purpose, recipientName, delivery, expiresAt }
 *   otp_verified      → { otpId, purpose, recipientName }
 *   otp_failed        → { otpId, purpose, recipientName, attempt }
 *   approved          → { adminNotes }
 *   executed          → { executionNotes }
 *   cancelled         → { cancellationReason }
 *   expired           → { previousStatus }
 *   note_added        → { note }
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { ownershipTransfersTable } from "./ownership_transfers";
import { usersTable } from "./users";
import { partnersTable } from "./partners";
import { transferAuditEventTypeEnum } from "./enums";

export const transferAuditEventsTable = pgTable("transfer_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  transferId: uuid("transfer_id")
    .notNull()
    .references(() => ownershipTransfersTable.id, { onDelete: "cascade" }),

  eventType: transferAuditEventTypeEnum("event_type").notNull(),

  // Actor who caused this event
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  actorName: text("actor_name"),
  actorRole: text("actor_role"), // denormalised for historical accuracy

  // Optional target (e.g., a partner for ROFR events)
  targetPartnerId: uuid("target_partner_id").references(() => partnersTable.id, {
    onDelete: "set null",
  }),
  targetPartnerName: text("target_partner_name"),

  // Event-specific structured payload (see JSDoc above for shape by eventType)
  eventData: jsonb("event_data").$type<Record<string, unknown>>().notNull().default({}),

  // Human-readable summary line (pre-rendered on write for fast display)
  summary: text("summary").notNull(),

  // For security-sensitive events: capture context
  ipAddress: text("ip_address"),

  // Immutable timestamp
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransferAuditEvent = typeof transferAuditEventsTable.$inferSelect;
export type InsertTransferAuditEvent = typeof transferAuditEventsTable.$inferInsert;

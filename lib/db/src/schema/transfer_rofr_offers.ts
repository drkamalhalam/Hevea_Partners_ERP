/**
 * transfer_rofr_offers.ts
 *
 * Normalised Right-of-First-Refusal offer tracking.
 *
 * One row per (transfer, partner) pair for every ROFR notice sent.
 * Replaces the JSONB rofrResponses array for durable, queryable storage.
 * The JSONB array on ownership_transfers is kept for backwards-compat reads
 * but new code should query this table for detail views and dashboards.
 *
 * OTP linkage: when a partner responds (accept/reject) the API generates
 * an OTP (delivery: placeholder in dev) and only commits the response once
 * the OTP is verified. The verified otp event id is stored here.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { ownershipTransfersTable } from "./ownership_transfers";
import { partnersTable } from "./partners";
import { transferRofrOfferStatusEnum } from "./enums";

export const transferRofrOffersTable = pgTable("transfer_rofr_offers", {
  id: uuid("id").primaryKey().defaultRandom(),

  transferId: uuid("transfer_id")
    .notNull()
    .references(() => ownershipTransfersTable.id, { onDelete: "cascade" }),

  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  partnerName: text("partner_name").notNull(),

  // When the offer notice was sent
  offeredAt: timestamp("offered_at", { withTimezone: true }).notNull().defaultNow(),

  // 14-day deadline computed from offeredAt
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),

  status: transferRofrOfferStatusEnum("status").notNull().default("pending"),

  respondedAt: timestamp("responded_at", { withTimezone: true }),

  // Notes provided by the partner when responding
  responseNotes: text("response_notes"),

  // OTP verification gate — the otp event id that authorised the response
  verifiedViaOtpId: uuid("verified_via_otp_id"),
  // (soft FK to transfer_otp_events; no hard FK to avoid circular imports)

  // Who sent the offer notification (admin / developer)
  sentByName: text("sent_by_name"),
  sentById: uuid("sent_by_id"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransferRofrOffer = typeof transferRofrOffersTable.$inferSelect;
export type InsertTransferRofrOffer = typeof transferRofrOffersTable.$inferInsert;

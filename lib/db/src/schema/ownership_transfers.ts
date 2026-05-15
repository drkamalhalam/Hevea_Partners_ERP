/**
 * ownership_transfers.ts
 *
 * DB schema for the ownership share transfer request workflow.
 *
 * Business rules enforced at the API layer:
 *   1. Only allowed after the project reaches mature_production lifecycle.
 *   2. Only allowed when the project ownership is frozen (project_ownership_freezes record exists).
 *   3. offeredPercentage must be ≤ the transferor's current frozen ownership %.
 *   4. third_party transfers require prior ROFR completion (all existing partners declined).
 *   5. third_party transfers require offeredValue ≥ ₹1,00,000.
 *   6. Partial transfers are allowed (transferor retains the remainder).
 *   7. Execution is an explicit admin action — no silent ownership modification.
 *
 * State machine (forward-only, irreversible transitions):
 *   draft → pending_rofr → rofr_accepted → pending_approval → approved → executed
 *   draft → pending_rofr → rofr_rejected → pending_approval → approved → executed
 *   draft → pending_approval → approved → executed   (internal type, skip ROFR)
 *   any non-terminal → cancelled
 *   pending_rofr → expired
 */

import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  jsonb,
  date,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { usersTable } from "./users";
import { ownershipSnapshotsTable } from "./ownership_snapshots";
import {
  ownershipTransferTypeEnum,
  ownershipTransferStatusEnum,
} from "./enums";

// ── ROFR response entry (stored as JSONB array) ────────────────────────────

export interface RofrResponse {
  partnerId: string;
  partnerName: string;
  /** pending = notified, not yet responded */
  response: "pending" | "accepted" | "rejected";
  respondedAt: string | null; // ISO timestamp
  notes: string | null;
}

// ── Main transfer request table ────────────────────────────────────────────

export const ownershipTransfersTable = pgTable("ownership_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // ── Transferor ────────────────────────────────────────────────────────────
  transferorPartnerId: uuid("transferor_partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),
  transferorName: text("transferor_name").notNull(), // denormalized snapshot

  // ── Offered stake ─────────────────────────────────────────────────────────
  // Percentage of the project being transferred (e.g. 15.5000 = 15.5%)
  offeredPercentage: numeric("offered_percentage", {
    precision: 8,
    scale: 4,
  }).notNull(),

  // Proposed INR value for the transfer (required for third_party; informational for internal)
  offeredValue: numeric("offered_value", { precision: 15, scale: 2 }),

  // ── Buyer ─────────────────────────────────────────────────────────────────
  transferType: ownershipTransferTypeEnum("transfer_type").notNull(),

  // Set when buying party is an existing partner; null for third_party
  buyerPartnerId: uuid("buyer_partner_id").references(() => partnersTable.id, {
    onDelete: "set null",
  }),
  buyerName: text("buyer_name").notNull(), // full name of proposed buyer
  buyerContact: text("buyer_contact"), // phone / email for third-party buyers

  // ── Status & ROFR ─────────────────────────────────────────────────────────
  status: ownershipTransferStatusEnum("status").notNull().default("draft"),

  // ISO timestamp deadline for ROFR period (set when status → pending_rofr)
  rofrDeadline: timestamp("rofr_deadline", { withTimezone: true }),

  // One entry per existing partner who was notified of the ROFR
  rofrResponses: jsonb("rofr_responses")
    .$type<RofrResponse[]>()
    .notNull()
    .default([]),

  // ── Linked ownership snapshot ─────────────────────────────────────────────
  // The frozen snapshot at the time of submission — used to validate offeredPercentage
  linkedSnapshotId: uuid("linked_snapshot_id").references(
    () => ownershipSnapshotsTable.id,
    { onDelete: "set null" },
  ),

  // ── Reason & notes ────────────────────────────────────────────────────────
  reason: text("reason"), // transferor's stated reason
  adminNotes: text("admin_notes"), // governance / admin remarks

  // ── Approval ──────────────────────────────────────────────────────────────
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  approvedByName: text("approved_by_name"),

  // ── Execution ─────────────────────────────────────────────────────────────
  executedAt: timestamp("executed_at", { withTimezone: true }),
  executedBy: uuid("executed_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  executedByName: text("executed_by_name"),
  executionNotes: text("execution_notes"),

  // ── Transfer mode & financial concepts ───────────────────────────────────
  // 'by_percentage' (default) — user specifies offeredPercentage directly
  // 'by_value'               — user specifies transferValue; % derived from valuation
  transferMode: text("transfer_mode").notNull().default("by_percentage"),

  // Transfer Value: the ownership valuation basis used to derive/validate the percentage.
  // This is NOT the negotiated payment — it is the fair-value reference amount.
  // For by_percentage transfers it may be set from a linked valuation run.
  // For by_value transfers it is the entry point; offeredPercentage is derived from it.
  transferValue: numeric("transfer_value", { precision: 15, scale: 2 }),

  // Payable Amount: the negotiated settlement the buyer agrees to pay.
  // May differ from transferValue (discounts, premiums, family arrangements).
  // Ownership % always depends on transferValue, NOT payableAmount.
  payableAmount: numeric("payable_amount", { precision: 15, scale: 2 }),

  // Paid Amount: cumulative amount actually received so far.
  // Can be updated as installments arrive. Does NOT affect ownership %.
  paidAmount: numeric("paid_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),

  // ── Effective date ────────────────────────────────────────────────────────
  // When ownership rights actually transfer. May be set to a future date.
  // Economic rights (production, profit, stock entitlement) split on this date.
  // If null, defaults to the executedAt timestamp at execution time.
  effectiveDate: date("effective_date"),

  // ── Linked valuation run ──────────────────────────────────────────────────
  // The immutable valuation snapshot used to derive/validate transferValue.
  // Stored as a plain UUID (logical link only — no FK to break the circular
  // schema dependency between ownership_transfers ↔ valuations).
  linkedValuationRunId: uuid("linked_valuation_run_id"),

  // ── Stock entitlement handling ────────────────────────────────────────────
  // Configures how stored rubber produced before effectiveDate is attributed.
  // null              = not configured / not applicable
  // retain_with_seller = old owner retains economic entitlement for pre-transfer stock
  // transfer_to_buyer  = new owner receives entitlement for pre-transfer stock
  stockEntitlementHandling: text("stock_entitlement_handling"),

  // Total kg of stored stock that existed at transfer effective date
  stockEntitlementKg: numeric("stock_entitlement_kg", {
    precision: 12,
    scale: 3,
  }),

  // Breakdown of the entitlement handling decision (must sum to stockEntitlementKg)
  stockEntitlementRetainedKg: numeric("stock_entitlement_retained_kg", {
    precision: 12,
    scale: 3,
  }),
  stockEntitlementTransferredKg: numeric("stock_entitlement_transferred_kg", {
    precision: 12,
    scale: 3,
  }),
  stockEntitlementNotes: text("stock_entitlement_notes"),

  // ── Cancellation ──────────────────────────────────────────────────────────
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  cancelledByName: text("cancelled_by_name"),
  cancellationReason: text("cancellation_reason"),

  // ── Audit ─────────────────────────────────────────────────────────────────
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedBy: uuid("submitted_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  submittedByName: text("submitted_by_name"),

  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name"),

  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OwnershipTransfer = typeof ownershipTransfersTable.$inferSelect;
export type InsertOwnershipTransfer = typeof ownershipTransfersTable.$inferInsert;

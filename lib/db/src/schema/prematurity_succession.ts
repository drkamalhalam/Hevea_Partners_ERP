/**
 * prematurity_succession.ts
 *
 * Tables for the Prematurity Death Succession Workflow.
 *
 * Design principle: project operations are NEVER frozen.
 * Claimants can independently continue contributions (with OTP verification).
 * Disputed claimant amounts accumulate in a separate ledger until resolved.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
  integer,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { partnerClaimantsTable } from "./claimants";
import { inheritanceClaimsTable } from "./inheritance";

// ── Claimant Participation Record ─────────────────────────────────────────
// One record per (claimId, claimantId) activated to continue the deceased
// partner's participation. Created by admin/developer during a prematurity
// death succession. Does NOT block project operations.

export const claimantParticipationRecordsTable = pgTable(
  "claimant_participation_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    claimId: uuid("claim_id")
      .notNull()
      .references(() => inheritanceClaimsTable.id, { onDelete: "restrict" }),

    claimantId: uuid("claimant_id")
      .notNull()
      .references(() => partnerClaimantsTable.id, { onDelete: "restrict" }),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),

    // Original deceased partner (for reference)
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partnersTable.id, { onDelete: "restrict" }),

    // Claimant's allocated share of the original partner's stake (%)
    // This is the inheritance share — entered manually, never auto-computed
    inheritedSharePct: numeric("inherited_share_pct", {
      precision: 8,
      scale: 4,
    }),

    // Whether this claimant is currently contributing to the project
    isContributing: boolean("is_contributing").notNull().default(false),

    // Participation lifecycle status
    // active = participating normally
    // disputed = in dispute with other claimants (accumulation active)
    // suspended = temporarily suspended by developer/admin
    // resolved = dispute resolved, share confirmed
    // withdrawn = claimant withdrew from participation
    participationStatus: text("participation_status")
      .notNull()
      .default("active"),

    // When contribution was activated (after OTP/admin setup)
    contributionActivatedAt: timestamp("contribution_activated_at", {
      withTimezone: true,
    }),

    // Audit: who activated this participation record
    activatedBy: uuid("activated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    activatedByName: text("activated_by_name"),

    // Notes from admin/developer
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),

    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// ── Claimant Contribution ──────────────────────────────────────────────────
// Each contribution made by a claimant during prematurity succession.
// Requires OTP verification by the Project Developer before confirmation.

export const claimantContributionsTable = pgTable("claimant_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),

  participationRecordId: uuid("participation_record_id")
    .notNull()
    .references(() => claimantParticipationRecordsTable.id, {
      onDelete: "restrict",
    }),

  claimantId: uuid("claimant_id")
    .notNull()
    .references(() => partnerClaimantsTable.id, { onDelete: "restrict" }),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  claimId: uuid("claim_id")
    .notNull()
    .references(() => inheritanceClaimsTable.id, { onDelete: "restrict" }),

  // Contribution details
  periodLabel: text("period_label").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  contributionType: text("contribution_type").notNull().default("cash"),
  description: text("description"),

  // OTP workflow:
  // pending_otp   → contribution submitted, OTP not yet requested
  // otp_sent      → developer was notified, OTP generated
  // otp_verified  → developer verified the OTP
  // confirmed     → contribution confirmed and recorded
  // rejected      → rejected by developer
  status: text("status").notNull().default("pending_otp"),

  // OTP — stored as plain text for simplicity (6-digit numeric)
  // In production this should be hashed; for ERP internal use this is acceptable
  otpCode: text("otp_code"),
  otpRequestedAt: timestamp("otp_requested_at", { withTimezone: true }),
  otpSentAt: timestamp("otp_sent_at", { withTimezone: true }),

  // Developer who verified
  otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),
  otpVerifiedBy: uuid("otp_verified_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  otpVerifiedByName: text("otp_verified_by_name"),

  // Admin/developer notes
  rejectionReason: text("rejection_reason"),
  notes: text("notes"),

  submittedBy: uuid("submitted_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  submittedByName: text("submitted_by_name"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Disputed Accumulation Ledger ───────────────────────────────────────────
// When claimants are in active dispute, amounts that would normally be
// distributed to them are held here and released once the dispute resolves.
// Project continues normally — only the contested portion is held.

export const disputedAccumulationLedgerTable = pgTable(
  "disputed_accumulation_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    claimId: uuid("claim_id")
      .notNull()
      .references(() => inheritanceClaimsTable.id, { onDelete: "restrict" }),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),

    // Claimant this entry belongs to (nullable — can be for the whole disputed pool)
    claimantId: uuid("claimant_id").references(() => partnerClaimantsTable.id, {
      onDelete: "set null",
    }),

    // Period this amount relates to
    periodLabel: text("period_label").notNull(),
    periodYear: integer("period_year"),

    // Amount accumulated and held
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),

    // What kind of amount is being held
    // contribution → claimant's pending contribution
    // revenue_entitlement → their share of revenue during dispute
    // lca_credit → LCA amounts due
    // other → catch-all
    accumulationType: text("accumulation_type").notNull().default("other"),

    description: text("description"),

    // Status:
    // accumulating → being held pending dispute resolution
    // released → released to a specific claimant after resolution
    // forfeited → forfeited (by court order, tribal council decision, etc.)
    status: text("status").notNull().default("accumulating"),

    // Release information (filled when status = released)
    releasedToClaimantId: uuid("released_to_claimant_id").references(
      () => partnerClaimantsTable.id,
      { onDelete: "set null" },
    ),
    releasedToClaimantName: text("released_to_claimant_name"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    releasedByName: text("released_by_name"),
    releaseNotes: text("release_notes"),

    // Audit
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// ── TypeScript types ───────────────────────────────────────────────────────

export type ClaimantParticipationRecord =
  typeof claimantParticipationRecordsTable.$inferSelect;
export type ClaimantParticipationRecordInsert =
  typeof claimantParticipationRecordsTable.$inferInsert;
export type ClaimantContribution =
  typeof claimantContributionsTable.$inferSelect;
export type ClaimantContributionInsert =
  typeof claimantContributionsTable.$inferInsert;
export type DisputedAccumulationEntry =
  typeof disputedAccumulationLedgerTable.$inferSelect;
export type DisputedAccumulationEntryInsert =
  typeof disputedAccumulationLedgerTable.$inferInsert;

/**
 * inheritance.ts
 *
 * DB schema for the Inheritance & Claimant Succession workflow.
 *
 * Three tables:
 *   inheritance_claims           — one claim per (partner × project) succession event
 *   inheritance_claimant_shares  — manual share proposals (NEVER auto-computed)
 *   inheritance_documents        — document upload placeholders per claim/claimant
 *
 * DESIGN RULE: The system does NOT automatically divide or transfer shares.
 * All allocation percentages are entered manually by admin/developer and
 * must receive explicit approval. This enforces tribal/customary and
 * governance-based settlement.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { partnersTable } from "./partners";
import { projectsTable } from "./projects";
import { partnerClaimantsTable } from "./claimants";
import {
  inheritanceClaimTypeEnum,
  inheritanceClaimStatusEnum,
  inheritanceShareStatusEnum,
  inheritanceDocumentTypeEnum,
  inheritanceDocumentVerificationEnum,
} from "./enums";

// ── Inheritance Claims ────────────────────────────────────────────────────

export const inheritanceClaimsTable = pgTable("inheritance_claims", {
  id: uuid("id").defaultRandom().primaryKey(),

  // The partner whose stake is subject to succession
  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "restrict" }),

  // Project-scoped: one claim per succession event per project stake
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  claimType: inheritanceClaimTypeEnum("claim_type").notNull(),
  status: inheritanceClaimStatusEnum("status").notNull().default("open"),

  // Narrative: brief description of the succession event
  description: text("description"),

  // Who filed the claim (e.g. a claimant representative or admin)
  initiatedBy: uuid("initiated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  initiatedByName: text("initiated_by_name"),

  // Developer approval step
  developerApprovedBy: uuid("developer_approved_by").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  developerApprovedByName: text("developer_approved_by_name"),
  developerApprovedAt: timestamp("developer_approved_at", {
    withTimezone: true,
  }),

  // Admin final approval step (after documents verified)
  approvedBy: uuid("approved_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  // Rejection details (if status = rejected)
  rejectedBy: uuid("rejected_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  rejectedByName: text("rejected_by_name"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),

  // Settlement narrative (written by admin once settled)
  settlementNotes: text("settlement_notes"),

  // Internal review notes
  reviewNotes: text("review_notes"),

  // Soft-archive
  isActive: boolean("is_active").notNull().default(true),

  // Audit
  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type InheritanceClaim =
  typeof inheritanceClaimsTable.$inferSelect;

// ── Inheritance Claimant Shares ───────────────────────────────────────────

/**
 * Manual share allocation proposed for a specific claimant in a claim.
 *
 * IMPORTANT: proposedSharePct is ALWAYS manually entered by an admin or
 * developer. No formula, no automation. Multiple proposed shares can exist;
 * their sum is validated by the API (must not exceed 100% at approval time).
 * The system enforces explicit approval before any share is considered final.
 */
export const inheritanceClaimantSharesTable = pgTable(
  "inheritance_claimant_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    claimId: uuid("claim_id")
      .notNull()
      .references(() => inheritanceClaimsTable.id, { onDelete: "cascade" }),

    // Must be an active claimant record linked to the same (partner, project)
    claimantId: uuid("claimant_id")
      .notNull()
      .references(() => partnerClaimantsTable.id, { onDelete: "restrict" }),

    // Manually entered percentage — NO auto-computation ever
    proposedSharePct: numeric("proposed_share_pct", {
      precision: 7,
      scale: 4,
    }).notNull(),

    shareNotes: text("share_notes"),

    status: inheritanceShareStatusEnum("status").notNull().default("proposed"),

    proposedBy: uuid("proposed_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    proposedByName: text("proposed_by_name"),

    approvedBy: uuid("approved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedByName: text("approved_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    disputeNotes: text("dispute_notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("uniq_claim_claimant").on(t.claimId, t.claimantId)],
);

export type InheritanceClaimantShare =
  typeof inheritanceClaimantSharesTable.$inferSelect;

// ── Inheritance Documents ─────────────────────────────────────────────────

/**
 * Document placeholder records for inheritance claim verification.
 *
 * fileObjectPath is nullable — documents may be registered before the
 * actual file is uploaded (placeholder-first workflow).
 */
export const inheritanceDocumentsTable = pgTable("inheritance_documents", {
  id: uuid("id").defaultRandom().primaryKey(),

  claimId: uuid("claim_id")
    .notNull()
    .references(() => inheritanceClaimsTable.id, { onDelete: "cascade" }),

  // Optional: a document may belong to a specific claimant (e.g. their ID)
  claimantId: uuid("claimant_id").references(() => partnerClaimantsTable.id, {
    onDelete: "set null",
  }),

  documentType: inheritanceDocumentTypeEnum("document_type").notNull(),
  documentTitle: text("document_title").notNull(),
  description: text("description"),

  // Placeholder — null until file is actually uploaded
  fileObjectPath: text("file_object_path"),
  mimeType: text("mime_type"),

  verificationStatus: inheritanceDocumentVerificationEnum(
    "verification_status",
  )
    .notNull()
    .default("pending"),
  verificationNotes: text("verification_notes"),

  uploadedBy: uuid("uploaded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  uploadedByName: text("uploaded_by_name"),

  verifiedBy: uuid("verified_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  verifiedByName: text("verified_by_name"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),

  // Soft-archive
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type InheritanceDocument =
  typeof inheritanceDocumentsTable.$inferSelect;

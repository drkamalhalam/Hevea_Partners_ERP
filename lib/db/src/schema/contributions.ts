import {
  pgTable,
  uuid,
  text,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { agreementsTable } from "./agreements";
import {
  contributionTypeEnum,
  contributionVerificationStatusEnum,
} from "./enums";

/**
 * contributionsTable — the central contribution ledger.
 *
 * Accounting rules enforced here and in the API layer:
 *   1. `affectsOwnership` is auto-set based on type on INSERT (false for
 *      `operational_cost`; true for all others). Admin can override via
 *      PATCH for `manual_adjustment` entries only.
 *   2. Only rows where `verificationStatus = 'verified'` AND
 *      `lifecyclePhaseSnapshot = 'prematurity'` AND `affectsOwnership = true`
 *      are eligible to influence ownership guidance calculations.
 *   3. All amounts are in INR (Indian Rupees) as real numbers. Precision is
 *      adequate for financial reporting; use numeric if sub-paisa precision
 *      is ever required.
 *   4. `partnerName` is a denormalized snapshot for audit stability — even if
 *      a partner record changes, the ledger entry remains accurate.
 *   5. Soft-delete only: `deletedAt` / `isActive`. Hard deletes are prohibited
 *      in the API layer. All financial records must be retained.
 */
export const contributionsTable = pgTable("contributions", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── Core references ───────────────────────────────────────────────────────
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // The contributing party (partner). May be null if partner is deleted, but
  // `partnerName` snapshot preserves identity.
  partnerId: uuid("partner_id").references(() => partnersTable.id, {
    onDelete: "set null",
  }),

  // Denormalized snapshot — stable even after partner record changes
  partnerName: text("partner_name").notNull(),

  // ── Contribution classification ───────────────────────────────────────────
  contributionType: contributionTypeEnum("contribution_type").notNull(),

  // INR amount (positive value; direction is implied by type)
  amount: real("amount").notNull(),

  // ISO date string (YYYY-MM-DD) of when the contribution was made/dated
  contributionDate: text("contribution_date").notNull(),

  // Snapshot of the project lifecycle phase at the time of recording.
  // This is frozen on creation and not updated if the project advances —
  // preserving the historical context of the contribution.
  lifecyclePhaseSnapshot: text("lifecycle_phase_snapshot").notNull().default("prematurity"),

  // Optional link to the agreement this contribution relates to
  agreementId: uuid("agreement_id").references(() => agreementsTable.id, {
    onDelete: "set null",
  }),

  // External reference (voucher number, bank transaction ID, etc.)
  referenceNumber: text("reference_number"),

  remarks: text("remarks"),

  // ── Ownership impact ──────────────────────────────────────────────────────
  // Auto-set on INSERT: false for operational_cost, true for all others.
  // Admin may override for manual_adjustment entries via PATCH.
  // Used to filter the verified-prematurity ownership guidance query.
  affectsOwnership: boolean("affects_ownership").notNull().default(true),

  // ── Verification lifecycle ────────────────────────────────────────────────
  verificationStatus: contributionVerificationStatusEnum("verification_status")
    .notNull()
    .default("draft"),

  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: uuid("verified_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  verifiedByName: text("verified_by_name"), // denormalized snapshot
  verifierNotes: text("verifier_notes"),

  // ── Audit columns ─────────────────────────────────────────────────────────
  recordedBy: uuid("recorded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  recordedByName: text("recorded_by_name"), // denormalized snapshot

  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ── Zod schemas ───────────────────────────────────────────────────────────

export const insertContributionSchema = createInsertSchema(
  contributionsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type Contribution = typeof contributionsTable.$inferSelect;
export type InsertContribution = typeof contributionsTable.$inferInsert;

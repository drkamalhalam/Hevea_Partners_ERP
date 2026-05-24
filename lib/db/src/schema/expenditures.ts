import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import {
  expenditureCategoryEnum,
  expenditureVerificationStatusEnum,
} from "./enums";

/**
 * expendituresTable — operational cost ledger for plantation projects.
 *
 * Key design rules:
 *   1. Expenditure is ENTIRELY SEPARATE from ownership contributions.
 *      Recording an expenditure never alters ownership percentages.
 *   2. All amounts are in INR as real numbers.
 *   3. Soft-delete only: isActive flag. Hard deletes are prohibited.
 *   4. `paidByName` and `recordedByName` are denormalised snapshots for
 *      audit stability — records remain readable after user changes.
 *   5. `lifecyclePhaseSnapshot` is captured at creation time from the
 *      project's current lifecycleStatus and never updated.
 *   6. `invoiceObjectPath` is a placeholder for future GCS file upload;
 *      currently stores a path string if provided.
 */
export const expendituresTable = pgTable("expenditures", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── Core references ───────────────────────────────────────────────────────
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  // ── Who paid / incurred the cost ──────────────────────────────────────────
  paidById: uuid("paid_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  paidByName: text("paid_by_name"),

  // ── Classification ────────────────────────────────────────────────────────
  category: expenditureCategoryEnum("category").notNull(),

  // INR amount (positive value)
  amount: numericFlex("amount", { precision: 15, scale: 2 }).notNull(),

  // ISO date string (YYYY-MM-DD) when the expenditure was incurred
  expenditureDate: text("expenditure_date").notNull(),

  // Human-readable description of what was spent on
  description: text("description").notNull(),

  // Placeholder for future invoice / receipt file storage (GCS object path)
  invoiceObjectPath: text("invoice_object_path"),

  // Optional free-text notes
  notes: text("notes"),

  // ── Lifecycle context snapshot ────────────────────────────────────────────
  // Frozen at creation; reflects the project phase when the cost was incurred.
  lifecyclePhaseSnapshot: text("lifecycle_phase_snapshot")
    .notNull()
    .default("prematurity"),

  // ── Verification lifecycle ────────────────────────────────────────────────
  verificationStatus: expenditureVerificationStatusEnum("verification_status")
    .notNull()
    .default("draft"),

  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedById: uuid("verified_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  verifiedByName: text("verified_by_name"),
  verifierNotes: text("verifier_notes"),

  // ── Audit ─────────────────────────────────────────────────────────────────
  recordedById: uuid("recorded_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  recordedByName: text("recorded_by_name"),

  // ── Soft delete ───────────────────────────────────────────────────────────
  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

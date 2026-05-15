import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { partnersTable } from "./partners";
import { usersTable } from "./users";
import { expendituresTable } from "./expenditures";
import {
  postMaturityPaymentCategoryEnum,
  reimbursementStatusEnum,
} from "./enums";

/**
 * postMaturityCostPaymentsTable — separate ledger for cost payments made
 * AFTER a project reaches mature_production phase.
 *
 * These payments are NEVER ownership-forming contributions. They are tracked as
 * reimbursable project cost advances — the project (or other parties) owes the
 * payer back. Audit rules:
 *   1. Only INSERT and soft-update (status/approval). No hard deletes.
 *   2. Linked to a project in mature_production (enforced at API layer).
 *   3. Does NOT touch the contributions table or ownership calculations.
 *   4. `reimbursementStatus` advances: pending → approved/rejected → settled.
 */
export const postMaturityCostPaymentsTable = pgTable(
  "post_maturity_cost_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // ── Core references ────────────────────────────────────────────────────
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "restrict" }),

    // The party who made the payment (optional — may be external)
    partnerId: uuid("partner_id").references(() => partnersTable.id, {
      onDelete: "set null",
    }),
    // Denormalized snapshot for audit stability
    partnerName: text("partner_name").notNull(),

    // ── Payment details ────────────────────────────────────────────────────
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    paymentDate: text("payment_date").notNull(), // ISO YYYY-MM-DD

    description: text("description").notNull(),
    category: postMaturityPaymentCategoryEnum("category").notNull(),

    referenceNumber: text("reference_number"),
    remarks: text("remarks"),

    // ── Linked expense (optional) ──────────────────────────────────────────
    // If this payment covers a specific expenditure record
    linkedExpenditureId: uuid("linked_expenditure_id").references(
      () => expendituresTable.id,
      { onDelete: "set null" },
    ),

    // ── Reimbursement lifecycle ────────────────────────────────────────────
    reimbursementStatus: reimbursementStatusEnum("reimbursement_status")
      .notNull()
      .default("pending"),

    approvedBy: uuid("approved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedByName: text("approved_by_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNotes: text("approval_notes"),

    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledByName: text("settled_by_name"),
    settlementNote: text("settlement_note"),

    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedByName: text("rejected_by_name"),
    rejectionReason: text("rejection_reason"),

    // ── Audit ──────────────────────────────────────────────────────────────
    recordedBy: uuid("recorded_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    recordedByName: text("recorded_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type PostMaturityCostPayment =
  typeof postMaturityCostPaymentsTable.$inferSelect;
export type InsertPostMaturityCostPayment =
  typeof postMaturityCostPaymentsTable.$inferInsert;

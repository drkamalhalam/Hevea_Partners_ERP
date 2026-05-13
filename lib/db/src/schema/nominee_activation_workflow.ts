import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  nomineeActivationTypeEnum,
  nomineeActivationWorkflowStatusEnum,
} from "./enums";
import { projectsTable } from "./projects";
import { projectNomineesTable } from "./nominees";
import { usersTable } from "./users";

/**
 * nominee_activation_workflows — tracks each activation attempt for a nominee.
 *
 * Two modes:
 *   death_based       — death certificate submitted → admin verifies → activated
 *   voluntary_handover — declaration deed submitted → developer OTP verified → activated
 *
 * IMPORTANT: Activation confers operational governance authority ONLY.
 * It is NOT an ownership transfer or equity change.
 *
 * All state transitions must create entries in activityTable (enforced in route handlers).
 */
export const nomineeActivationWorkflowsTable = pgTable(
  "nominee_activation_workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    nomineeId: uuid("nominee_id")
      .notNull()
      .references(() => projectNomineesTable.id, { onDelete: "cascade" }),

    /** Denormalized for display without a join */
    nomineeName: text("nominee_name").notNull(),

    activationType: nomineeActivationTypeEnum("activation_type").notNull(),
    status: nomineeActivationWorkflowStatusEnum("status").notNull(),

    // ── Documents ──────────────────────────────────────────────────────────
    /** Death certificate scan URL — placeholder (future: object storage) */
    deathCertificateUrl: text("death_certificate_url"),
    /** Declaration deed URL — placeholder (future: object storage) */
    declarationDeedUrl: text("declaration_deed_url"),

    // ── OTP — voluntary handover only ─────────────────────────────────────
    /** OTP code (plaintext; exposed in dev-mode responses only) */
    otpCode: text("otp_code"),
    otpSentAt: timestamp("otp_sent_at", { withTimezone: true }),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),
    otpVerifiedBy: uuid("otp_verified_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    otpVerifiedByName: text("otp_verified_by_name"),

    // ── Verification — death-based only ───────────────────────────────────
    verifiedBy: uuid("verified_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    verifiedByName: text("verified_by_name"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationNotes: text("verification_notes"),

    // ── Activation (set when status → activated) ───────────────────────────
    activatedBy: uuid("activated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    activatedByName: text("activated_by_name"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),

    // ── Rejection / cancellation ───────────────────────────────────────────
    rejectedBy: uuid("rejected_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    rejectedByName: text("rejected_by_name"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    // ── General ────────────────────────────────────────────────────────────
    governanceRemarks: text("governance_remarks"),

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
  },
);

export type NomineeActivationWorkflow =
  typeof nomineeActivationWorkflowsTable.$inferSelect;

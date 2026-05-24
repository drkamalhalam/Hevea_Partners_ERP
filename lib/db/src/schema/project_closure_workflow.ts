import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { projectClosureWorkflowStatusEnum } from "./enums";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * project_closure_workflows — governance record for each project closure attempt.
 *
 * Closure is OPERATIONAL ONLY. All historical data is permanently preserved.
 * Requires landowner acknowledgment (via OTP) or explicit admin waiver before
 * the project lifecycle is transitioned to "closed".
 *
 * State machine (forward-only):
 *   pending_acknowledgment → acknowledged  (OTP verified or admin waiver)
 *   acknowledged           → closed        (admin finalises; lifecycle = closed)
 *   pending_acknowledgment / acknowledged  → cancelled  (admin abort)
 */
export const projectClosureWorkflowsTable = pgTable("project_closure_workflows", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  status: projectClosureWorkflowStatusEnum("status").notNull(),

  // ── Closure details ────────────────────────────────────────────────────
  closureReason: text("closure_reason").notNull(),
  closureRemarks: text("closure_remarks"),

  // ── Initiation ────────────────────────────────────────────────────────
  initiatedBy: uuid("initiated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  initiatedByName: text("initiated_by_name"),
  initiatedAt: timestamp("initiated_at", { withTimezone: true }).notNull().defaultNow(),

  // ── Landowner acknowledgment OTP ──────────────────────────────────────
  /** OTP code (plaintext; dev-mode only) */
  otpCode: text("otp_code"),
  otpSentAt: timestamp("otp_sent_at", { withTimezone: true }),
  otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
  otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),

  // ── Acknowledgment ────────────────────────────────────────────────────
  acknowledgedBy: uuid("acknowledged_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  acknowledgedByName: text("acknowledged_by_name"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgmentNotes: text("acknowledgment_notes"),

  /** true when admin bypassed OTP; OTP fields remain null */
  acknowledgmentWaived: boolean("acknowledgment_waived").notNull().default(false),

  // ── Waiver (admin bypass of OTP requirement) ──────────────────────────
  waivedBy: uuid("waived_by").references(() => usersTable.id, { onDelete: "set null" }),
  waivedByName: text("waived_by_name"),
  waivedAt: timestamp("waived_at", { withTimezone: true }),
  waivedReason: text("waived_reason"),

  // ── Cancellation ──────────────────────────────────────────────────────
  cancelledBy: uuid("cancelled_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  cancelledByName: text("cancelled_by_name"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),

  // ── V3 Wave 1: closure snapshot frontier refs (no behavior yet) ─────────
  /** Free-text closure rationale captured at snapshot time. */
  closureExplanation: text("closure_explanation"),
  /** FK-by-id to the ownership snapshot used at closure (FK left soft to avoid cycles). */
  closureOwnershipSnapshotReference: uuid("closure_ownership_snapshot_reference"),
  /** Max partner_financial_ledger.id frozen at closure (replay frontier). */
  closureLedgerMaxId: uuid("closure_ledger_max_id"),
  /** Max held_distribution_ledger.id frozen at closure (held frontier). */
  closureHoldsMaxId: uuid("closure_holds_max_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProjectClosureWorkflow = typeof projectClosureWorkflowsTable.$inferSelect;

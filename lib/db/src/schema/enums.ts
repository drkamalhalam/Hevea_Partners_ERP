import { pgEnum } from "drizzle-orm/pg-core";

// ── User & access enums ───────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "developer",
  "landowner",
  "investor",
  "employee",
  "operational_staff",
]);

// ── Project enums ─────────────────────────────────────────────────────────

export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "developing",
  "maturing",
  "tapping",
  "completed",
  "suspended",
]);

// ── Notification enums ────────────────────────────────────────────────────

export const notificationTypeEnum = pgEnum("notification_type", [
  "agreement_renewal",
  "payment_due",
  "system_alert",
  "task_assigned",
  "report_ready",
  "general",
]);

// ── Nominee enums ─────────────────────────────────────────────────────────

/**
 * Activation status for project nominees.
 * Designed for future governance continuity workflows.
 *   pending   — nominee recorded, governance workflow not triggered
 *   activated — nominee activated by authorised admin for continuity
 *   revoked   — activation revoked; nominee may still be replaced
 */
export const nomineeActivationStatusEnum = pgEnum(
  "nominee_activation_status",
  ["pending", "activated", "revoked"],
);

// ── Claimant enums ────────────────────────────────────────────────────────

/**
 * Status of a partner claimant record.
 *   registered          — details captured, no verification started
 *   pending_verification— documents submitted, under review
 *   verified            — admin-verified claim record
 *   disputed            — claim under dispute; blocked from further action
 */
export const claimantStatusEnum = pgEnum("claimant_status", [
  "registered",
  "pending_verification",
  "verified",
  "disputed",
]);

// ── Lifecycle enums ───────────────────────────────────────────────────────

/**
 * Lifecycle phases of a rubber plantation project.
 * This is a forward-only state machine — status cannot be reversed.
 *   prematurity      — trees planted, pre-tapping phase (default for all new projects)
 *   mature_production — trees are mature and producing (irreversible once set)
 *   closed            — project closed/ended (terminal state)
 */
export const projectLifecycleStatusEnum = pgEnum("project_lifecycle_status", [
  "prematurity",
  "mature_production",
  "closed",
]);

// ── Maturity declaration enums ────────────────────────────────────────────

/**
 * Overall status of a maturity declaration workflow instance.
 *   pending_otp  — declaration created, waiting for all parties to verify OTP
 *   completed    — all OTPs verified; lifecycle transitioned to mature_production
 *   cancelled    — cancelled before completion by developer or admin
 */
export const maturityDeclarationStatusEnum = pgEnum(
  "maturity_declaration_status",
  ["pending_otp", "completed", "cancelled"],
);

/**
 * Which party is responsible for an OTP verification row.
 */
export const maturityOtpPartyEnum = pgEnum("maturity_otp_party", [
  "developer",
  "landowner",
]);

/**
 * Lifecycle of a single OTP verification.
 *   pending  — generated, not yet sent
 *   sent     — dispatched (mock: code is visible in response)
 *   verified — correct code entered
 *   failed   — max attempts exceeded; resend required
 *   expired  — sentAt + 30 min elapsed without verification
 */
export const maturityOtpStatusEnum = pgEnum("maturity_otp_status", [
  "pending",
  "sent",
  "verified",
  "failed",
  "expired",
]);

// ── Audit enums ───────────────────────────────────────────────────────────

export const dbOperationEnum = pgEnum("db_operation", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

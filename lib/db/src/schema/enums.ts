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

// ── Audit enums ───────────────────────────────────────────────────────────

export const dbOperationEnum = pgEnum("db_operation", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

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
  "missing_developer",
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

// ── Nominee activation workflow enums ────────────────────────────────────

export const nomineeActivationTypeEnum = pgEnum("nominee_activation_type", [
  "death_based",
  "voluntary_handover",
]);

/**
 * Status of a nominee activation *workflow* record (distinct from
 * nomineeActivationStatusEnum which lives on the projectNomineesTable row).
 *
 *   pending_verification — death-based: documents submitted, awaiting admin approval
 *   pending_otp          — voluntary: OTP sent to current developer, awaiting entry
 *   activated            — workflow complete; nominee record has been activated
 *   rejected             — admin rejected the activation request
 *   cancelled            — initiator cancelled before completion
 */
export const nomineeActivationWorkflowStatusEnum = pgEnum(
  "nominee_activation_workflow_status",
  [
    "pending_verification",
    "pending_otp",
    "activated",
    "rejected",
    "cancelled",
  ],
);

// ── Project closure workflow enums ───────────────────────────────────────

/**
 * Status of a project closure workflow.
 *   pending_acknowledgment — closure initiated; waiting for landowner OTP acknowledgment
 *   acknowledged           — landowner confirmed or admin waived; lifecycle transitions to closed
 *   closed                 — workflow complete; project lifecycle = closed
 *   cancelled              — workflow cancelled before completion
 */
export const projectClosureWorkflowStatusEnum = pgEnum(
  "project_closure_workflow_status",
  ["pending_acknowledgment", "acknowledged", "closed", "cancelled"],
);

// ── Ownership freeze enums ────────────────────────────────────────────────

/**
 * Status of an ownership freeze record.
 *   frozen              — default; ownership structure is locked; no direct changes
 *   transfer_pending    — a share transfer is in progress (structural lock remains)
 *   inheritance_pending — an inheritance settlement is in progress (structural lock remains)
 *
 * Note: all statuses still enforce the freeze — transfer_pending and
 * inheritance_pending only indicate an approved governance workflow is active.
 */
export const ownershipFreezeStatusEnum = pgEnum("ownership_freeze_status", [
  "frozen",
  "transfer_pending",
  "inheritance_pending",
]);

// ── Audit enums ───────────────────────────────────────────────────────────

export const dbOperationEnum = pgEnum("db_operation", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

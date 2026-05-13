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

// ── Agreement template enums ──────────────────────────────────────────────

/**
 * Supported file formats for agreement templates.
 *   docx — Microsoft Word document (editable, variable substitution supported)
 *   pdf  — PDF document (read-only preview)
 */
export const templateFileFormatEnum = pgEnum("template_file_format", [
  "docx",
  "pdf",
]);

/**
 * Lifecycle status of an agreement template.
 *   active   — available for use
 *   archived — removed from active library; retained for audit
 */
export const templateStatusEnum = pgEnum("template_status", [
  "active",
  "archived",
]);

// ── Agreement activation workflow enums ──────────────────────────────────

/**
 * Status of an agreement activation workflow session.
 *   pending_otp — activation initiated; OTPs sent, awaiting party verification
 *   completed   — all parties verified; agreement becomes active
 *   cancelled   — cancelled before completion by admin/developer
 *   rejected    — a party explicitly rejected; agreement returns to draft
 */
export const agreementActivationStatusEnum = pgEnum(
  "agreement_activation_status",
  ["pending_otp", "completed", "cancelled", "rejected"],
);

/**
 * Which party is responsible for an agreement activation OTP row.
 */
export const agreementActivationPartyEnum = pgEnum(
  "agreement_activation_party",
  ["landowner", "developer"],
);

/**
 * Lifecycle of a single OTP row in an agreement activation workflow.
 *   pending  — generated, not yet sent
 *   sent     — dispatched (placeholder: code visible in response)
 *   verified — correct code entered; party confirmed
 *   failed   — max attempts exceeded
 *   expired  — sentAt + 30 min elapsed without verification
 */
export const agreementActivationOtpStatusEnum = pgEnum(
  "agreement_activation_otp_status",
  ["pending", "sent", "verified", "failed", "expired"],
);

// ── Document enums ────────────────────────────────────────────────────────

/**
 * Category of a stored document.
 *   agreement   — signed deed, amendment, or agreement PDF
 *   template    — reusable agreement/governance template (DOCX or PDF)
 *   supporting  — land records, survey maps, KYC, boundary documents
 *   governance  — board resolutions, regulatory filings, compliance docs
 *   operational — operational reports, tapping logs, maintenance records
 */
export const documentCategoryEnum = pgEnum("document_category", [
  "agreement",
  "template",
  "supporting",
  "governance",
  "operational",
]);

/**
 * Lifecycle status of a stored document.
 *   active   — visible and downloadable
 *   archived — hidden from default listing; retained for audit
 */
export const documentStatusEnum = pgEnum("document_status", [
  "active",
  "archived",
]);

/**
 * Action types logged in the document access audit trail.
 */
export const documentAccessActionEnum = pgEnum("document_access_action", [
  "upload",
  "view",
  "download",
  "archive",
  "restore",
  "delete",
  "metadata_update",
]);

// ── Contribution enums ────────────────────────────────────────────────────

/**
 * Five contribution types with distinct ownership and accounting treatment.
 *
 *   land_notional       — landowner's land value monetised as capital contribution;
 *                         affects ownership guidance when verified in prematurity phase
 *   economic_investment — cash/in-kind capital invested by any partner;
 *                         affects ownership guidance when verified in prematurity phase
 *   operational_cost    — costs of running the plantation (inputs, labour, etc.);
 *                         does NOT create ownership rights
 *   recoverable_advance — bridge funding that is expected to be recovered from revenue;
 *                         affects ownership guidance when verified in prematurity phase
 *   manual_adjustment   — admin-initiated correction or reconciliation entry;
 *                         ownership impact governed by affectsOwnership flag
 */
export const contributionTypeEnum = pgEnum("contribution_type", [
  "land_notional",
  "economic_investment",
  "operational_cost",
  "recoverable_advance",
  "manual_adjustment",
]);

/**
 * Verification lifecycle of a single contribution record.
 *   draft                — entry saved; not yet submitted for verification
 *   pending_verification — submitted; awaiting admin review
 *   verified             — admin-confirmed; eligible to affect ownership guidance
 *   rejected             — admin rejected; does not affect ownership guidance
 *   disputed             — a verified contribution has been contested; blocks maturity declaration
 */
export const contributionVerificationStatusEnum = pgEnum(
  "contribution_verification_status",
  ["draft", "pending_verification", "verified", "rejected", "disputed"],
);

// ── Contribution verification event enums ─────────────────────────────────

/**
 * Event types in the immutable verification audit trail.
 *   verification_requested — a verifier was assigned or re-assigned
 *   approved               — designated verifier (or admin) approved the contribution
 *   rejected               — designated verifier (or admin) rejected it
 *   re_approved            — previously-rejected contribution approved after appeal
 *   verifier_changed       — verifier assignment changed (records old → new verifier)
 *   otp_sent               — OTP challenge dispatched (placeholder for future flow)
 *   otp_verified           — OTP confirmed by counterparty (placeholder)
 *   dispute_raised         — a verified contribution has been contested; governance alert raised
 *   dispute_resolved       — dispute resolved by re-verifying the contribution
 *   dispute_overridden     — dispute administratively closed without re-verification
 */
export const contributionVerificationEventTypeEnum = pgEnum(
  "contribution_verification_event_type",
  [
    "verification_requested",
    "approved",
    "rejected",
    "re_approved",
    "verifier_changed",
    "otp_sent",
    "otp_verified",
    "dispute_raised",
    "dispute_resolved",
    "dispute_overridden",
  ],
);

// ── Ownership snapshot enums ──────────────────────────────────────────────

/**
 * What triggered an ownership snapshot to be saved.
 *   manual                — admin/developer explicitly requested it
 *   auto_on_verification  — automatically taken when a contribution is verified
 *   maturity_declaration  — taken as part of the maturity declaration workflow
 */
export const ownershipSnapshotTypeEnum = pgEnum("ownership_snapshot_type", [
  "manual",
  "auto_on_verification",
  "maturity_declaration",
]);

// ── Audit enums ───────────────────────────────────────────────────────────

export const dbOperationEnum = pgEnum("db_operation", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

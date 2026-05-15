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

/**
 * Commercial / revenue model governing an entire plantation project.
 * This is the master behavioral controller — downstream modules (LCA,
 * ownership engine, land notional value, contribution equity) all derive
 * their permitted operations from this field.
 *
 *   ownership_contribution  — revenue split by verified contribution-based
 *                             ownership percentages; LCA eligible after maturity.
 *   fifty_percent_revenue   — contractual fixed-split model (typically 50 / 50);
 *                             no ownership equity, no LCA, no land notional value.
 */
export const projectCommercialModelEnum = pgEnum("project_commercial_model", [
  "ownership_contribution",
  "fifty_percent_revenue",
]);

/**
 * Activation lifecycle of a plantation project.
 * Projects begin as drafts and progress through verification steps before
 * being activated. Only ACTIVE projects may collect production, process
 * sales, or generate accounting entries.
 *
 *   draft                         — initial state; setup in progress
 *   pending_verification          — submitted for admin review
 *   pending_agreement             — awaiting agreement upload / activation
 *   pending_participant_confirmation — awaiting participant confirmations
 *   pending_land_verification     — land records under verification
 *   ready_for_activation          — all pre-checks passed; pending final activation
 *   active                        — fully operational
 *   suspended                     — temporarily halted
 *   closed                        — terminal state; all operations locked
 */
export const projectActivationStatusEnum = pgEnum("project_activation_status", [
  "draft",
  "pending_verification",
  "pending_agreement",
  "pending_participant_confirmation",
  "pending_land_verification",
  "ready_for_activation",
  "active",
  "suspended",
  "closed",
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
  "maturity_preview",
]);

// ── Audit enums ───────────────────────────────────────────────────────────

export const dbOperationEnum = pgEnum("db_operation", [
  "INSERT",
  "UPDATE",
  "DELETE",
]);

// ── Burden accounting enums ───────────────────────────────────────────────────

/**
 * Who is expected to bear an operational cost.
 *   developer    — 100% developer's responsibility
 *   landowner    — 100% landowner's responsibility
 *   shared       — fixed split by configured percentages
 *   proportional — split proportional to ownership stakes
 */
export const burdenBearerTypeEnum = pgEnum("burden_bearer_type", [
  "developer",
  "landowner",
  "shared",
  "proportional",
]);

/**
 * High-level characterisation of the imbalance between expected and actual payer.
 *   balanced          — actual matches expected; no recovery needed
 *   developer_advance — developer paid more than their share; landowner owes developer
 *   landowner_advance — landowner paid more than their share; developer owes landowner
 *   waived            — imbalance acknowledged and written off
 */
export const burdenAdjustmentStatusEnum = pgEnum("burden_adjustment_status", [
  "balanced",
  "developer_advance",
  "landowner_advance",
  "waived",
]);

/**
 * Recovery lifecycle for a burden imbalance.
 *   none        — no imbalance; nothing to recover
 *   pending     — imbalance exists; recovery not yet initiated
 *   in_recovery — partial repayment in progress
 *   recovered   — fully recovered
 *   waived      — parties agreed to write off the imbalance
 */
export const burdenRecoveryStatusEnum = pgEnum("burden_recovery_status", [
  "none",
  "pending",
  "in_recovery",
  "recovered",
  "waived",
]);

// ── Expenditure enums ─────────────────────────────────────────────────────────

/**
 * Operational expenditure categories for plantation cost tracking.
 * These are day-to-day running costs and are entirely separate from
 * ownership contributions (which affect equity calculations).
 */
export const expenditureCategoryEnum = pgEnum("expenditure_category", [
  "labor",
  "fertilizer",
  "transport",
  "machinery",
  "maintenance",
  "consumables",
  "plantation_operations",
  "miscellaneous",
]);

/**
 * Verification lifecycle of an expenditure record.
 *   draft          — saved by staff, not yet submitted for review
 *   pending_review — submitted; awaiting admin / developer approval
 *   approved       — accepted; included in cost reporting
 *   rejected       — declined; excluded from cost reporting
 */
export const expenditureVerificationStatusEnum = pgEnum(
  "expenditure_verification_status",
  ["draft", "pending_review", "approved", "rejected"],
);

// ── Expenditure verification workflow enums ───────────────────────────────────

/**
 * Status of a dedicated expenditure verification request.
 *   pending   — request open; waiting for the designated verifier to act
 *   approved  — verifier accepted the expenditure
 *   rejected  — verifier rejected; raises a governance alert
 *   cancelled — request voided (e.g. expenditure archived or re-submitted)
 */
export const expenditureVerificationRequestStatusEnum = pgEnum(
  "expenditure_verification_request_status",
  ["pending", "approved", "rejected", "cancelled"],
);

/**
 * Immutable event types in the expenditure verification audit trail.
 *   submitted          — expenditure submitted for verification
 *   routing_assigned   — verifier role/user determined and request created
 *   otp_requested      — OTP challenge sent to verifier (placeholder)
 *   otp_verified       — OTP confirmed (placeholder)
 *   approved           — verifier approved
 *   rejected           — verifier rejected
 *   resubmitted        — previously-rejected expenditure re-submitted for review
 *   cancelled          — verification request cancelled
 */
export const expenditureVerificationEventTypeEnum = pgEnum(
  "expenditure_verification_event_type",
  [
    "submitted",
    "routing_assigned",
    "otp_requested",
    "otp_verified",
    "approved",
    "rejected",
    "resubmitted",
    "cancelled",
    "edited",
  ],
);

// ── Recoverable advance enums ──────────────────────────────────────────────────

/**
 * Lifecycle status of a recoverable advance.
 *
 *   pending      — advance raised, awaiting acknowledgement
 *   acknowledged — responsible party has confirmed the liability
 *   in_recovery  — partial or ongoing repayment in progress
 *   recovered    — fully repaid
 *   written_off  — parties agreed to forgo recovery (no ownership implication)
 */
export const recoverableAdvanceStatusEnum = pgEnum("recoverable_advance_status", [
  "pending",
  "acknowledged",
  "in_recovery",
  "recovered",
  "written_off",
]);

// ── Operational alert enums ───────────────────────────────────────────────

/**
 * Category of operational governance alert.
 *   negative_stock           — computed stock balance < 0 for a project/type
 *   missing_batch_linkage    — production_in or sale movement with no batch reference
 *   inventory_inconsistency  — production_in quantity doesn't reconcile with batch total
 *   suspicious_adjustment    — large adjustment movement without justification
 *   unusual_sales_change     — flagged sale edit detected by sale audit engine
 *   missing_operational_record — open production batch > threshold age (not closed)
 */
export const operationalAlertTypeEnum = pgEnum("operational_alert_type", [
  "negative_stock",
  "missing_batch_linkage",
  "inventory_inconsistency",
  "suspicious_adjustment",
  "unusual_sales_change",
  "missing_operational_record",
]);

/**
 * Severity of an operational alert.
 *   critical — requires immediate action (e.g. negative stock)
 *   warning  — should be investigated soon
 *   info     — informational; not blocking
 */
export const alertSeverityEnum = pgEnum("alert_severity", [
  "critical",
  "warning",
  "info",
]);

/**
 * Lifecycle status of an operational alert.
 *   open         — newly generated, no action taken
 *   acknowledged — an admin/developer has seen and noted it
 *   resolved     — root cause addressed; alert closed
 *   dismissed    — admin determined alert is a false positive or not actionable
 */
export const alertStatusEnum = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
]);

// ── Operational task enums ────────────────────────────────────────────────

/**
 * Type of operational task.
 *   production_entry — log a production batch or daily tapping record
 *   stock_update     — update stock movements or inventory counts
 *   inspection       — field inspection or quality check
 *   general          — any other operational task
 */
export const taskTypeEnum = pgEnum("task_type", [
  "production_entry",
  "stock_update",
  "inspection",
  "general",
]);

/**
 * Status of an operational task.
 *   pending     — assigned but not started
 *   in_progress — assignee has acknowledged and begun work
 *   completed   — task finished successfully
 *   cancelled   — task voided by admin/developer before completion
 */
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

/**
 * Priority of an operational task.
 */
export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

// ── Production & collection enums ────────────────────────────────────────

/**
 * Role an employee plays within a project's production workflow.
 *   collector    — responsible for daily fresh-sheet collection entries
 *   store_keeper — responsible for store entries (dried sheets)
 *   supervisor   — oversight role; can view all production data for the project
 */
export const productionEmployeeRoleEnum = pgEnum("production_employee_role", [
  "collector",
  "store_keeper",
  "supervisor",
]);

// ── Ownership transfer enums ──────────────────────────────────────────────

/**
 * Transfer type for an ownership share transfer request.
 *   internal      — transfer to an existing registered project partner
 *   third_party   — transfer to a person/entity not in the partner registry
 *                   (requires ROFR completion + min ₹1L value)
 */
export const ownershipTransferTypeEnum = pgEnum("ownership_transfer_type", [
  "internal",
  "third_party",
]);

/**
 * Status of an ownership share transfer request (forward-only state machine).
 *
 *   draft            — created, editable; not yet submitted
 *   pending_rofr     — ROFR notices sent to existing partners (14-day window)
 *   rofr_accepted    — an existing partner accepted the ROFR offer
 *   rofr_rejected    — all existing partners declined; third-party transfer now allowed
 *   pending_approval — awaiting governance / admin approval
 *   approved         — admin approved; awaiting execution
 *   executed         — transfer complete; ownership records updated by admin
 *   cancelled        — cancelled by transferor or admin before execution
 *   expired          — ROFR deadline passed with no responses recorded
 */
export const ownershipTransferStatusEnum = pgEnum("ownership_transfer_status", [
  "draft",
  "pending_rofr",
  "rofr_accepted",
  "rofr_rejected",
  "pending_approval",
  "approved",
  "executed",
  "cancelled",
  "expired",
]);

// ── Transfer ROFR Offer enums ─────────────────────────────────────────────

export const transferRofrOfferStatusEnum = pgEnum("transfer_rofr_offer_status", [
  "pending",    // notified, awaiting response
  "accepted",   // partner wants to exercise ROFR
  "rejected",   // partner declines ROFR
  "expired",    // deadline passed, treated as rejected
]);

// ── Transfer OTP enums ────────────────────────────────────────────────────

/** What action the OTP is authorising */
export const transferOtpPurposeEnum = pgEnum("transfer_otp_purpose", [
  "rofr_acceptance",   // partner accepting a ROFR offer
  "rofr_rejection",    // partner formally declining a ROFR offer
  "transfer_execution",// transferor confirming execution
  "transfer_submission",// transferor submitting the request
]);

export const transferOtpStatusEnum = pgEnum("transfer_otp_status", [
  "pending",    // generated, not yet used
  "verified",   // successfully verified
  "expired",    // TTL elapsed before verification
  "cancelled",  // superseded by a new OTP
]);

/** Delivery channel used (placeholder until real provider is wired) */
export const transferOtpDeliveryEnum = pgEnum("transfer_otp_delivery", [
  "placeholder", // dev-mode: code is returned directly in the API response
  "email",       // future: delivered via email
  "sms",         // future: delivered via SMS
]);

// ── Transfer audit event type enum ────────────────────────────────────────

export const transferAuditEventTypeEnum = pgEnum("transfer_audit_event_type", [
  "created",
  "submitted",
  "rofr_offer_sent",
  "rofr_response_recorded",
  "rofr_finalized",
  "otp_generated",
  "otp_verified",
  "otp_failed",
  "approved",
  "executed",
  "cancelled",
  "expired",
  "note_added",
]);

// ── Land Contribution Adjustment (LCA) enums ──────────────────────────────

/**
 * lcaLedgerStatusEnum — payment status of a yearly LCA ledger entry.
 *
 *   pending  — not yet due or no payment recorded
 *   partial  — partial payment received; balance > 0 (will carry forward)
 *   paid     — fully settled for the year
 *   waived   — admin decision to waive the LCA for the year
 */
export const lcaLedgerStatusEnum = pgEnum("lca_ledger_status", [
  "pending",
  "partial",
  "paid",
  "waived",
]);

// ── Inheritance & succession enums ────────────────────────────────────────

/**
 * Type of inheritance claim being filed.
 *   death               — partner has passed; succession via heirs
 *   incapacity          — partner is incapacitated; nominee/guardian taking over
 *   voluntary_transfer  — partner voluntarily transfers stake to designated heir
 */
export const inheritanceClaimTypeEnum = pgEnum("inheritance_claim_type", [
  "death",
  "incapacity",
  "voluntary_transfer",
]);

/**
 * Status of an inheritance claim workflow.
 * Forward-only: open → under_review → developer_approved → documents_verified → approved → settled
 * OR: open/under_review/developer_approved → rejected
 */
export const inheritanceClaimStatusEnum = pgEnum("inheritance_claim_status", [
  "open",
  "under_review",
  "developer_approved",
  "documents_verified",
  "approved",
  "rejected",
  "settled",
]);

/**
 * Status of a manually proposed claimant share allocation.
 * System NEVER auto-computes shares — admin/developer must enter each value.
 */
export const inheritanceShareStatusEnum = pgEnum("inheritance_share_status", [
  "proposed",
  "approved",
  "disputed",
]);

/**
 * Category of document submitted as part of an inheritance claim.
 */
export const inheritanceDocumentTypeEnum = pgEnum("inheritance_document_type", [
  "death_certificate",
  "succession_certificate",
  "court_order",
  "tribal_council_letter",
  "id_proof",
  "affidavit",
  "land_record",
  "other",
]);

/**
 * Verification status of a submitted inheritance document.
 */
export const inheritanceDocumentVerificationEnum = pgEnum(
  "inheritance_document_verification",
  ["pending", "verified", "rejected"],
);

/**
 * partnerIdentityGuard.ts
 *
 * Centralized partner-identity validation for ownership-sensitive routes.
 *
 * A partner is considered VALID for ownership attribution iff:
 *   - the partners row exists,
 *   - it is not soft-deleted (`deletedAt IS NULL`),
 *   - it is active (`isActive = true`),
 *   - it carries a non-null `personMasterId`,
 *   - the referenced person_master row exists,
 *   - the person's `status = 'active'`.
 *
 * Failures are recorded write-once to `identity_validation_failures` for
 * monitoring; successful validations are silent.
 *
 * This module does NOT mutate ownership math, transfer/inheritance history,
 * or snapshots. It only validates and reports.
 */

import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  partnersTable,
  personMasterTable,
  projectParticipantsTable,
  identityValidationFailuresTable,
} from "@workspace/db";
import { logger } from "./logger";

export type PartnerIdentityAction =
  | "partner.create"
  | "partner.patch"
  | "contribution.create"
  | "contribution.verify"
  | "transfer.create"
  | "transfer.patch"
  | "transfer.execute"
  | "contribution.dispute_re_verify"
  | "inheritance.finalize";

export type PartnerIdentityFailureCode =
  // partner-side failures
  | "PARTNER_ID_MISSING"
  | "PARTNER_NOT_FOUND"
  | "PARTNER_DELETED"
  | "PARTNER_INACTIVE"
  | "PARTNER_PERSON_LINK_MISSING"
  // person_master-side failures
  | "PERSON_MASTER_ID_MISSING"
  | "PERSON_MASTER_NOT_FOUND"
  | "PERSON_MASTER_INACTIVE";

export interface PartnerIdentityActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
}

export interface PartnerIdentityFailure {
  ok: false;
  code: PartnerIdentityFailureCode;
  reason: string;
}

export interface PartnerIdentityOk {
  ok: true;
  partner: typeof partnersTable.$inferSelect;
  personMasterId: string;
}

export type PartnerIdentityResult =
  | PartnerIdentityOk
  | PartnerIdentityFailure;

const REASONS: Record<PartnerIdentityFailureCode, string> = {
  PARTNER_ID_MISSING:
    "A partnerId is required for ownership-affecting actions.",
  PARTNER_NOT_FOUND: "Referenced partner does not exist.",
  PARTNER_DELETED:
    "Referenced partner has been soft-deleted and cannot participate in ownership actions.",
  PARTNER_INACTIVE:
    "Referenced partner is inactive and cannot participate in ownership actions.",
  PARTNER_PERSON_LINK_MISSING:
    "Referenced partner is not linked to a Person Registry entry — link the partner to a person_master record before proceeding.",
  PERSON_MASTER_ID_MISSING:
    "A personMasterId is required for this action.",
  PERSON_MASTER_NOT_FOUND:
    "Referenced person_master record does not exist.",
  PERSON_MASTER_INACTIVE:
    "Referenced person is not active (status must be 'active').",
};

// ─────────────────────────────────────────────────────────────────────────────
// Low-level validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a partner for ownership attribution. Returns the partner row when
 * valid; returns a typed failure otherwise.
 */
export async function validatePartnerIdentity(
  partnerId: string | null | undefined,
): Promise<PartnerIdentityResult> {
  if (!partnerId || typeof partnerId !== "string") {
    return { ok: false, code: "PARTNER_ID_MISSING", reason: REASONS.PARTNER_ID_MISSING };
  }

  const [partner] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, partnerId))
    .limit(1);

  if (!partner) {
    return { ok: false, code: "PARTNER_NOT_FOUND", reason: REASONS.PARTNER_NOT_FOUND };
  }
  if (partner.deletedAt) {
    return { ok: false, code: "PARTNER_DELETED", reason: REASONS.PARTNER_DELETED };
  }
  if (partner.isActive === false) {
    return { ok: false, code: "PARTNER_INACTIVE", reason: REASONS.PARTNER_INACTIVE };
  }
  if (!partner.personMasterId) {
    return {
      ok: false,
      code: "PARTNER_PERSON_LINK_MISSING",
      reason: REASONS.PARTNER_PERSON_LINK_MISSING,
    };
  }

  const personCheck = await validatePersonMasterActive(partner.personMasterId);
  if (!personCheck.ok) return personCheck;

  return { ok: true, partner, personMasterId: partner.personMasterId };
}

/**
 * Validate that a person_master row exists and is active.
 */
export async function validatePersonMasterActive(
  personMasterId: string | null | undefined,
): Promise<
  | { ok: true; personMasterId: string }
  | PartnerIdentityFailure
> {
  if (!personMasterId || typeof personMasterId !== "string") {
    return {
      ok: false,
      code: "PERSON_MASTER_ID_MISSING",
      reason: REASONS.PERSON_MASTER_ID_MISSING,
    };
  }
  const [person] = await db
    .select({ id: personMasterTable.id, status: personMasterTable.status })
    .from(personMasterTable)
    .where(eq(personMasterTable.id, personMasterId))
    .limit(1);

  if (!person) {
    return {
      ok: false,
      code: "PERSON_MASTER_NOT_FOUND",
      reason: REASONS.PERSON_MASTER_NOT_FOUND,
    };
  }
  if (String(person.status) !== "active") {
    return {
      ok: false,
      code: "PERSON_MASTER_INACTIVE",
      reason: REASONS.PERSON_MASTER_INACTIVE,
    };
  }
  return { ok: true, personMasterId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit-writing
// ─────────────────────────────────────────────────────────────────────────────

interface RecordFailureInput {
  action: PartnerIdentityAction;
  failure: PartnerIdentityFailure;
  actor: PartnerIdentityActor;
  projectId?: string | null;
  partnerId?: string | null;
  personMasterId?: string | null;
  targetTable?: string | null;
  targetRecordId?: string | null;
  metadata?: Record<string, unknown> | null;
  req?: Request;
}

export async function recordIdentityFailure(
  input: RecordFailureInput,
): Promise<void> {
  try {
    await db.insert(identityValidationFailuresTable).values({
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      actorRole: input.actor.role ?? null,
      projectId: input.projectId ?? null,
      partnerId: input.partnerId ?? null,
      personMasterId: input.personMasterId ?? null,
      attemptedAction: input.action,
      failureCode: input.failure.code,
      rejectionReason: input.failure.reason,
      targetTable: input.targetTable ?? null,
      targetRecordId: input.targetRecordId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
  } catch (err) {
    logger.warn(
      { err, action: input.action, code: input.failure.code },
      "Failed to record identity_validation_failures audit row",
    );
  }
  if (input.req) {
    input.req.log.warn(
      {
        action: input.action,
        code: input.failure.code,
        projectId: input.projectId ?? null,
        partnerId: input.partnerId ?? null,
      },
      "Partner identity validation failed",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level assertion (returns Express-ready 422 body on failure)
// ─────────────────────────────────────────────────────────────────────────────

export interface AssertPartnerIdentityInput {
  partnerId: string | null | undefined;
  action: PartnerIdentityAction;
  actor: PartnerIdentityActor;
  projectId?: string | null;
  req?: Request;
  targetTable?: string | null;
  targetRecordId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AssertOk {
  ok: true;
  partner: typeof partnersTable.$inferSelect;
}

export interface AssertBlock {
  ok: false;
  status: 422;
  body: {
    error: string;
    code: "IDENTITY_INVALID";
    failureCode: PartnerIdentityFailureCode;
    partnerId: string | null;
  };
}

export type AssertResult = AssertOk | AssertBlock;

export async function assertPartnerIdentityValid(
  input: AssertPartnerIdentityInput,
): Promise<AssertResult> {
  const result = await validatePartnerIdentity(input.partnerId);
  if (result.ok) {
    return { ok: true, partner: result.partner };
  }

  await recordIdentityFailure({
    action: input.action,
    failure: result,
    actor: input.actor,
    projectId: input.projectId,
    partnerId: input.partnerId ?? null,
    targetTable: input.targetTable ?? null,
    targetRecordId: input.targetRecordId ?? null,
    metadata: input.metadata ?? null,
    req: input.req,
  });

  return {
    ok: false,
    status: 422,
    body: {
      error: result.reason,
      code: "IDENTITY_INVALID",
      failureCode: result.code,
      partnerId: input.partnerId ?? null,
    },
  };
}

/**
 * Contributor-identity validator: contributions store the contributor as a
 * project_participants.id in the `partnerId` column (legacy naming). This
 * helper resolves the participant, requires its personMasterId, asserts the
 * person is active, and asserts at least one active non-deleted partner row
 * is linked to that person — i.e. the full attribution chain is intact.
 */
export async function validateContributorIdentity(opts: {
  projectId: string;
  participantId: string | null | undefined;
}): Promise<PartnerIdentityResult> {
  if (!opts.participantId || typeof opts.participantId !== "string") {
    return { ok: false, code: "PARTNER_ID_MISSING", reason: REASONS.PARTNER_ID_MISSING };
  }
  const [participant] = await db
    .select({
      id: projectParticipantsTable.id,
      personMasterId: projectParticipantsTable.personMasterId,
    })
    .from(projectParticipantsTable)
    .where(
      and(
        eq(projectParticipantsTable.id, opts.participantId),
        eq(projectParticipantsTable.projectId, opts.projectId),
      ),
    )
    .limit(1);
  if (!participant) {
    return {
      ok: false,
      code: "PARTNER_NOT_FOUND",
      reason: "Contributor participant row not found in this project.",
    };
  }
  if (!participant.personMasterId) {
    return {
      ok: false,
      code: "PARTNER_PERSON_LINK_MISSING",
      reason: REASONS.PARTNER_PERSON_LINK_MISSING,
    };
  }
  const personCheck = await validatePersonMasterActive(participant.personMasterId);
  if (!personCheck.ok) return personCheck;

  const [linkedPartner] = await db
    .select()
    .from(partnersTable)
    .where(
      and(
        eq(partnersTable.personMasterId, participant.personMasterId),
        eq(partnersTable.isActive, true),
        isNull(partnersTable.deletedAt),
      ),
    )
    .limit(1);
  if (!linkedPartner) {
    return {
      ok: false,
      code: "PARTNER_NOT_FOUND",
      reason:
        "No active partner record is linked to this contributor's Person Registry entry.",
    };
  }
  return { ok: true, partner: linkedPartner, personMasterId: participant.personMasterId };
}

export async function assertContributorIdentityValid(input: {
  projectId: string;
  participantId: string | null | undefined;
  action: PartnerIdentityAction;
  actor: PartnerIdentityActor;
  req?: Request;
  targetTable?: string | null;
  targetRecordId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<AssertResult> {
  const result = await validateContributorIdentity({
    projectId: input.projectId,
    participantId: input.participantId,
  });
  if (result.ok) return { ok: true, partner: result.partner };

  await recordIdentityFailure({
    action: input.action,
    failure: result,
    actor: input.actor,
    projectId: input.projectId,
    partnerId: input.participantId ?? null,
    targetTable: input.targetTable ?? null,
    targetRecordId: input.targetRecordId ?? null,
    metadata: input.metadata ?? null,
    req: input.req,
  });
  return {
    ok: false,
    status: 422,
    body: {
      error: result.reason,
      code: "IDENTITY_INVALID",
      failureCode: result.code,
      partnerId: input.participantId ?? null,
    },
  };
}

/**
 * Variant for partner.create / partner.patch where we are validating a
 * personMasterId directly (no partner row yet).
 */
export interface AssertPersonInput {
  personMasterId: string | null | undefined;
  action: PartnerIdentityAction;
  actor: PartnerIdentityActor;
  req?: Request;
  targetTable?: string | null;
  targetRecordId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function assertPersonMasterActive(
  input: AssertPersonInput,
): Promise<AssertResult> {
  const result = await validatePersonMasterActive(input.personMasterId);
  if (result.ok) {
    // Returning an empty partner-shaped object would be incorrect — callers of
    // this variant only need the ok signal. Build a typed Ok without a partner
    // by overloading: callers ignore .partner.
    return { ok: true, partner: undefined as unknown as typeof partnersTable.$inferSelect };
  }
  await recordIdentityFailure({
    action: input.action,
    failure: result,
    actor: input.actor,
    personMasterId: input.personMasterId ?? null,
    targetTable: input.targetTable ?? null,
    targetRecordId: input.targetRecordId ?? null,
    metadata: input.metadata ?? null,
    req: input.req,
  });
  return {
    ok: false,
    status: 422,
    body: {
      error: result.reason,
      code: "IDENTITY_INVALID",
      failureCode: result.code,
      partnerId: null,
    },
  };
}

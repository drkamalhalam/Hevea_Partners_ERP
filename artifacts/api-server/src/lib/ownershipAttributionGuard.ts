/**
 * ownershipAttributionGuard.ts
 *
 * Validates an entire batch of ownership-affecting contribution rows (or
 * snapshot entries) against the partner-identity chain:
 *
 *   contribution.partnerId
 *     → partners (exists, isActive, not soft-deleted, has personMasterId)
 *       → person_master (exists, status = 'active')
 *
 * Used by:
 *   - ownership snapshot creation (manual, maturity, backfill)
 *   - live ownership computation (excludes invalid rows from aggregation)
 *
 * Behaviour:
 *   - `partitionOwnershipRows` is a pure validator: returns {valid, invalid}.
 *   - `assertOwnershipAttributionValid` validates, writes one audit row per
 *     distinct (partnerId, failureCode) pair on failure, and returns an
 *     Express-ready 422 body. Use this on snapshot/crystallization paths.
 *   - `filterAndAuditOwnershipRows` validates, audits invalid rows, and
 *     returns the valid subset. Use this on the live computation path where
 *     blocking would break ownership reads but silent inclusion is forbidden.
 *
 * This module never mutates ownership math, snapshots, or history.
 */

import type { Request } from "express";
import { inArray, sql } from "drizzle-orm";
import {
  db,
  partnersTable,
  personMasterTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  recordIdentityFailure,
  type PartnerIdentityAction,
  type PartnerIdentityActor,
  type PartnerIdentityFailureCode,
} from "./partnerIdentityGuard";

/**
 * Idempotently install the partial CHECK constraint that guarantees every
 * live, ownership-affecting contribution row carries a non-null partnerId.
 *
 * Applied with `NOT VALID` so existing rows (which may have legacy NULLs)
 * are NOT scanned/rejected at install time, but every subsequent INSERT and
 * every UPDATE that re-evaluates the constrained columns is checked.
 *
 * Per governance: "Legacy rows remain unchanged. No migration."
 */
export async function ensureOwnershipAttributionConstraint(): Promise<void> {
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'contributions_ownership_attribution_not_null'
        ) THEN
          ALTER TABLE contributions
            ADD CONSTRAINT contributions_ownership_attribution_not_null
            CHECK (
              NOT (
                affects_ownership = true
                AND is_active = true
                AND deleted_at IS NULL
                AND partner_id IS NULL
              )
            )
            NOT VALID;
        END IF;
      END
      $$;
    `);
    logger.info(
      "Ownership attribution CHECK constraint ensured (NOT VALID — legacy rows preserved).",
    );
  } catch (err) {
    logger.error(
      { err },
      "Failed to install ownership_attribution_not_null CHECK constraint",
    );
  }
}

export interface OwnershipContribRow {
  partnerId: string | null;
  partnerName: string;
  contributionId?: string | null;
  amount?: number;
  contributionType?: string;
}

export interface AttributionInvalid {
  partnerId: string | null;
  partnerName: string;
  failureCode: PartnerIdentityFailureCode;
  reason: string;
}

export interface AttributionPartition<T extends OwnershipContribRow> {
  valid: T[];
  invalid: { row: T; reason: AttributionInvalid }[];
}

const REASONS: Record<PartnerIdentityFailureCode, string> = {
  PARTNER_ID_MISSING:
    "Ownership row has no partnerId — orphan attribution is not allowed.",
  PARTNER_NOT_FOUND:
    "Referenced partner does not exist in the partners registry.",
  PARTNER_DELETED:
    "Referenced partner is soft-deleted and cannot participate in ownership.",
  PARTNER_INACTIVE:
    "Referenced partner is inactive and cannot participate in ownership.",
  PARTNER_PERSON_LINK_MISSING:
    "Referenced partner is not linked to a Person Registry entry.",
  PERSON_MASTER_ID_MISSING:
    "Referenced partner is not linked to a Person Registry entry.",
  PERSON_MASTER_NOT_FOUND:
    "Referenced person_master row does not exist.",
  PERSON_MASTER_INACTIVE:
    "Referenced person is not active (status must be 'active').",
};

/**
 * Pure batch validator. No DB writes, no audit. Returns the partition.
 */
export async function partitionOwnershipRows<T extends OwnershipContribRow>(
  rows: T[],
): Promise<AttributionPartition<T>> {
  const partnerIds = Array.from(
    new Set(rows.map((r) => r.partnerId).filter((p): p is string => !!p)),
  );

  const partnerRows = partnerIds.length
    ? await db
        .select({
          id: partnersTable.id,
          isActive: partnersTable.isActive,
          deletedAt: partnersTable.deletedAt,
          personMasterId: partnersTable.personMasterId,
        })
        .from(partnersTable)
        .where(inArray(partnersTable.id, partnerIds))
    : [];
  const partnersById = new Map(partnerRows.map((p) => [p.id, p]));

  const personIds = Array.from(
    new Set(
      partnerRows
        .map((p) => p.personMasterId)
        .filter((p): p is string => !!p),
    ),
  );
  const personRows = personIds.length
    ? await db
        .select({
          id: personMasterTable.id,
          status: personMasterTable.status,
        })
        .from(personMasterTable)
        .where(inArray(personMasterTable.id, personIds))
    : [];
  const personById = new Map(personRows.map((p) => [p.id, p]));

  const valid: T[] = [];
  const invalid: { row: T; reason: AttributionInvalid }[] = [];

  for (const row of rows) {
    const fail = (code: PartnerIdentityFailureCode) =>
      invalid.push({
        row,
        reason: {
          partnerId: row.partnerId ?? null,
          partnerName: row.partnerName,
          failureCode: code,
          reason: REASONS[code],
        },
      });

    if (!row.partnerId) {
      fail("PARTNER_ID_MISSING");
      continue;
    }
    const p = partnersById.get(row.partnerId);
    if (!p) {
      fail("PARTNER_NOT_FOUND");
      continue;
    }
    if (p.deletedAt) {
      fail("PARTNER_DELETED");
      continue;
    }
    if (!p.isActive) {
      fail("PARTNER_INACTIVE");
      continue;
    }
    if (!p.personMasterId) {
      fail("PARTNER_PERSON_LINK_MISSING");
      continue;
    }
    const person = personById.get(p.personMasterId);
    if (!person) {
      fail("PERSON_MASTER_NOT_FOUND");
      continue;
    }
    if (person.status !== "active") {
      fail("PERSON_MASTER_INACTIVE");
      continue;
    }
    valid.push(row);
  }

  return { valid, invalid };
}

export interface AttributionAssertInput<T extends OwnershipContribRow> {
  rows: T[];
  projectId: string;
  action: PartnerIdentityAction;
  actor: PartnerIdentityActor;
  req?: Request;
  targetTable?: string | null;
  targetRecordId?: string | null;
}

export type AttributionAssertResult<T extends OwnershipContribRow> =
  | { ok: true; valid: T[] }
  | {
      ok: false;
      status: 422;
      body: {
        error: string;
        code: "OWNERSHIP_ATTRIBUTION_INVALID";
        invalid: AttributionInvalid[];
      };
    };

async function auditInvalid<T extends OwnershipContribRow>(
  invalid: { row: T; reason: AttributionInvalid }[],
  opts: Omit<AttributionAssertInput<T>, "rows">,
): Promise<void> {
  const seen = new Set<string>();
  for (const { row, reason } of invalid) {
    const key = `${row.partnerId ?? "null"}|${reason.failureCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await recordIdentityFailure({
      action: opts.action,
      failure: {
        ok: false,
        code: reason.failureCode,
        reason: reason.reason,
      },
      actor: opts.actor,
      projectId: opts.projectId,
      partnerId: row.partnerId ?? null,
      personMasterId: null,
      targetTable: opts.targetTable ?? null,
      targetRecordId: opts.targetRecordId ?? null,
      metadata: { partnerName: row.partnerName, batchScope: "ownership" },
      req: opts.req,
    });
  }
}

/**
 * Asserts every row is attribution-valid. On failure, writes one audit row
 * per distinct (partnerId, failureCode), returns 422-ready body.
 *
 * Use for snapshot/crystallization paths where invalid identities must block.
 */
export async function assertOwnershipAttributionValid<
  T extends OwnershipContribRow,
>(opts: AttributionAssertInput<T>): Promise<AttributionAssertResult<T>> {
  const part = await partitionOwnershipRows(opts.rows);
  if (part.invalid.length === 0) {
    return { ok: true, valid: part.valid };
  }

  await auditInvalid(part.invalid, opts);

  return {
    ok: false,
    status: 422,
    body: {
      error: `Ownership attribution rejected: ${part.invalid.length} contribution row(s) reference invalid partner identities. Resolve via Data Health before retrying.`,
      code: "OWNERSHIP_ATTRIBUTION_INVALID",
      invalid: part.invalid.map((i) => i.reason),
    },
  };
}

/**
 * Filters rows to the valid subset and records audit entries for invalid
 * rows. Use for the live ownership-compute read path so aggregation never
 * silently includes orphan attribution.
 */
export async function filterAndAuditOwnershipRows<
  T extends OwnershipContribRow,
>(opts: AttributionAssertInput<T>): Promise<{
  valid: T[];
  invalid: AttributionInvalid[];
}> {
  const part = await partitionOwnershipRows(opts.rows);
  if (part.invalid.length > 0) {
    await auditInvalid(part.invalid, opts);
  }
  return {
    valid: part.valid,
    invalid: part.invalid.map((i) => i.reason),
  };
}

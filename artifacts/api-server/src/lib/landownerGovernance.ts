/**
 * landownerGovernance.ts
 *
 * Utility functions that validate and apply landowner governance status to a
 * project.  Called automatically when landowner participant records change and
 * exposed via REST endpoints for admin-triggered re-validation and bulk scans.
 *
 * Rule: Every project MUST have at least one landowner participant record with
 * a non-empty fullName before it can be considered operationally valid.
 */

import { db, projectsTable, projectParticipantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Logger } from "pino";

// ── Types ──────────────────────────────────────────────────────────────────────

export type GovernanceValidationResult = {
  valid: boolean;
  configurationStatus:
    | "VALID"
    | "INVALID_PROJECT_CONFIGURATION"
    | "PENDING_REMEDIATION"
    | "UNDER_REVIEW";
  landownerValidationStatus: "VALIDATED" | "MISSING" | "BROKEN_LINKAGE" | "INVALID" | "PENDING";
  invalidReason: string | null;
};

export type GovernanceScanSummary = {
  total: number;
  valid: number;
  invalid: number;
  alreadyLocked: number;
  restored: number;
};

// ── Core validation (read-only) ────────────────────────────────────────────────

/**
 * Compute the governance validity of a project without mutating anything.
 * Returns a GovernanceValidationResult describing the current state.
 */
export async function validateLandownerGovernance(
  projectId: string,
): Promise<GovernanceValidationResult> {
  const [landowner] = await db
    .select({
      id: projectParticipantsTable.id,
      fullName: projectParticipantsTable.fullName,
    })
    .from(projectParticipantsTable)
    .where(
      and(
        eq(projectParticipantsTable.projectId, projectId),
        eq(projectParticipantsTable.role, "landowner"),
      ),
    )
    .limit(1);

  if (!landowner) {
    return {
      valid: false,
      configurationStatus: "INVALID_PROJECT_CONFIGURATION",
      landownerValidationStatus: "MISSING",
      invalidReason: "MISSING_LANDOWNER",
    };
  }

  if (!landowner.fullName || landowner.fullName.trim() === "") {
    return {
      valid: false,
      configurationStatus: "INVALID_PROJECT_CONFIGURATION",
      landownerValidationStatus: "INVALID",
      invalidReason: "MISSING_LANDOWNER",
    };
  }

  return {
    valid: true,
    configurationStatus: "VALID",
    landownerValidationStatus: "VALIDATED",
    invalidReason: null,
  };
}

// ── Persistent application (read + write) ─────────────────────────────────────

/**
 * Validate a project's landowner governance and persist the result.
 * Marks the project governance-locked if invalid, or restores it if valid.
 */
export async function applyGovernanceValidation(
  projectId: string,
  log: Logger,
): Promise<GovernanceValidationResult> {
  const result = await validateLandownerGovernance(projectId);

  await db
    .update(projectsTable)
    .set({
      configurationStatus: result.configurationStatus,
      landownerValidationStatus: result.landownerValidationStatus,
      invalidReason: result.invalidReason,
      governanceLocked: !result.valid,
      remediationRequired: !result.valid,
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, projectId));

  if (!result.valid) {
    log.warn(
      { projectId, invalidReason: result.invalidReason },
      "project governance invalidated: %s",
      result.invalidReason,
    );
  } else {
    log.info({ projectId }, "project governance validated: VALID");
  }

  return result;
}

// ── Bulk scan ─────────────────────────────────────────────────────────────────

/**
 * Scan every project in the database and apply governance validation to each.
 * Returns a summary of how many projects were affected.
 */
export async function scanAllProjectGovernance(
  log: Logger,
): Promise<GovernanceScanSummary> {
  const projects = await db
    .select({
      id: projectsTable.id,
      governanceLocked: projectsTable.governanceLocked,
    })
    .from(projectsTable)
    .where(eq(projectsTable.isActive, true));

  let valid = 0;
  let invalid = 0;
  let alreadyLocked = 0;
  let restored = 0;

  for (const project of projects) {
    const result = await applyGovernanceValidation(project.id, log);
    if (result.valid) {
      valid++;
      if (project.governanceLocked) restored++;
    } else {
      invalid++;
      if (project.governanceLocked) alreadyLocked++;
    }
  }

  log.info(
    { total: projects.length, valid, invalid, alreadyLocked, restored },
    "governance scan complete",
  );

  return { total: projects.length, valid, invalid, alreadyLocked, restored };
}

// ── Fast lock-check (for operation routes) ────────────────────────────────────

/**
 * Returns true if the project's governance_locked flag is set.
 * Designed for ultra-low overhead — fetches only one boolean column.
 */
export async function isProjectGovernanceLocked(projectId: string): Promise<boolean> {
  const [row] = await db
    .select({
      governanceLocked: projectsTable.governanceLocked,
      configurationStatus: projectsTable.configurationStatus,
      invalidReason: projectsTable.invalidReason,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!row) return false; // Project not found — let the route handler produce the 404
  return row.governanceLocked ?? false;
}

/**
 * Convenience helper: throws a serialisable governance-lock error payload
 * suitable for returning as HTTP 423 from any route handler.
 */
export async function assertGovernanceUnlocked(
  projectId: string,
  actorRole?: string,
): Promise<void> {
  // Admins and developers may bypass the lock to perform repair operations
  if (actorRole === "admin" || actorRole === "developer") return;

  const [row] = await db
    .select({
      governanceLocked: projectsTable.governanceLocked,
      configurationStatus: projectsTable.configurationStatus,
      invalidReason: projectsTable.invalidReason,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (row?.governanceLocked) {
    const err = Object.assign(new Error("GOVERNANCE_LOCKED"), {
      status: 423,
      code: "GOVERNANCE_LOCKED",
      configurationStatus: row.configurationStatus,
      invalidReason: row.invalidReason,
    });
    throw err;
  }
}

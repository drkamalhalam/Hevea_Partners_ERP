/**
 * ownershipGuard.ts
 *
 * Centralized enforcement for ownership-affecting mutations.
 *
 * Blocks an action and records a blocked-attempt audit row when ANY of:
 *   - the project carries an active project_ownership_freezes row
 *     (status frozen | transfer_pending | inheritance_pending), AND the
 *     action is ownership-affecting; OR
 *   - the project's lifecycleStatus is `mature_production` and the action is
 *     ownership-affecting; OR
 *   - the project's lifecycleStatus is `closed` and the action is
 *     ownership-affecting.
 *
 * Callers MUST treat `affectsOwnership: false` actions as out of scope —
 * non-equity entries (operational_cost, reimbursable manual adjustments) are
 * permitted under all lifecycle states.
 *
 * Does NOT mutate ownership math, snapshots, or transfer/inheritance history.
 */

import type { Request } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  projectsTable,
  projectOwnershipFreezesTable,
  ownershipLockAttemptsTable,
} from "@workspace/db";
import { logger } from "./logger";

export type OwnershipMutationAction =
  | "contribution.create"
  | "contribution.patch"
  | "contribution.delete"
  | "contribution.verify"
  | "contribution.reject"
  | "contribution.dispute"
  | "contribution.dispute_re_verify"
  | "landowner_ledger.create"
  | "ownership.manual_snapshot";

export interface OwnershipGuardActor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface OwnershipGuardInput {
  projectId: string;
  action: OwnershipMutationAction;
  affectsOwnership: boolean;
  actor: OwnershipGuardActor;
  req?: Request;
  targetTable?: string;
  targetRecordId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OwnershipGuardOk {
  ok: true;
  lifecycleStatus: string;
  freezeStatus: string | null;
}

export interface OwnershipGuardBlock {
  ok: false;
  status: number;
  body: {
    error: string;
    code: "OWNERSHIP_LOCKED";
    reason:
      | "freeze_active"
      | "mature_production"
      | "closed_project"
      | "project_not_found";
    lifecycleStatus: string;
    freezeStatus: string | null;
  };
}

export type OwnershipGuardResult = OwnershipGuardOk | OwnershipGuardBlock;

const MSG_FREEZE =
  "Ownership is currently frozen. Ownership-affecting changes are not permitted.";
const MSG_MATURE =
  "This project is in mature production. Ownership-affecting changes are not permitted — use post-maturity payments, LCA, settlement, transfer, or inheritance workflows instead.";
const MSG_CLOSED =
  "This project is closed. No ownership-affecting changes are permitted. Inheritance and transfer history remain viewable for audit only.";
const MSG_NOT_FOUND = "Project not found.";

async function recordBlockedAttempt(
  input: OwnershipGuardInput,
  block: OwnershipGuardBlock,
): Promise<void> {
  try {
    await db.insert(ownershipLockAttemptsTable).values({
      projectId: input.projectId,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      actorRole: input.actor.role ?? null,
      attemptedAction: input.action,
      lifecycleStatus: block.body.lifecycleStatus,
      freezeStatus: block.body.freezeStatus,
      rejectionReason: block.body.error,
      errorCode: block.body.code,
      targetTable: input.targetTable ?? null,
      targetRecordId: input.targetRecordId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
  } catch (err) {
    logger.warn(
      { err, projectId: input.projectId, action: input.action },
      "Failed to record ownership-lock-attempt audit row",
    );
  }
}

export async function assertOwnershipMutationAllowed(
  input: OwnershipGuardInput,
): Promise<OwnershipGuardResult> {
  // Non-equity actions are always allowed; skip DB roundtrip.
  if (!input.affectsOwnership) {
    return { ok: true, lifecycleStatus: "n/a", freezeStatus: null };
  }

  const [project] = await db
    .select({ lifecycleStatus: projectsTable.lifecycleStatus })
    .from(projectsTable)
    .where(eq(projectsTable.id, input.projectId))
    .limit(1);

  if (!project) {
    const block: OwnershipGuardBlock = {
      ok: false,
      status: 404,
      body: {
        error: MSG_NOT_FOUND,
        code: "OWNERSHIP_LOCKED",
        reason: "project_not_found",
        lifecycleStatus: "unknown",
        freezeStatus: null,
      },
    };
    return block;
  }

  const lifecycleStatus = String(project.lifecycleStatus ?? "prematurity");

  const [freeze] = await db
    .select({ status: projectOwnershipFreezesTable.status })
    .from(projectOwnershipFreezesTable)
    .where(eq(projectOwnershipFreezesTable.projectId, input.projectId))
    .limit(1);
  const freezeStatus = freeze ? String(freeze.status) : null;

  // Order matters for the most descriptive error: closed > freeze > mature.
  if (lifecycleStatus === "closed") {
    const block: OwnershipGuardBlock = {
      ok: false,
      status: 423,
      body: {
        error: MSG_CLOSED,
        code: "OWNERSHIP_LOCKED",
        reason: "closed_project",
        lifecycleStatus,
        freezeStatus,
      },
    };
    if (input.req) input.req.log.warn({ action: input.action, projectId: input.projectId, reason: "closed_project" }, "Ownership mutation blocked");
    await recordBlockedAttempt(input, block);
    return block;
  }

  if (freezeStatus) {
    const block: OwnershipGuardBlock = {
      ok: false,
      status: 423,
      body: {
        error: MSG_FREEZE,
        code: "OWNERSHIP_LOCKED",
        reason: "freeze_active",
        lifecycleStatus,
        freezeStatus,
      },
    };
    if (input.req) input.req.log.warn({ action: input.action, projectId: input.projectId, freezeStatus }, "Ownership mutation blocked");
    await recordBlockedAttempt(input, block);
    return block;
  }

  if (lifecycleStatus === "mature_production") {
    const block: OwnershipGuardBlock = {
      ok: false,
      status: 423,
      body: {
        error: MSG_MATURE,
        code: "OWNERSHIP_LOCKED",
        reason: "mature_production",
        lifecycleStatus,
        freezeStatus,
      },
    };
    if (input.req) input.req.log.warn({ action: input.action, projectId: input.projectId, reason: "mature_production" }, "Ownership mutation blocked");
    await recordBlockedAttempt(input, block);
    return block;
  }

  return { ok: true, lifecycleStatus, freezeStatus };
}

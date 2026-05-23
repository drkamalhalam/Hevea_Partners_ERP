/**
 * projectAuditLogger — fire-and-forget helper for writing rows to the
 * unified `project_audit_trail` table.
 *
 * Intentionally tolerant: failures are logged but never thrown back into the
 * caller, mirroring the conventions used by `writeAudit` / `writeTimeline`.
 */

import type { Request } from "express";
import { db, projectAuditTrailTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type ProjectAuditEvent =
  | "project_created"
  | "project_field_changed"
  | "commercial_model_changed"
  | "project_type_changed"
  | "project_code_assigned"
  | "agreement_template_assigned"
  | "agreement_template_changed"
  | "agreement_template_cleared"
  | "parcel_added"
  | "parcel_updated"
  | "parcel_removed"
  | "participant_added"
  | "participant_role_changed"
  | "participant_removed"
  | "witness_added"
  | "witness_updated"
  | "witness_removed"
  | "activation_requested"
  | "ready_for_activation"
  | "activated"
  | "suspended"
  | "closed"
  | "note";

export interface ProjectAuditPayload {
  projectId: string;
  eventType: ProjectAuditEvent;
  entityType: string;
  entityId?: string | null;
  title: string;
  description?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  reason?: string | null;
  governanceOverrideId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
}

export async function resolveActor(req: Request) {
  if (!req.userId) return null;
  const [u] = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, req.userId))
    .limit(1);
  return u ?? null;
}

/**
 * Write a single audit-trail row. Errors are logged and swallowed so the
 * caller's primary write path is never blocked by audit failures.
 */
export async function writeProjectAudit(
  req: Request,
  payload: ProjectAuditPayload,
): Promise<void> {
  try {
    const actor = await resolveActor(req);
    await db.insert(projectAuditTrailTable).values({
      projectId: payload.projectId,
      eventType: payload.eventType,
      entityType: payload.entityType,
      entityId: payload.entityId ?? null,
      title: payload.title,
      description: payload.description ?? null,
      beforeData: payload.beforeData ?? null,
      afterData: payload.afterData ?? null,
      reason: payload.reason ?? null,
      governanceOverrideId: payload.governanceOverrideId ?? null,
      actorId: actor?.id ?? null,
      actorName: actor?.displayName ?? null,
      actorRole: actor?.role ?? null,
      metadata: payload.metadata ?? null,
      occurredAt: payload.occurredAt ?? new Date(),
    });
  } catch (err) {
    req.log.error({ err, payload }, "Failed to write project audit trail row");
  }
}

/**
 * Diff helper: return an object containing only the keys whose value
 * changed between `before` and `after`. Useful for compact field-change rows.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T>; changedKeys: string[] } {
  const beforeOut: Partial<T> = {};
  const afterOut: Partial<T> = {};
  const changed: string[] = [];
  for (const key of Object.keys(after) as (keyof T)[]) {
    const a = after[key];
    const b = before[key];
    if (a !== undefined && a !== b) {
      beforeOut[key] = b as T[keyof T];
      afterOut[key] = a as T[keyof T];
      changed.push(String(key));
    }
  }
  return { before: beforeOut, after: afterOut, changedKeys: changed };
}

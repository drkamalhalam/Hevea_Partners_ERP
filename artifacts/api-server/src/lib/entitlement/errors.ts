/**
 * entitlement/errors.ts
 *
 * V3 Wave 3 — Typed errors for the entitlement-resolution engine. Each error
 * carries enough context (projectId, partnerId, batchId, sums) to make the
 * audit dashboard (Wave 9) and operational logs actionable without forcing
 * callers to re-derive state.
 *
 * Errors must NEVER be caught and silently swallowed by the revenue handler.
 * They surface to processOne, which marks the event as failed and leaves the
 * sale_event_journal row available for a later admin reprocess.
 */

export type EntitlementErrorCode =
  | "OWNERSHIP_DRIFT"
  | "NO_SNAPSHOT"
  | "TRANSFER_CHAIN_INCONSISTENT"
  | "BATCH_NOT_FOUND"
  | "SALE_NOT_FOUND"
  | "AMOUNT_MISMATCH";

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;
  readonly context: Record<string, unknown>;

  constructor(
    code: EntitlementErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "EntitlementError";
    this.code = code;
    this.context = context;
  }
}

export class OwnershipDriftError extends EntitlementError {
  constructor(
    snapshotIdOrChain: string,
    sum: number,
    context: Record<string, unknown> = {},
  ) {
    super(
      "OWNERSHIP_DRIFT",
      `Ownership shares drift detected (snapshot/chain=${snapshotIdOrChain}, sum=${sum})`,
      { snapshotIdOrChain, sum, ...context },
    );
  }
}

export class NoSnapshotError extends EntitlementError {
  constructor(projectId: string, atIso: string) {
    super(
      "NO_SNAPSHOT",
      `No ownership snapshot available for project ${projectId} at or before ${atIso}`,
      { projectId, at: atIso },
    );
  }
}

/**
 * saleAuditHelper — fire-and-forget audit event writer for sales transactions.
 *
 * Risk levels:
 *   normal  — routine create/confirm/cancel
 *   watch   — rate change ≥ 15 %, quantity change ≥ 20 %, deduction ≥ 25 % of gross
 *   flag    — edit on confirmed sale, rate change ≥ 30 %, quantity change ≥ 40 %
 *
 * All writes are non-blocking (fire-and-forget). Errors are swallowed so that
 * audit failures never break a user-facing transaction.
 */

import { db, saleAuditEventsTable } from "@workspace/db";

export type FieldChange = {
  field: string;
  oldValue: string | number | null;
  newValue: string | number | null;
};

export type SaleAuditEventInput = {
  transactionId: string;
  saleNumber: string;
  projectId: string;
  eventType: string;
  entityType: "transaction" | "line_item" | "deduction" | "document";
  entityId?: string;
  description: string;
  fieldChanges?: FieldChange[];
  riskLevel?: "normal" | "watch" | "flag";
  riskReason?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
};

/** Non-blocking audit write. Errors are logged but never thrown. */
export function writeSaleAudit(event: SaleAuditEventInput): void {
  db.insert(saleAuditEventsTable)
    .values({
      transactionId: event.transactionId,
      saleNumber: event.saleNumber,
      projectId: event.projectId,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      description: event.description,
      fieldChanges: event.fieldChanges ? JSON.parse(JSON.stringify(event.fieldChanges)) : null,
      riskLevel: event.riskLevel ?? "normal",
      riskReason: event.riskReason ?? null,
      actorId: event.actorId,
      actorName: event.actorName,
      actorRole: event.actorRole,
    })
    .catch((err: unknown) => {
      console.error("[saleAuditHelper] Failed to write audit event:", err);
    });
}

/**
 * Compute risk level for a line item rate or quantity change.
 * Returns { riskLevel, riskReason } — caller merges into audit event.
 */
export function assessLineItemRisk(
  oldQty: number | null,
  newQty: number | null,
  oldRate: number | null,
  newRate: number | null,
  isConfirmed: boolean,
): { riskLevel: "normal" | "watch" | "flag"; riskReason: string | undefined } {
  if (isConfirmed) {
    return { riskLevel: "flag", riskReason: "Edit on confirmed sale" };
  }

  const reasons: string[] = [];
  let level: "normal" | "watch" | "flag" = "normal";

  if (oldQty !== null && newQty !== null && oldQty > 0) {
    const pct = Math.abs(newQty - oldQty) / oldQty * 100;
    if (pct >= 40) {
      level = "flag";
      reasons.push(`Quantity changed by ${pct.toFixed(1)}% (≥40% threshold)`);
    } else if (pct >= 20) {
      if (level === "normal") level = "watch";
      reasons.push(`Quantity changed by ${pct.toFixed(1)}% (≥20% threshold)`);
    }
  }

  if (oldRate !== null && newRate !== null && oldRate > 0) {
    const pct = Math.abs(newRate - oldRate) / oldRate * 100;
    if (pct >= 30) {
      level = "flag";
      reasons.push(`Rate changed by ${pct.toFixed(1)}% (≥30% threshold)`);
    } else if (pct >= 15) {
      if (level === "normal") level = "watch";
      reasons.push(`Rate changed by ${pct.toFixed(1)}% (≥15% threshold)`);
    }
  }

  return {
    riskLevel: level,
    riskReason: reasons.length > 0 ? reasons.join("; ") : undefined,
  };
}

/**
 * Build a human-readable description for a line item update.
 */
export function describeLineItemChange(
  productType: string,
  oldQty: number | null,
  newQty: number | null,
  oldRate: number | null,
  newRate: number | null,
): string {
  const parts: string[] = [];
  if (oldQty !== newQty && oldQty !== null && newQty !== null) {
    const pct = oldQty > 0 ? ((newQty - oldQty) / oldQty * 100).toFixed(1) : "N/A";
    const dir = newQty > oldQty ? "increased" : "decreased";
    parts.push(`Quantity ${dir} from ${oldQty} to ${newQty} (${pct}%)`);
  }
  if (oldRate !== newRate && oldRate !== null && newRate !== null) {
    const pct = oldRate > 0 ? ((newRate - oldRate) / oldRate * 100).toFixed(1) : "N/A";
    const dir = newRate > oldRate ? "increased" : "decreased";
    parts.push(`Rate ${dir} from ₹${oldRate} to ₹${newRate} (${pct}%)`);
  }
  const base = `${productType} line item updated`;
  return parts.length > 0 ? `${base}: ${parts.join("; ")}` : base;
}

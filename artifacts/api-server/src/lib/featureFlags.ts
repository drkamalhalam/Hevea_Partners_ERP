/**
 * featureFlags.ts
 *
 * NPF Partner Financial Ledger V3 — feature-flag registry.
 *
 * Wave 1: registration ONLY. All flags default OFF. No code path consumes
 * them yet. Reading any flag here in Wave 1 should be considered observation
 * only (e.g., for a future debug endpoint).
 *
 * Each flag is sourced from a process env var of the same name. The accepted
 * truthy values are: "1", "true", "yes", "on" (case-insensitive). Anything
 * else (including unset) resolves to false.
 *
 * Wave-by-wave rollout (see V3 Section 10):
 *   Wave 2  → FIN_SALE_EVENT_EMISSION_ENABLED
 *   Wave 3  → FIN_REVENUE_ATTRIBUTION_ENABLED
 *   Wave 4  → FIN_LEDGER_ENABLED
 *   Wave 5  → FIN_COST_ALLOCATION_ENABLED
 *   Wave 6  → FIN_REIMBURSEMENT_ENABLED
 *   Wave 7  → FIN_DISTRIBUTION_LEDGER_ENABLED
 *   Wave 8  → FIN_CLOSURE_SNAPSHOT_ENABLED
 *   Wave 9  → FIN_DASHBOARD_USE_V3_VIEW
 *   Wave 10 → FIN_LANDOWNER_WRITES_DEPRECATED
 *   Backfill (optional) → FIN_LEDGER_BACKFILL_LEGACY_LANDOWNER
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function readFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return false;
  return TRUTHY.has(String(raw).trim().toLowerCase());
}

export const FIN_FLAG_NAMES = [
  "FIN_LEDGER_ENABLED",
  "FIN_SALE_EVENT_EMISSION_ENABLED",
  "FIN_REVENUE_ATTRIBUTION_ENABLED",
  "FIN_COST_ALLOCATION_ENABLED",
  "FIN_REIMBURSEMENT_ENABLED",
  "FIN_DISTRIBUTION_LEDGER_ENABLED",
  "FIN_CLOSURE_SNAPSHOT_ENABLED",
  "FIN_LANDOWNER_WRITES_DEPRECATED",
  "FIN_LEDGER_BACKFILL_LEGACY_LANDOWNER",
  "FIN_DASHBOARD_USE_V3_VIEW",
] as const;

export type FinFlagName = (typeof FIN_FLAG_NAMES)[number];

/**
 * Snapshot of all V3 finance flags at process startup. Read once; do not
 * mutate. Tests may import `readFlag` directly to re-read at call time.
 */
export const finFlags: Record<FinFlagName, boolean> = Object.freeze(
  FIN_FLAG_NAMES.reduce(
    (acc, name) => {
      acc[name] = readFlag(name);
      return acc;
    },
    {} as Record<FinFlagName, boolean>,
  ),
);

export function getFinFlag(name: FinFlagName): boolean {
  return finFlags[name];
}

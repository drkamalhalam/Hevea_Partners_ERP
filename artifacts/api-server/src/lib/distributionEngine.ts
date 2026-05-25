/**
 * distributionEngine.ts
 *
 * Model-aware financial distribution calculator.
 * Pure functions — no DB writes, no side effects.
 *
 * Two accounting models:
 *
 * 1. Contribution/Ownership Model
 *    Revenue − OpCost − LCA = Distributable Profit Pool
 *    Pool split by frozen ownership percentages per partner.
 *
 * 2. 50% Revenue Model
 *    Gross Revenue split first: Landowner Side | Economic Participant Pool
 *    Landowner side bears all operational costs.
 *    Economic participant pool is NEVER reduced by operational costs.
 */

import { toMoney } from "@workspace/db";
import type {
  ContributionDistributionResult,
  FiftyPercentDistributionResult,
  DistributionShareEntry,
} from "@workspace/db";
import type { OwnershipSnapshotEntry } from "@workspace/db";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContributionModelInputs {
  grossRevenue: number;
  operationalCost: number;
  lcaAmount: number;
  costsChargedBeforeDistribution: boolean;
  lcaChargedBeforeDistribution: boolean;
  lcaApplicable: boolean;
  /** Per-partner ownership breakdown */
  ownerShares: Array<{
    partnerKey: string;
    partnerId: string | null;
    partnerName: string;
    role?: "landowner" | "developer" | "unknown";
    percentage: number;
  }>;
  ownershipSource: ContributionDistributionResult["ownershipSource"];
  warnings?: string[];
}

export interface FiftyPercentModelInputs {
  grossRevenue: number;
  operationalCost: number;
  splitPctLandowner: number;
  splitPctDeveloper: number;
  warnings?: string[];
}

// ── Contribution model engine ──────────────────────────────────────────────

export function calculateContributionDistribution(
  inputs: ContributionModelInputs,
): ContributionDistributionResult {
  const {
    grossRevenue,
    operationalCost,
    lcaAmount,
    costsChargedBeforeDistribution,
    lcaChargedBeforeDistribution,
    lcaApplicable,
    ownerShares,
    ownershipSource,
    warnings = [],
  } = inputs;

  const effectiveCost = costsChargedBeforeDistribution ? operationalCost : 0;
  const effectiveLca = lcaApplicable && lcaChargedBeforeDistribution ? lcaAmount : 0;

  const distributablePool = Math.max(
    0,
    grossRevenue - effectiveCost - effectiveLca,
  );

  const resultShares: DistributionShareEntry[] = ownerShares.map((s) => ({
    partnerKey: s.partnerKey,
    partnerId: s.partnerId,
    partnerName: s.partnerName,
    role: s.role ?? "unknown",
    ownershipPct: round2(s.percentage),
    amount: round2((distributablePool * s.percentage) / 100),
  }));

  const landownerTotal = round2(
    resultShares
      .filter((s) => s.role === "landowner")
      .reduce((sum, s) => sum + s.amount, 0),
  );
  const developerTotal = round2(
    resultShares
      .filter((s) => s.role === "developer")
      .reduce((sum, s) => sum + s.amount, 0),
  );

  const computedWarnings = [...warnings];
  if (ownerShares.length === 0) {
    computedWarnings.push(
      "No ownership shares found — distribution totals will be zero. Add verified contributions or set agreement shares.",
    );
  }
  const totalPct = ownerShares.reduce((s, e) => s + e.percentage, 0);
  if (ownerShares.length > 0 && Math.abs(totalPct - 100) > 0.5) {
    computedWarnings.push(
      `Ownership shares sum to ${round2(totalPct)}% — should be 100%. Distribution amounts are proportional to stated percentages only.`,
    );
  }
  if (!costsChargedBeforeDistribution && operationalCost > 0) {
    computedWarnings.push(
      "Operational cost is NOT deducted from the pool (costsChargedBeforeDistribution=false). Cost is borne outside this calculation.",
    );
  }
  if (!lcaApplicable && lcaAmount > 0) {
    computedWarnings.push(
      "LCA is not applicable to this agreement — the entered LCA amount is ignored.",
    );
  }

  return {
    model: "contribution",
    grossRevenue: round2(grossRevenue),
    operationalCost: round2(operationalCost),
    lcaAmount: round2(lcaAmount),
    costsChargedBeforeDistribution,
    lcaChargedBeforeDistribution,
    distributablePool: round2(distributablePool),
    ownerShares: resultShares,
    landownerTotal,
    developerTotal,
    ownershipSource,
    warnings: computedWarnings,
  };
}

// ── 50% Revenue model engine ───────────────────────────────────────────────

export function calculateFiftyPercentDistribution(
  inputs: FiftyPercentModelInputs,
): FiftyPercentDistributionResult {
  const {
    grossRevenue,
    operationalCost,
    splitPctLandowner,
    splitPctDeveloper,
    warnings = [],
  } = inputs;

  const landownerGross = round2((grossRevenue * splitPctLandowner) / 100);
  const developerGross = round2((grossRevenue * splitPctDeveloper) / 100);

  // Landowner side bears ALL operational costs
  const landownerNet = round2(Math.max(0, landownerGross - operationalCost));

  // Economic participant pool (developer side) is NEVER reduced by operational costs
  const developerNet = round2(developerGross);
  const participantPoolGross = developerGross;
  const participantPoolNet = developerNet;

  const computedWarnings = [...warnings];
  const splitSum = splitPctLandowner + splitPctDeveloper;
  if (Math.abs(splitSum - 100) > 0.1) {
    computedWarnings.push(
      `Split percentages sum to ${round2(splitSum)}% — should be 100%. Check the accounting profile.`,
    );
  }
  if (operationalCost > landownerGross) {
    computedWarnings.push(
      `Operational cost (${fmt(operationalCost)}) exceeds the landowner's gross share (${fmt(landownerGross)}). Landowner net is floored at 0.`,
    );
  }

  return {
    model: "fifty_percent_revenue",
    grossRevenue: round2(grossRevenue),
    operationalCost: round2(operationalCost),
    splitPctLandowner: round2(splitPctLandowner),
    splitPctDeveloper: round2(splitPctDeveloper),
    landownerGross,
    developerGross,
    landownerNet,
    developerNet,
    participantPoolGross,
    participantPoolNet,
    note:
      "In the 50% Revenue model, operational costs are borne entirely by the Landowner Side. The Economic Participant Pool is never reduced by costs.",
    warnings: computedWarnings,
  };
}

// ── Ownership share builder helpers ───────────────────────────────────────

/**
 * Build ContributionModelInputs.ownerShares from an ownership snapshot
 * (the `entries` JSONB array from ownershipSnapshotsTable).
 * Roles are inferred: landowner if partnerName matches the agreement landowner,
 * developer if it matches the project developer. Otherwise "unknown".
 */
export function sharesFromSnapshot(
  entries: OwnershipSnapshotEntry[],
  landownerPartnerId?: string | null,
  developerPartnerId?: string | null,
): ContributionModelInputs["ownerShares"] {
  return entries.map((e) => {
    const isLandowner =
      landownerPartnerId && e.partnerId === landownerPartnerId;
    const isDeveloper =
      developerPartnerId && e.partnerId === developerPartnerId;
    return {
      partnerKey: e.partnerKey,
      partnerId: e.partnerId,
      partnerName: e.partnerName,
      role: isLandowner
        ? "landowner"
        : isDeveloper
          ? "developer"
          : "unknown",
      percentage: e.percentage,
    };
  });
}

/**
 * Build ownerShares from agreement ownership_share_landowner /
 * ownership_share_developer (two-party model).
 */
export function sharesFromAgreement(params: {
  landownerId: string;
  landownerName: string;
  landownerPct: number;
  developerId: string;
  developerName: string;
  developerPct: number;
}): ContributionModelInputs["ownerShares"] {
  return [
    {
      partnerKey: params.landownerId,
      partnerId: params.landownerId,
      partnerName: params.landownerName,
      role: "landowner",
      percentage: params.landownerPct,
    },
    {
      partnerKey: params.developerId,
      partnerId: params.developerId,
      partnerName: params.developerName,
      role: "developer",
      percentage: params.developerPct,
    },
  ];
}

// ── Utilities ──────────────────────────────────────────────────────────────

function round2(n: number): number {
  return toMoney(n).toDecimalPlaces(2).toNumber();
}

function fmt(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

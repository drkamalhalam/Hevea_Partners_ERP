/**
 * Unit tests for applyTransferEntitlements — the pure transfer-chain kernel
 * of resolveBatchEntitlement.
 *
 * Tests the five scenarios from WAVE3_ENTITLEMENT_CORRECTION_PLAN.md plus
 * edge cases and backward-compatibility checks.
 *
 * Uses node:test (built-in, zero-dependency). Run with:
 *   node --import tsx --test src/lib/entitlement/resolveBatchEntitlement.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Decimal from "decimal.js-light";
import {
  applyTransferEntitlements,
} from "./resolveBatchEntitlement.js";
import type { EntitlementEntry, TransferRecord } from "./resolveBatchEntitlement.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMap(
  entries: Record<string, { name: string; pct: string }>,
): Map<string, EntitlementEntry> {
  const map = new Map<string, EntitlementEntry>();
  for (const [partnerId, { name, pct }] of Object.entries(entries)) {
    map.set(partnerId, {
      partnerId,
      partnerName: name,
      percentage: new Decimal(pct),
    });
  }
  return map;
}

function tx(overrides: Partial<TransferRecord> & {
  transferorPartnerId: string;
  buyerPartnerId: string;
  offeredPercentage: string;
}): TransferRecord {
  return {
    buyerName: overrides.buyerPartnerId,
    stockEntitlementHandling: null,
    stockEntitlementKg: null,
    stockEntitlementRetainedKg: null,
    stockEntitlementTransferredKg: null,
    ...overrides,
  };
}

/** Assert that a partner's percentage in the map equals the expected string. */
function assertPct(
  map: Map<string, EntitlementEntry>,
  partnerId: string,
  expected: string,
  msg?: string,
): void {
  const entry = map.get(partnerId);
  assert.ok(entry, `${msg ?? ""} — partner ${partnerId} missing from map`);
  assert.equal(
    entry.percentage.toFixed(4),
    new Decimal(expected).toFixed(4),
    msg ?? `partner ${partnerId} percentage`,
  );
}

/** Assert that a partner is absent from the map. */
function assertAbsent(
  map: Map<string, EntitlementEntry>,
  partnerId: string,
  msg?: string,
): void {
  assert.equal(
    map.has(partnerId),
    false,
    msg ?? `partner ${partnerId} should be absent`,
  );
}

/** Sum all percentages in the map. */
function sumPct(map: Map<string, EntitlementEntry>): Decimal {
  return Array.from(map.values()).reduce(
    (acc, e) => acc.plus(e.percentage),
    new Decimal(0),
  );
}

// ── Scenario A — retain_with_seller, no KG fields ─────────────────────────
// Stock produced at T1 (A=60%, B=40%). Transfer A→C with retain_with_seller
// at T2. Sale at T3. Seller (A) must keep full 60% for this pre-transfer batch.

describe("Scenario A — retain_with_seller, no KG fields", () => {
  it("seller retains full entitlement — transfer is skipped", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
      }),
    ]);
    assertPct(map, "A", "60", "A retains full 60%");
    assertPct(map, "B", "40", "B unchanged");
    assertAbsent(map, "C", "C must not appear — retain_with_seller skipped");
    assert.equal(sumPct(map).toFixed(2), "100.00", "sum preserved");
  });

  it("sum of percentages stays at 100 after skip", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "70" },
      B: { name: "Bob",   pct: "30" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "30",
        stockEntitlementHandling: "retain_with_seller",
      }),
    ]);
    assert.equal(sumPct(map).toFixed(2), "100.00");
    assertAbsent(map, "C");
  });
});

// ── Scenario B — transfer_to_buyer, no KG fields ──────────────────────────
// Same setup as A but transfer_to_buyer. Buyer (C) receives pre-transfer
// batch revenue. Behavior is identical to pre-fix (backward-compatible).

describe("Scenario B — transfer_to_buyer, no KG fields", () => {
  it("buyer receives full offeredPercentage shift", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "transfer_to_buyer",
      }),
    ]);
    assertPct(map, "A", "40", "A loses 20%");
    assertPct(map, "B", "40", "B unchanged");
    assertPct(map, "C", "20", "C gains 20%");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });

  it("null handling behaves identically to transfer_to_buyer", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: null,
      }),
    ]);
    assertPct(map, "A", "40");
    assertPct(map, "C", "20");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });
});

// ── Scenario C — chain: A→B retain_with_seller, B→C retain_with_seller ────
// Snapshot: A=60%, B=30%, D=10%. Batch at T1.
// TX1 at T2: A→B pct=30% retain_with_seller  (post-TX1 live: A=30%, B=60%)
// TX2 at T3: B→C pct=40% retain_with_seller  (B had 60%, transfers 40%)
// Both skipped → final map must equal the original snapshot.

describe("Scenario C — double retain_with_seller chain", () => {
  it("both transfers skipped — map equals original snapshot", () => {
    const map = makeMap({
      A: { name: "Alice",  pct: "60" },
      B: { name: "Bob",    pct: "30" },
      D: { name: "Deepak", pct: "10" },
    });
    applyTransferEntitlements(map, [
      tx({ transferorPartnerId: "A", buyerPartnerId: "B", offeredPercentage: "30", stockEntitlementHandling: "retain_with_seller" }),
      tx({ transferorPartnerId: "B", buyerPartnerId: "C", offeredPercentage: "40", stockEntitlementHandling: "retain_with_seller" }),
    ]);
    assertPct(map, "A", "60");
    assertPct(map, "B", "30");
    assertPct(map, "D", "10");
    assertAbsent(map, "C", "C must not appear");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });

  it("second skip does not use inflated B balance from first (skipped) transfer", () => {
    // If TX1 were wrongly applied, B would be 60% and TX2 could shift 40%.
    // Verify B stays at 30% regardless.
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "30" },
      D: { name: "Dev",   pct: "10" },
    });
    applyTransferEntitlements(map, [
      tx({ transferorPartnerId: "A", buyerPartnerId: "B", offeredPercentage: "30", stockEntitlementHandling: "retain_with_seller" }),
      tx({ transferorPartnerId: "B", buyerPartnerId: "C", offeredPercentage: "40", stockEntitlementHandling: "retain_with_seller" }),
    ]);
    // B must stay at 30, not drop to 20 (which would happen if TX1 inflated B then TX2 drained it).
    assertPct(map, "B", "30");
  });
});

// ── Scenario D — mixed chain: A→B retain_with_seller, B→C transfer_to_buyer
// Snapshot: A=50%, B=40%, D=10%.
// TX1: A→B pct=20% retain_with_seller → skipped (A stays 50%, B stays 40%)
// TX2: B→C pct=30% transfer_to_buyer  → applied from B's original 40%
// Expected: A=50%, B=10%, C=30%, D=10%

describe("Scenario D — mixed chain: retain then transfer_to_buyer", () => {
  it("retain leg skipped; transfer_to_buyer leg applied from original balance", () => {
    const map = makeMap({
      A: { name: "Alice",  pct: "50" },
      B: { name: "Bob",    pct: "40" },
      D: { name: "Deepak", pct: "10" },
    });
    applyTransferEntitlements(map, [
      tx({ transferorPartnerId: "A", buyerPartnerId: "B", offeredPercentage: "20", stockEntitlementHandling: "retain_with_seller" }),
      tx({ transferorPartnerId: "B", buyerPartnerId: "C", offeredPercentage: "30", stockEntitlementHandling: "transfer_to_buyer" }),
    ]);
    assertPct(map, "A", "50",  "A retains full 50% (TX1 skipped)");
    assertPct(map, "B", "10",  "B: 40% − 30% = 10% (TX2 applied from original 40%)");
    assertPct(map, "C", "30",  "C gains 30% from transfer_to_buyer");
    assertPct(map, "D", "10",  "D unchanged");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });

  it("B does not receive A's 20% before losing 30% (order matters)", () => {
    // If TX1 were wrongly applied, B would be 60% and after TX2 would be 30%, not 10%.
    const map = makeMap({
      A: { name: "Alice", pct: "50" },
      B: { name: "Bob",   pct: "40" },
      D: { name: "Dev",   pct: "10" },
    });
    applyTransferEntitlements(map, [
      tx({ transferorPartnerId: "A", buyerPartnerId: "B", offeredPercentage: "20", stockEntitlementHandling: "retain_with_seller" }),
      tx({ transferorPartnerId: "B", buyerPartnerId: "C", offeredPercentage: "30", stockEntitlementHandling: "transfer_to_buyer" }),
    ]);
    assert.equal(
      map.get("B")?.percentage.toFixed(2),
      "10.00",
      "B must be 10%, not 30% (would be 30% if TX1 wrongly inflated B)",
    );
  });
});

// ── Scenario E — partial KG split with retain_with_seller ─────────────────
// Snapshot: A=60%, B=40%.
// TX: A→C pct=20% retain_with_seller
//     stockEntitlementKg=1000, stockEntitlementRetainedKg=600, stockEntitlementTransferredKg=400
// transferredFraction = 400/1000 = 0.40
// effectivePct = 20% × 0.40 = 8%
// Expected: A=52%, B=40%, C=8%

describe("Scenario E — partial KG split (retain_with_seller + KG fields)", () => {
  it("effectivePct = offeredPct × (transferredKg / totalKg)", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
        stockEntitlementKg: "1000",
        stockEntitlementRetainedKg: "600",
        stockEntitlementTransferredKg: "400",
      }),
    ]);
    // effectivePct = 20 × (400/1000) = 8
    assertPct(map, "A", "52",  "A: 60% − 8% = 52%");
    assertPct(map, "B", "40",  "B unchanged");
    assertPct(map, "C", "8",   "C: 0% + 8% = 8%");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });

  it("75% retained / 25% transferred splits correctly", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
        stockEntitlementKg: "800",
        stockEntitlementRetainedKg: "600",
        stockEntitlementTransferredKg: "200",
      }),
    ]);
    // effectivePct = 20 × (200/800) = 5
    assertPct(map, "A", "55",  "A: 60% − 5% = 55%");
    assertPct(map, "C", "5",   "C: 0% + 5% = 5%");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });

  it("100% transferred KG equals full transfer_to_buyer behavior", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
        stockEntitlementKg: "1000",
        stockEntitlementRetainedKg: "0",
        stockEntitlementTransferredKg: "1000",
      }),
    ]);
    // effectivePct = 20 × (1000/1000) = 20 — full transfer
    assertPct(map, "A", "40");
    assertPct(map, "C", "20");
  });

  it("0% transferred KG (all retained) equals full retain (skip)", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
        stockEntitlementKg: "1000",
        stockEntitlementRetainedKg: "1000",
        stockEntitlementTransferredKg: "0",
      }),
    ]);
    // effectivePct = 20 × (0/1000) = 0 — no shift
    assertPct(map, "A", "60");
    assertAbsent(map, "C");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("retain_with_seller with zero totalKg falls back to full retain (skip)", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
        stockEntitlementKg: "0",
        stockEntitlementTransferredKg: "400",
      }),
    ]);
    assertPct(map, "A", "60");
    assertAbsent(map, "C");
  });

  it("retain_with_seller with transferredKg null but totalKg set → full retain", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "C",
        offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
        stockEntitlementKg: "1000",
        stockEntitlementTransferredKg: null,
      }),
    ]);
    assertPct(map, "A", "60");
    assertAbsent(map, "C");
  });

  it("buyerPartnerId null → transfer skipped regardless of handling", () => {
    const map = makeMap({ A: { name: "Alice", pct: "100" } });
    applyTransferEntitlements(map, [
      {
        transferorPartnerId: "A",
        buyerPartnerId: null,
        buyerName: "Unknown",
        offeredPercentage: "50",
        stockEntitlementHandling: "transfer_to_buyer",
        stockEntitlementKg: null,
        stockEntitlementRetainedKg: null,
        stockEntitlementTransferredKg: null,
      },
    ]);
    assertPct(map, "A", "100");
  });

  it("empty transfers array returns map unchanged", () => {
    const map = makeMap({
      A: { name: "Alice", pct: "60" },
      B: { name: "Bob",   pct: "40" },
    });
    applyTransferEntitlements(map, []);
    assertPct(map, "A", "60");
    assertPct(map, "B", "40");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });

  it("buyer already exists in map — gains are additive", () => {
    // B is already in the map at 30%; another partner transfers 20% to B.
    const map = makeMap({
      A: { name: "Alice", pct: "70" },
      B: { name: "Bob",   pct: "30" },
    });
    applyTransferEntitlements(map, [
      tx({
        transferorPartnerId: "A",
        buyerPartnerId: "B",
        offeredPercentage: "20",
        stockEntitlementHandling: "transfer_to_buyer",
      }),
    ]);
    assertPct(map, "A", "50");
    assertPct(map, "B", "50");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });

  it("three-partner chain with mixed handling preserves sum", () => {
    // A=50 B=30 C=20
    // TX1 A→D retain_with_seller (10%) → skip
    // TX2 B→E transfer_to_buyer  (15%) → apply
    // TX3 C→F retain_with_seller + KG (20%, 50% transferred) → effectivePct=10%
    const map = makeMap({
      A: { name: "Alice",   pct: "50" },
      B: { name: "Bob",     pct: "30" },
      C: { name: "Charlie", pct: "20" },
    });
    applyTransferEntitlements(map, [
      tx({ transferorPartnerId: "A", buyerPartnerId: "D", offeredPercentage: "10", stockEntitlementHandling: "retain_with_seller" }),
      tx({ transferorPartnerId: "B", buyerPartnerId: "E", offeredPercentage: "15", stockEntitlementHandling: "transfer_to_buyer" }),
      tx({
        transferorPartnerId: "C", buyerPartnerId: "F", offeredPercentage: "20",
        stockEntitlementHandling: "retain_with_seller",
        stockEntitlementKg: "100", stockEntitlementRetainedKg: "50", stockEntitlementTransferredKg: "50",
      }),
    ]);
    // A=50 (skip), B=30-15=15, E=15, C=20-10=10, F=10, D absent
    assertPct(map, "A", "50");
    assertPct(map, "B", "15");
    assertPct(map, "E", "15");
    assertPct(map, "C", "10");
    assertPct(map, "F", "10");
    assertAbsent(map, "D");
    assert.equal(sumPct(map).toFixed(2), "100.00");
  });
});

/**
 * Unit tests for the money/ utility module.
 *
 * Uses node:test (built-in, zero-dependency). Run with:
 *   node --import tsx --test src/lib/money/index.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toMoney,
  fromMoney,
  addMoney,
  subMoney,
  mulMoney,
  splitMoney,
  isZeroMoney,
  gtMoney,
  gteMoney,
  ltMoney,
  lteMoney,
  ZERO,
} from "./index";

describe("toMoney — tolerance", () => {
  it("returns ZERO for null", () => {
    assert.equal(toMoney(null).toString(), "0");
  });
  it("returns ZERO for undefined", () => {
    assert.equal(toMoney(undefined).toString(), "0");
  });
  it("returns ZERO for empty string", () => {
    assert.equal(toMoney("").toString(), "0");
  });
  it("returns ZERO for whitespace", () => {
    assert.equal(toMoney("   ").toString(), "0");
  });
  it("returns ZERO for NaN", () => {
    assert.equal(toMoney(Number.NaN).toString(), "0");
  });
  it("returns ZERO for Infinity", () => {
    assert.equal(toMoney(Number.POSITIVE_INFINITY).toString(), "0");
  });
  it("returns ZERO for garbage string", () => {
    assert.equal(toMoney("not-a-number").toString(), "0");
  });
  it("accepts integer number", () => {
    assert.equal(toMoney(100).toString(), "100");
  });
  it("accepts decimal number", () => {
    assert.equal(toMoney(12.5).toString(), "12.5");
  });
  it("accepts decimal string", () => {
    assert.equal(toMoney("125000.50").toString(), "125000.5");
  });
  it("accepts negative", () => {
    assert.equal(toMoney("-3.75").toString(), "-3.75");
  });
  it("accepts very large value (within numeric(15,2))", () => {
    assert.equal(toMoney("9999999999999.99").toString(), "9999999999999.99");
  });
});

describe("fromMoney — serialization", () => {
  it("fixes 2 decimal places", () => {
    assert.equal(fromMoney(toMoney(100)), "100.00");
  });
  it("rounds half-even down", () => {
    // 1.005 → 1.00 (banker's rounding, half to even)
    assert.equal(fromMoney(toMoney("1.005")), "1.00");
  });
  it("rounds half-even up", () => {
    // 1.015 → 1.02 (banker's rounding, half to even)
    assert.equal(fromMoney(toMoney("1.015")), "1.02");
  });
  it("preserves negative", () => {
    assert.equal(fromMoney(toMoney("-7.50")), "-7.50");
  });
});

describe("addMoney / subMoney", () => {
  it("adds number + string", () => {
    assert.equal(addMoney(1.5, "2.75").toString(), "4.25");
  });
  it("adds null safely", () => {
    assert.equal(addMoney(null, "5").toString(), "5");
  });
  it("subtracts exactly without float drift", () => {
    // The infamous 0.1 + 0.2 case
    assert.equal(addMoney("0.1", "0.2").toString(), "0.3");
  });
  it("subtracts to negative", () => {
    assert.equal(subMoney("10", "25.50").toString(), "-15.5");
  });
});

describe("mulMoney", () => {
  it("multiplies exactly", () => {
    assert.equal(mulMoney("100.10", "1.05").toString(), "105.105");
  });
  it("multiplies by zero", () => {
    assert.equal(mulMoney("999.99", 0).toString(), "0");
  });
  it("multiplies by null factor → 0", () => {
    assert.equal(mulMoney("999.99", null).toString(), "0");
  });
});

describe("splitMoney — exact-sum guarantee", () => {
  it("splits 100 equally three ways", () => {
    const out = splitMoney("100", [1, 1, 1]);
    const sum = out.reduce((s, p) => s.plus(p), ZERO);
    assert.equal(sum.toFixed(2), "100.00");
    // Largest-remainder pushes the extra paise to the first bucket.
    assert.deepEqual(
      out.map((p) => p.toFixed(2)),
      ["33.34", "33.33", "33.33"],
    );
  });
  it("splits with weighted ratios", () => {
    const out = splitMoney("1000", [3, 2]);
    assert.deepEqual(
      out.map((p) => p.toFixed(2)),
      ["600.00", "400.00"],
    );
  });
  it("zero ratios returns zeros", () => {
    const out = splitMoney("500", [0, 0, 0]);
    assert.deepEqual(
      out.map((p) => p.toFixed(2)),
      ["0.00", "0.00", "0.00"],
    );
  });
  it("split sum exactly equals total for awkward values", () => {
    const out = splitMoney("100.01", [1, 1, 1]);
    const sum = out.reduce((s, p) => s.plus(p), ZERO);
    assert.equal(sum.toFixed(2), "100.01");
  });
  it("split handles negative total", () => {
    const out = splitMoney("-10.00", [1, 1]);
    const sum = out.reduce((s, p) => s.plus(p), ZERO);
    assert.equal(sum.toFixed(2), "-10.00");
  });
});

describe("comparisons", () => {
  it("isZeroMoney", () => {
    assert.equal(isZeroMoney(null), true);
    assert.equal(isZeroMoney("0.00"), true);
    assert.equal(isZeroMoney("0.01"), false);
  });
  it("gtMoney / gteMoney", () => {
    assert.equal(gtMoney("10", "5"), true);
    assert.equal(gtMoney("5", "5"), false);
    assert.equal(gteMoney("5", "5"), true);
  });
  it("ltMoney / lteMoney", () => {
    assert.equal(ltMoney("3", "5"), true);
    assert.equal(ltMoney("5", "5"), false);
    assert.equal(lteMoney("5", "5"), true);
  });
  it("comparisons tolerate null", () => {
    assert.equal(gtMoney(null, "-1"), true);
    assert.equal(ltMoney(null, "1"), true);
  });
});

describe("real-world value shapes", () => {
  it("handles a Drizzle real (number) value", () => {
    const rowAmount: number = 12345.67;
    assert.equal(fromMoney(toMoney(rowAmount)), "12345.67");
  });
  it("handles a Drizzle numeric (string) value", () => {
    const rowAmount: string = "12345.67";
    assert.equal(fromMoney(toMoney(rowAmount)), "12345.67");
  });
  it("handles a Drizzle numeric NULL value", () => {
    const rowAmount: string | null = null;
    assert.equal(fromMoney(toMoney(rowAmount)), "0.00");
  });
  it("sums a mixed-shape array exactly", () => {
    const rows: (number | string | null)[] = [100, "200.50", null, "0.25", 50];
    const total = rows.reduce<ReturnType<typeof toMoney>>((s, r) => s.plus(toMoney(r)), ZERO);
    assert.equal(fromMoney(total), "350.75");
  });
});

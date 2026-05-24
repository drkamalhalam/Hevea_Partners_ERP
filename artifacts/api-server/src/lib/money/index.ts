/**
 * money — decimal-safe monetary arithmetic utilities.
 *
 * Background:
 *   Money columns in this project live in Postgres as a mix of `real` (float4)
 *   and `numeric(p,2)`. Drizzle returns `real` as JS `number` and `numeric`
 *   as JS `string`. The Numeric Precision Foundation (NPF) plan will migrate
 *   every money column to `numeric(15,2)`. Code that touches money must:
 *     (a) tolerate `number | string | null | undefined` shapes today; and
 *     (b) produce exact decimal results (no float drift) for multiplicative
 *         operations such as escalation, split, and ratio math.
 *
 *   This module wraps `decimal.js-light` to provide a small, consistent API.
 *   The wider codebase uses `toNum(...)` from `numericSafe.ts` for additive
 *   sums where float precision is not the dominant risk. This module is the
 *   foundation for upcoming Stage 3 rewrites of multiplicative paths
 *   (LCA escalation, 50% waterfall, valuation DCF).
 *
 *   ROUNDING POLICY: HALF_UP (round-half-away-from-zero) at 2 decimal places
 *   for final money values. This is the canonical NPF policy — it matches
 *   common business/accounting expectations (e.g. 0.005 → 0.01) and aligns
 *   with PostgreSQL `numeric(p,2)` ROUND() default behaviour for non-negative
 *   values. Intermediate values keep full Decimal precision.
 *
 *   This module performs NO schema, API, or behaviour changes. It is additive.
 */

import Decimal from "decimal.js-light";

// Canonical rounding mode for money: HALF_UP (round-half-away-from-zero).
const ROUND = Decimal.ROUND_HALF_UP;

// Configure Decimal globally for money-grade defaults. decimal.js-light is
// configured at construction time via the static `set` method.
Decimal.set({
  precision: 30,
  rounding: ROUND,
  toExpNeg: -20,
  toExpPos: 30,
});

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Anything that could carry a money value at runtime. `number` is the legacy
 * `real` column shape; `string` is the `numeric(p,s)` shape; `null`/`undefined`
 * arise from optional or unverified columns.
 */
export type MoneyInput = number | string | null | undefined | Decimal;

/** The fixed scale of money in this codebase: 2 decimal places (paise). */
export const MONEY_SCALE = 2;

/** Canonical zero for boundary conditions. */
export const ZERO = new Decimal(0);

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Convert any MoneyInput to a Decimal. Tolerant of bad inputs:
 *   - null / undefined → 0
 *   - NaN / Infinity / non-finite numbers → 0
 *   - strings that fail to parse → 0
 *
 * No rounding; full input precision is preserved.
 */
export function toMoney(v: MoneyInput): Decimal {
  if (v === null || v === undefined) return ZERO;
  if (v instanceof Decimal) return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return ZERO;
    // Numbers route through string to avoid binary-float artefacts being
    // observed by Decimal's parser.
    return new Decimal(v.toString());
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return ZERO;
    try {
      // decimal.js-light throws on unparseable inputs — try/catch is the guard.
      return new Decimal(trimmed);
    } catch {
      return ZERO;
    }
  }
  return ZERO;
}

/**
 * Format a Decimal for storage or wire transmission. Always returns a fixed
 * 2-dp string suitable for `numeric(15,2)` columns and decimal-typed API
 * fields. HALF_UP rounding (NPF canonical policy).
 */
export function fromMoney(d: Decimal): string {
  return d.toDecimalPlaces(MONEY_SCALE, ROUND).toFixed(MONEY_SCALE);
}

/**
 * NPF canonical alias for `fromMoney(...)`. Returned string is always
 * exactly 2 dp and safe to write to a `numeric(15,2)` column.
 */
export function formatMoney(d: Decimal): string {
  return fromMoney(d);
}

/**
 * NPF canonical alias for `toMoney(...)`. Use when the call site is
 * specifically parsing a value read from a Drizzle row (legacy `real`
 * → number, post-migration `numeric` → string, NULL → undefined).
 */
export function parseMoneyFromDb(v: MoneyInput): Decimal {
  return toMoney(v);
}

// ── Arithmetic ───────────────────────────────────────────────────────────────

export function addMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return toMoney(a).plus(toMoney(b));
}

/**
 * NPF canonical summation helper. Accepts an iterable of mixed-shape money
 * values and returns the exact total as a Decimal. Tolerant of null/undefined
 * entries (treated as 0).
 */
export function sumMoney(values: Iterable<MoneyInput>): Decimal {
  let acc: Decimal = ZERO;
  for (const v of values) acc = acc.plus(toMoney(v));
  return acc;
}

export function subMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return toMoney(a).minus(toMoney(b));
}

/**
 * Multiply money by a scalar factor (e.g. a percentage as a fraction, or a
 * yearly escalation multiplier). The factor accepts the same shapes as money.
 */
export function mulMoney(a: MoneyInput, factor: MoneyInput): Decimal {
  return toMoney(a).times(toMoney(factor));
}

/**
 * Allocate a total across N ratio buckets using the largest-remainder method,
 * guaranteeing that the sum of the returned Decimals exactly equals the
 * rounded total (no leftover paise). Each result is rounded to MONEY_SCALE.
 *
 * If ratios sum to 0 (or are all empty), returns an array of zeros.
 */
export function splitMoney(total: MoneyInput, ratios: MoneyInput[]): Decimal[] {
  const totalD = toMoney(total).toDecimalPlaces(MONEY_SCALE, ROUND);
  const ratioDs = ratios.map(toMoney);
  const ratioSum = ratioDs.reduce<Decimal>((s, r) => s.plus(r), ZERO);

  if (ratioSum.isZero() || ratioDs.length === 0) {
    return ratioDs.map(() => ZERO);
  }

  // Convert total to paise (integer Decimal) for the exact-sum guarantee.
  const totalPaise = totalD.times(100).toDecimalPlaces(0, ROUND);

  // Initial floor allocation per bucket in paise.
  const exact: Decimal[] = ratioDs.map((r) => totalPaise.times(r).div(ratioSum));
  const floored: Decimal[] = exact.map((p) => p.toDecimalPlaces(0, Decimal.ROUND_FLOOR));
  let assigned = floored.reduce<Decimal>((s, p) => s.plus(p), ZERO);
  let remainder = totalPaise.minus(assigned);

  // Distribute leftover paise to buckets with the largest fractional remainder.
  const order = exact
    .map((p, i) => ({ i, frac: p.minus(floored[i]!) }))
    .sort((a, b) => b.frac.comparedTo(a.frac));

  let idx = 0;
  while (remainder.greaterThan(0) && idx < order.length) {
    floored[order[idx]!.i] = floored[order[idx]!.i]!.plus(1);
    remainder = remainder.minus(1);
    idx += 1;
  }
  // If remainder is negative (rounding overflow), reverse: subtract from the
  // smallest fractional buckets.
  if (remainder.lessThan(0)) {
    const reverse = [...order].reverse();
    let j = 0;
    while (remainder.lessThan(0) && j < reverse.length) {
      floored[reverse[j]!.i] = floored[reverse[j]!.i]!.minus(1);
      remainder = remainder.plus(1);
      j += 1;
    }
  }

  // Convert paise back to money.
  return floored.map((p) => p.div(100));
}

// ── Comparisons ──────────────────────────────────────────────────────────────

export function isZeroMoney(v: MoneyInput): boolean {
  return toMoney(v).isZero();
}

export function gtMoney(a: MoneyInput, b: MoneyInput): boolean {
  return toMoney(a).greaterThan(toMoney(b));
}

export function gteMoney(a: MoneyInput, b: MoneyInput): boolean {
  return toMoney(a).greaterThanOrEqualTo(toMoney(b));
}

export function ltMoney(a: MoneyInput, b: MoneyInput): boolean {
  return toMoney(a).lessThan(toMoney(b));
}

export function lteMoney(a: MoneyInput, b: MoneyInput): boolean {
  return toMoney(a).lessThanOrEqualTo(toMoney(b));
}

// Re-export Decimal so callers can use the result type without a direct
// decimal.js-light import (single dependency surface for the rest of the app).
export { Decimal };

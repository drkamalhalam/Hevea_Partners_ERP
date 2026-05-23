/**
 * numericSafe.ts — Type-safety helper for monetary values read from the DB.
 *
 * Background:
 *   Drizzle returns `real` columns as JS `number` and `numeric(p,s)` columns
 *   as JS `string`. The Numeric Precision Foundation plan will convert money
 *   columns from `real` to `numeric(15,2)`. Any arithmetic on the returned
 *   value must tolerate BOTH shapes so that:
 *     (a) it works today (pre-conversion, value is `number`); and
 *     (b) it works after Stage 2 (post-conversion, value is `string`).
 *
 *   `Number(x)` is a no-op for finite numbers and parses well-formed decimal
 *   strings exactly (no precision loss for values within the 2-dp money range).
 *
 * Usage:
 *   import { toNum } from "../lib/numericSafe.js";
 *   const amt = toNum(row.amount);   // safe whether row.amount is number | string | null
 *   total += amt;
 *
 * This helper performs NO rounding. It is purely a type-coercion bridge.
 * Null/undefined/NaN/non-finite values all coerce to 0.
 */

export function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

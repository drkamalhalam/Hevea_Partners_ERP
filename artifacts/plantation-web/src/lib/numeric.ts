/**
 * NPF Stage 2 — Frontend numeric coercion helper.
 *
 * Server responses for financial / quantity / percentage / area fields are
 * Postgres `numeric(p,s)` columns and may arrive as decimal strings or
 * numbers (during transition). Wrap any server-originated value with
 * `parseNumeric` before passing it to `.toFixed()`, `.toLocaleString()`,
 * `Math.*`, or arithmetic / comparison operators.
 *
 * Behavior:
 *   null            -> 0
 *   undefined       -> 0
 *   "" (empty)      -> 0
 *   invalid string  -> 0
 *   number          -> same number (NaN/Infinity -> 0)
 *   decimal string  -> Number(value)
 */
export function parseNumeric(
  value: string | number | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

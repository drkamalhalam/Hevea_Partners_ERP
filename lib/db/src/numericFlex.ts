import { customType } from "drizzle-orm/pg-core";

/**
 * NPF Stage 2 — Flexible decimal column.
 *
 * Storage: Postgres `numeric(precision, scale)` — full decimal precision.
 * TS surface: `number` for both reads and writes.
 *
 * Rationale:
 *  - Drizzle's built-in `numeric(...)` types `data` as `string`, which
 *    would require touching ~93 insert sites and dozens of arithmetic
 *    call-sites across the server.
 *  - The pg driver returns `numeric` as a string. We convert it back to
 *    `number` via `fromDriver` (Number(...)). For this app's value range
 *    (INR financials, ownership %, kg, kani area), all values fit well
 *    within `Number.MAX_SAFE_INTEGER` (2^53 ≈ 9.0e15), so float64 carries
 *    no precision loss versus the prior `real` columns.
 *  - The Postgres-side precision (15 digits, 2-decimal money etc.) is the
 *    authoritative store — the database rejects out-of-bounds values.
 *  - Existing Stage-1 `toNum()` hardening still applies and remains safe;
 *    `toNum(<number>)` is idempotent.
 */
export const numericFlex = customType<{
  data: number;
  driverData: string;
  config: { precision: number; scale: number };
}>({
  dataType(config) {
    if (!config) {
      throw new Error("numericFlex requires { precision, scale } config");
    }
    return `numeric(${config.precision},${config.scale})`;
  },
  toDriver(value: number): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`numericFlex: non-finite value rejected (${value})`);
    }
    return value.toString();
  },
  fromDriver(value: unknown): number {
    if (value === null || value === undefined) {
      return value as unknown as number;
    }
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  },
});

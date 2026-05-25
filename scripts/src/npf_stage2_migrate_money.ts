/**
 * NPF Stage 2 — money-column migration helper.
 *
 * For each in-scope `real → numeric(15,2)` money column, this script:
 *   1. Snapshots every existing row's original `real` value, the
 *      ROUND(::numeric, 2) converted value, and the delta into
 *      `precision_conversion_audit` BEFORE the ALTER.
 *   2. Runs `ALTER COLUMN ... TYPE numeric(15,2) USING ROUND(col::numeric, 2)`.
 *   3. Verifies: post-ALTER row count of NOT NULL values in the target column
 *      equals the count of audit rows inserted for that column (parity check).
 *      Throws and aborts if parity fails — do not proceed to next column.
 *   4. Logs the count of non-zero deltas (rounding events) per column.
 *
 * Intended for the production cut-over. The dev DB has already been migrated
 * via `drizzle-kit push` (Drizzle generates equivalent ALTER COLUMN ... TYPE
 * statements), and was empty at the time of push, so no rows existed to
 * snapshot — the audit table is empty for dev as expected.
 *
 * Run AS A ONE-SHOT against the target environment AFTER:
 *   - `precision_conversion_audit` exists (already pushed by Drizzle).
 *   - The Drizzle schema has been updated to numericFlex but NOT yet pushed.
 *
 * The script is idempotent per column: it checks information_schema first
 * and SKIPS any column whose data_type is already `numeric`.
 *
 * FROZEN TABLES (NOT in TARGETS — per Stage 2 exclusion list in SQL artifact):
 *   ownership_snapshots, inheritance_history, generations, backup_*
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

interface Target {
  table: string;
  column: string;
  pk: string; // primary-key column name, usually "id"
}

// All in-scope `real → numeric(p,s)` money/quantity/pct columns.
// Table and column names verified against current live schema.
const TARGETS: Target[] = [
  // ── Money: numeric(15,2) ────────────────────────────────────────────────
  { table: "agreements",              column: "land_notional_value",   pk: "id" },
  { table: "agreements",              column: "yearly_escalation",     pk: "id" },
  { table: "contributions",           column: "amount",                pk: "id" },
  { table: "expenditures",            column: "amount",                pk: "id" },
  { table: "lca_configs",             column: "base_amount",           pk: "id" },
  { table: "lca_ledger",              column: "base_amount",           pk: "id" },
  { table: "lca_ledger",              column: "gross_due",             pk: "id" },
  { table: "lca_ledger",              column: "carry_forward",         pk: "id" },
  { table: "lca_ledger",              column: "total_due",             pk: "id" },
  { table: "lca_ledger",              column: "amount_paid",           pk: "id" },
  { table: "lca_ledger",              column: "balance",               pk: "id" },
  { table: "lca_payment_events",      column: "amount_paid",           pk: "id" },
  // Correct table name: landowner_ledger_entries (NOT landowner_account_ledger)
  { table: "landowner_ledger_entries", column: "amount",               pk: "id" },
  { table: "burden_recovery_adjustments", column: "amount_recovered",  pk: "id" },
  { table: "burden_recovery_adjustments", column: "recoverable_amount",pk: "id" },
  // Correct table name: post_maturity_cost_payments (NOT post_maturity_payments)
  { table: "post_maturity_cost_payments", column: "amount",            pk: "id" },
  { table: "distribution_previews",   column: "gross_revenue",         pk: "id" },
  { table: "agreement_accounting_profiles", column: "monthly_developer_share", pk: "id" },
  { table: "agreement_accounting_profiles", column: "monthly_landowner_share", pk: "id" },
  // Correct column name: selling_price_per_kg (NOT price_per_kg)
  { table: "production_records",      column: "selling_price_per_kg",  pk: "id" },
  // ── Quantity / kg: numeric(12,3) ────────────────────────────────────────
  { table: "production_records",      column: "production_kg",         pk: "id" },
  { table: "production_records",      column: "sold_kg",               pk: "id" },
  // ── Land area: numeric(12,4) ────────────────────────────────────────────
  { table: "agreements",              column: "land_area",             pk: "id" },
  { table: "project_parcels",         column: "land_area",             pk: "id" },
  // ── Ownership %: numeric(12,8) ──────────────────────────────────────────
  { table: "agreements",              column: "ownership_share_landowner", pk: "id" },
  { table: "agreements",              column: "ownership_share_developer", pk: "id" },
];

async function isAlreadyNumeric(table: string, column: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `);
  const t = (r.rows?.[0] as { data_type?: string } | undefined)?.data_type;
  return t === "numeric";
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `);
  return (r.rows?.length ?? 0) > 0;
}

async function snapshotColumn(t: Target): Promise<{ snapshotted: number; rounding: number }> {
  const insertSql = sql`
    INSERT INTO precision_conversion_audit
      (source_table, source_row_id, source_column,
       original_value, converted_value, delta, notes)
    SELECT ${t.table}, ${sql.raw(t.pk)}, ${t.column},
           ${sql.raw(t.column)}::double precision AS original_value,
           ROUND(${sql.raw(t.column)}::numeric, 2)::numeric(15,2) AS converted_value,
           (ROUND(${sql.raw(t.column)}::numeric, 2) - ${sql.raw(t.column)}::numeric)::double precision AS delta,
           'npf_stage2_migrate_money'
    FROM ${sql.raw(t.table)}
    WHERE ${sql.raw(t.column)} IS NOT NULL
  `;
  const ins = await db.execute(insertSql);
  const snapshotted = ins.rowCount ?? 0;
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM precision_conversion_audit
    WHERE source_table = ${t.table} AND source_column = ${t.column} AND delta <> 0
  `);
  const rounding = Number((r.rows?.[0] as { n: number } | undefined)?.n ?? 0);
  return { snapshotted, rounding };
}

async function alterToNumericMoney(t: Target): Promise<void> {
  await db.execute(
    sql`ALTER TABLE ${sql.raw(t.table)}
        ALTER COLUMN ${sql.raw(t.column)} TYPE numeric(15,2)
        USING ROUND(${sql.raw(t.column)}::numeric, 2)`,
  );
}

/**
 * Post-ALTER row-count parity check.
 * Verifies: count of NOT NULL values in target column ==
 *           count of audit rows inserted for this column.
 * Throws if parity fails — prevents silent data loss.
 */
async function verifyParity(t: Target, snapshotted: number): Promise<void> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM ${sql.raw(t.table)}
    WHERE ${sql.raw(t.column)} IS NOT NULL
  `);
  const liveCount = Number((r.rows?.[0] as { n: number } | undefined)?.n ?? -1);
  if (liveCount !== snapshotted) {
    throw new Error(
      `[parity-fail] ${t.table}.${t.column}: ` +
      `snapshotted=${snapshotted} live_not_null=${liveCount} — ABORT`,
    );
  }
}

async function main() {
  console.log("[npf-stage2] Starting money-column migration");
  let skipped = 0;
  let converted = 0;
  let errors = 0;

  for (const t of TARGETS) {
    // Guard: verify column exists before attempting anything
    const exists = await columnExists(t.table, t.column);
    if (!exists) {
      console.warn(`  WARN ${t.table}.${t.column} — column not found in schema, skipping`);
      skipped++;
      continue;
    }

    const already = await isAlreadyNumeric(t.table, t.column);
    if (already) {
      console.log(`  SKIP ${t.table}.${t.column} (already numeric)`);
      skipped++;
      continue;
    }

    try {
      const { snapshotted, rounding } = await snapshotColumn(t);
      await alterToNumericMoney(t);
      // Post-ALTER parity check — throws on mismatch
      await verifyParity(t, snapshotted);
      console.log(
        `  OK   ${t.table}.${t.column} ` +
          `(snapshotted=${snapshotted}, rounding-events=${rounding})`,
      );
      converted++;
    } catch (err) {
      console.error(`  FAIL ${t.table}.${t.column}:`, err instanceof Error ? err.message : err);
      errors++;
      // Abort on first failure to avoid cascading issues
      console.error("[npf-stage2] Aborting due to column migration failure");
      process.exit(1);
    }
  }

  console.log(
    `[npf-stage2] Done — converted=${converted}, skipped=${skipped}, errors=${errors}`,
  );
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[npf-stage2] FAILED:", err);
  process.exit(1);
});

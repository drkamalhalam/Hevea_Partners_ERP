/**
 * NPF Stage 2 — money-column migration helper (MONEY COLUMNS ONLY).
 *
 * Scope: real → numeric(15,2) for monetary columns only.
 * Non-money precision (ownership %, quantity/kg, land area, escalation factor)
 * is handled by the Drizzle schema push and is intentionally EXCLUDED here
 * to prevent applying ROUND(...,2) to fields that require different scale.
 *
 * For each in-scope column this script:
 *   1. Checks information_schema — skips if column is already `numeric`.
 *   2. Guards that the column actually exists — warns and skips if not found.
 *   3. Snapshots every existing row's original `real` value, the
 *      ROUND(::numeric, 2) converted value, and the delta into
 *      `precision_conversion_audit` BEFORE the ALTER.
 *   4. Runs `ALTER COLUMN ... TYPE numeric(15,2) USING ROUND(col::numeric, 2)`.
 *   5. Verifies post-ALTER: count of NOT NULL values in the target column
 *      equals count of audit rows inserted — throws and aborts on mismatch.
 *   6. Logs rounding-event counts per column.
 *
 * Intended for the production cut-over. The dev DB has already been migrated
 * via `drizzle-kit push` and was empty at push time, so the audit table is
 * empty for dev as expected.
 *
 * FROZEN TABLES — never in TARGETS (per Stage 2 exclusion list):
 *   ownership_snapshots, inheritance_history, generations, backup_*
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

interface Target {
  table: string;
  column: string;
  pk: string;
}

/**
 * MONEY columns only — all target type numeric(15, 2).
 * Table and column names verified against current live Drizzle schema.
 *
 * Excluded (non-money, handled by Drizzle push):
 *   - ownership %: projects.developer_ownership_pct / landowner_ownership_pct
 *   - non-ownership %: lca_configs.escalation_pct
 *   - quantity/kg: production_records.production_kg, .sold_kg; store_entries.quantity_kg
 *   - land area: agreements.land_area, project_parcels.land_area, projects.land_area
 *   - escalation factor: agreements.escalation_factor
 */
const TARGETS: Target[] = [
  // agreements — money fields
  { table: "agreements",              column: "land_notional_value",   pk: "id" },
  { table: "agreements",              column: "yearly_escalation",     pk: "id" },
  // contributions
  { table: "contributions",           column: "amount",                pk: "id" },
  // expenditures
  { table: "expenditures",            column: "amount",                pk: "id" },
  // lca
  { table: "lca_configs",             column: "base_amount",           pk: "id" },
  { table: "lca_ledger",              column: "base_amount",           pk: "id" },
  { table: "lca_ledger",              column: "gross_due",             pk: "id" },
  { table: "lca_ledger",              column: "carry_forward",         pk: "id" },
  { table: "lca_ledger",              column: "total_due",             pk: "id" },
  { table: "lca_ledger",              column: "amount_paid",           pk: "id" },
  { table: "lca_ledger",              column: "balance",               pk: "id" },
  { table: "lca_payment_events",      column: "amount_paid",           pk: "id" },
  // Landowner ledger — real table name is landowner_ledger_entries
  { table: "landowner_ledger_entries", column: "amount",               pk: "id" },
  // Burden recovery
  { table: "burden_recovery_adjustments", column: "amount_recovered",  pk: "id" },
  { table: "burden_recovery_adjustments", column: "recoverable_amount",pk: "id" },
  // Post-maturity — real table name is post_maturity_cost_payments
  { table: "post_maturity_cost_payments", column: "amount",            pk: "id" },
  // Distribution previews — only gross_revenue is real; epp_total/landowner_total don't exist
  { table: "distribution_previews",   column: "gross_revenue",         pk: "id" },
  // Agreement accounting profiles
  { table: "agreement_accounting_profiles", column: "monthly_developer_share", pk: "id" },
  { table: "agreement_accounting_profiles", column: "monthly_landowner_share", pk: "id" },
  // Production records — money column: selling_price_per_kg (NOT price_per_kg)
  { table: "production_records",      column: "selling_price_per_kg",  pk: "id" },
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
  const ins = await db.execute(sql`
    INSERT INTO precision_conversion_audit
      (source_table, source_row_id, source_column,
       original_value, converted_value, delta, notes)
    SELECT ${t.table}, ${sql.raw(t.pk)}, ${t.column},
           ${sql.raw(t.column)}::double precision,
           ROUND(${sql.raw(t.column)}::numeric, 2)::numeric(15,2),
           (ROUND(${sql.raw(t.column)}::numeric, 2) - ${sql.raw(t.column)}::numeric)::double precision,
           'npf_stage2_migrate_money'
    FROM ${sql.raw(t.table)}
    WHERE ${sql.raw(t.column)} IS NOT NULL
  `);
  const snapshotted = ins.rowCount ?? 0;
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM precision_conversion_audit
    WHERE source_table = ${t.table} AND source_column = ${t.column} AND delta <> 0
  `);
  const rounding = Number((r.rows?.[0] as { n: number } | undefined)?.n ?? 0);
  return { snapshotted, rounding };
}

async function alterToNumericMoney(t: Target): Promise<void> {
  await db.execute(sql`
    ALTER TABLE ${sql.raw(t.table)}
    ALTER COLUMN ${sql.raw(t.column)} TYPE numeric(15,2)
    USING ROUND(${sql.raw(t.column)}::numeric, 2)
  `);
}

/**
 * Post-ALTER parity check: count of NOT NULL values in the converted column
 * must equal the count of audit rows snapshotted for it.
 * Throws on mismatch — prevents silent row-count discrepancy.
 */
async function verifyParity(t: Target, snapshotted: number): Promise<void> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM ${sql.raw(t.table)}
    WHERE ${sql.raw(t.column)} IS NOT NULL
  `);
  const liveCount = Number((r.rows?.[0] as { n: number } | undefined)?.n ?? -1);
  if (liveCount !== snapshotted) {
    throw new Error(
      `[parity-fail] ${t.table}.${t.column}: snapshotted=${snapshotted} live_not_null=${liveCount}`,
    );
  }
}

async function main() {
  console.log("[npf-stage2] Starting money-column migration (money columns only)");
  let skipped = 0;
  let converted = 0;
  let errors = 0;

  for (const t of TARGETS) {
    const exists = await columnExists(t.table, t.column);
    if (!exists) {
      console.warn(`  WARN ${t.table}.${t.column} — column not found in live schema, skipping`);
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
      await verifyParity(t, snapshotted);
      console.log(
        `  OK   ${t.table}.${t.column} (snapshotted=${snapshotted}, rounding-events=${rounding})`,
      );
      converted++;
    } catch (err) {
      console.error(`  FAIL ${t.table}.${t.column}:`, err instanceof Error ? err.message : err);
      errors++;
      console.error("[npf-stage2] Aborting — fix the failure before re-running");
      process.exit(1);
    }
  }

  console.log(
    `[npf-stage2] Done — converted=${converted}, skipped=${skipped}, errors=${errors}`,
  );
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[npf-stage2] FATAL:", err);
  process.exit(1);
});

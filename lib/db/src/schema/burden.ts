import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";
import {
  burdenBearerTypeEnum,
  burdenAdjustmentStatusEnum,
  burdenRecoveryStatusEnum,
} from "./enums";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { expendituresTable } from "./expenditures";

// ── Burden Rules ──────────────────────────────────────────────────────────────
/**
 * Project-level rules that define the EXPECTED operational burden allocation.
 * A rule answers: "For this project (and optionally category), who is expected
 * to bear costs, and in what proportion?"
 *
 * Rules are matched most-specifically (category match beats null=all).
 * The most recently created active matching rule wins.
 */
export const burdenRulesTable = pgTable("burden_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  /** Null means the rule applies to all expenditure categories. */
  category: text("category"),

  /**
   * How costs should be split:
   *   developer    — 100% developer
   *   landowner    — 100% landowner
   *   shared       — fixed split by developerPct / landownerPct
   *   proportional — split proportional to ownership stakes (stored as meta;
   *                  actual % computed at record creation time from agreements)
   */
  bearerType: burdenBearerTypeEnum("bearer_type").notNull(),

  /** Required when bearerType = 'shared'. Must sum to 100. */
  developerPct: numeric("developer_pct", { precision: 5, scale: 2 }),
  landownerPct: numeric("landowner_pct", { precision: 5, scale: 2 }),

  /**
   * Which lifecycle phase this rule applies to.
   * 'all' = applies in every phase (default).
   */
  lifecyclePhase: text("lifecycle_phase").notNull().default("all"),

  description: text("description"),

  /** Inclusive start date for this rule (ISO YYYY-MM-DD). */
  effectiveFrom: text("effective_from").notNull(),
  /** Inclusive end date; null = open-ended. */
  effectiveTo: text("effective_to"),

  isActive: boolean("is_active").notNull().default(true),

  createdById: uuid("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Burden Records ────────────────────────────────────────────────────────────
/**
 * Per-expenditure burden allocation record.
 *
 * For every expenditure that enters the burden accounting engine, one record
 * is created capturing:
 *   - The EXPECTED split (from a matching rule or manual override)
 *   - The ACTUAL payer (derived from the expenditure's recordedBy / paidBy fields)
 *   - The IMBALANCE (expected - actual for each party)
 *   - Recovery tracking (who owes whom, and how much has been recovered)
 *
 * This table is separate from ownership contributions: it tracks running-cost
 * fairness, not equity stakes.
 */
export const burdenRecordsTable = pgTable("burden_records", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** The expenditure this record is linked to. */
  expenditureId: uuid("expenditure_id")
    .notNull()
    .references(() => expendituresTable.id, { onDelete: "restrict" }),

  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  /** The burden rule that was matched; null if manually set. */
  ruleId: uuid("rule_id").references(() => burdenRulesTable.id, {
    onDelete: "set null",
  }),

  /** Copied from expenditure at record creation time. */
  category: text("category").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  lifecyclePhaseSnapshot: text("lifecycle_phase_snapshot")
    .notNull()
    .default("prematurity"),

  // ── Expected allocation ──────────────────────────────────────────────────

  /** The bearer type from the matched rule (or manual entry). */
  expectedBearerType: text("expected_bearer_type").notNull(),

  /** Portion of totalAmount the developer was expected to bear. */
  expectedDeveloperAmount: numeric("expected_developer_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  /** Portion of totalAmount the landowner was expected to bear. */
  expectedLandownerAmount: numeric("expected_landowner_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  // ── Actual payer ─────────────────────────────────────────────────────────

  /** Role of the person who actually recorded / paid this expenditure. */
  actualPayerRole: text("actual_payer_role"),
  actualPayerName: text("actual_payer_name"),
  actualPayerId: uuid("actual_payer_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  /** Amount the developer actually bore (= totalAmount if developer paid, else 0). */
  actualDeveloperAmount: numeric("actual_developer_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  /** Amount the landowner actually bore (= totalAmount if landowner paid, else 0). */
  actualLandownerAmount: numeric("actual_landowner_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  // ── Imbalance ────────────────────────────────────────────────────────────

  /**
   * Developer imbalance = actualDeveloperAmount - expectedDeveloperAmount.
   * Positive → developer overpaid (landowner owes developer).
   * Negative → developer underpaid (developer owes landowner).
   */
  developerImbalanceAmount: numeric("developer_imbalance_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  /** Mirror of developer imbalance. Positive → landowner overpaid. */
  landownerImbalanceAmount: numeric("landowner_imbalance_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  /**
   * High-level characterisation of the imbalance:
   *   balanced          — actual matches expected (no recovery needed)
   *   developer_advance — developer paid more than expected; landowner owes developer
   *   landowner_advance — landowner paid more than expected; developer owes landowner
   *   waived            — imbalance acknowledged and written off
   */
  adjustmentStatus: burdenAdjustmentStatusEnum("adjustment_status")
    .notNull()
    .default("balanced"),

  // ── Recovery ─────────────────────────────────────────────────────────────

  /** Net amount that needs to be recovered (= abs(imbalance)). */
  recoverableAmount: numeric("recoverable_amount", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),

  /** Amount recovered so far (updated by mark-recovered actions). */
  recoveredAmount: numeric("recovered_amount", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),

  /**
   * Recovery lifecycle:
   *   none        — no imbalance; nothing to recover
   *   pending     — imbalance exists; recovery not yet initiated
   *   in_recovery — recovery process started (partial repayment recorded)
   *   recovered   — fully recovered
   *   waived      — parties agreed to write off the imbalance
   */
  recoveryStatus: burdenRecoveryStatusEnum("recovery_status")
    .notNull()
    .default("none"),

  recoveryNotes: text("recovery_notes"),
  notes: text("notes"),

  isActive: boolean("is_active").notNull().default(true),

  // ── Audit ─────────────────────────────────────────────────────────────────

  createdById: uuid("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name"),

  adjustedAt: timestamp("adjusted_at"),
  adjustedById: uuid("adjusted_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  adjustedByName: text("adjusted_by_name"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

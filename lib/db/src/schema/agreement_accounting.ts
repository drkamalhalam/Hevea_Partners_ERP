import {
  pgTable,
  uuid,
  text,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { agreementsTable } from "./agreements";

/**
 * agreementAccountingProfilesTable
 *
 * One record per agreement. Stores the accounting model flags that determine
 * how revenue, costs, and LCA flow for this specific agreement.
 *
 * Two accounting models — the `accountingModel` column mirrors the agreement's
 * `revenueModel` field and governs which flags apply:
 *
 * "contribution" model:
 *   Revenue → (costs charged) → (LCA charged) → distributable profit pool
 *   Profit pool is then split per ownership/contribution stakes.
 *   Flags: costsChargedBeforeDistribution, lcaChargedBeforeDistribution.
 *
 * "fifty_percent_revenue" model:
 *   Gross revenue is split first (grossSplitPctLandowner + grossSplitPctDeveloper = 100).
 *   Each party then bears their own operational costs separately from their gross share.
 *   LCA is NOT applicable to this model.
 *   Flags: grossSplitPctLandowner, grossSplitPctDeveloper, landownerBearsCostSeparately,
 *          developerBearsCostSeparately.
 *
 * NOTE: This table stores architecture/flags only. No distribution calculations
 * are stored here — those belong to a future revenue distribution module.
 */
export const agreementAccountingProfilesTable = pgTable(
  "agreement_accounting_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    agreementId: uuid("agreement_id")
      .notNull()
      .unique()
      .references(() => agreementsTable.id, { onDelete: "cascade" }),

    /**
     * Mirrors agreement.revenueModel.
     * "contribution" | "fifty_percent_revenue"
     * Stored denormalized here so accounting queries don't need a JOIN.
     */
    accountingModel: text("accounting_model").notNull(),

    // ── Contribution model flags ─────────────────────────────────────────────

    /**
     * When true: operating costs are deducted from the gross revenue pool
     * before computing distributable profit. Applies to contribution model only.
     */
    costsChargedBeforeDistribution: boolean("costs_charged_before_distribution")
      .notNull()
      .default(true),

    /**
     * When true: the annual LCA amount is deducted from the gross revenue pool
     * before computing distributable profit. Applies to contribution model only.
     * Only meaningful when an active LCA config exists for the project.
     */
    lcaChargedBeforeDistribution: boolean("lca_charged_before_distribution")
      .notNull()
      .default(true),

    // ── 50% Revenue model flags ──────────────────────────────────────────────

    /**
     * Percentage of gross revenue allocated to the landowner in the first split.
     * Default 50. Must sum to 100 with grossSplitPctDeveloper.
     * Applies to fifty_percent_revenue model only.
     */
    grossSplitPctLandowner: real("gross_split_pct_landowner")
      .notNull()
      .default(50),

    /**
     * Percentage of gross revenue allocated to the developer in the first split.
     * Default 50. Must sum to 100 with grossSplitPctLandowner.
     * Applies to fifty_percent_revenue model only.
     */
    grossSplitPctDeveloper: real("gross_split_pct_developer")
      .notNull()
      .default(50),

    /**
     * When true: the landowner bears their share of operational costs directly
     * from their gross revenue split, not from a shared pool.
     * Applies to fifty_percent_revenue model only.
     */
    landownerBearsCostSeparately: boolean("landowner_bears_cost_separately")
      .notNull()
      .default(true),

    /**
     * When true: the developer bears their share of operational costs directly
     * from their gross revenue split, not from a shared pool.
     * Applies to fifty_percent_revenue model only.
     */
    developerBearsCostSeparately: boolean("developer_bears_cost_separately")
      .notNull()
      .default(true),

    // ── Shared flags ─────────────────────────────────────────────────────────

    /**
     * Whether LCA is applicable to this agreement.
     * Auto-set by the validate endpoint:
     *   contribution model     → true (if project has LCA config)
     *   fifty_percent_revenue  → always false
     */
    lcaApplicable: boolean("lca_applicable").notNull().default(false),

    // ── Validation ───────────────────────────────────────────────────────────

    /**
     * Result of the last validation run.
     *   pending — never validated
     *   valid   — all checks pass
     *   warning — passes with non-critical issues (e.g. ownership shares not set)
     *   invalid — critical issues found (e.g. split percentages don't sum to 100)
     */
    validationStatus: text("validation_status").notNull().default("pending"),

    /**
     * Human-readable summary of validation findings.
     * Null if validationStatus = 'pending'.
     */
    validationNotes: text("validation_notes"),

    validatedAt: timestamp("validated_at", { withTimezone: true }),

    validatedById: uuid("validated_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    validatedByName: text("validated_by_name"),

    // ── Audit ────────────────────────────────────────────────────────────────

    configuredById: uuid("configured_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    configuredByName: text("configured_by_name").notNull().default("System"),

    updatedById: uuid("updated_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    updatedByName: text("updated_by_name"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

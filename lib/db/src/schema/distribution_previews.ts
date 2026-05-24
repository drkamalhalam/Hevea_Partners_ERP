import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { agreementsTable } from "./agreements";
import { ownershipSnapshotsTable } from "./ownership_snapshots";
import type { OwnershipSnapshotEntry } from "./ownership_snapshots";

// ── Per-partner share entry (contribution model) ───────────────────────────

export interface DistributionShareEntry {
  partnerKey: string;
  partnerId: string | null;
  partnerName: string;
  role: "landowner" | "developer" | "unknown";
  ownershipPct: number;
  amount: number;
}

// ── Contribution model result ──────────────────────────────────────────────

export interface ContributionDistributionResult {
  model: "contribution";
  grossRevenue: number;
  operationalCost: number;
  lcaAmount: number;
  costsChargedBeforeDistribution: boolean;
  lcaChargedBeforeDistribution: boolean;
  distributablePool: number;
  ownerShares: DistributionShareEntry[];
  landownerTotal: number;
  developerTotal: number;
  ownershipSource: "frozen_snapshot" | "agreement_shares" | "live_calculation" | "manual";
  warnings: string[];
}

// ── 50% revenue model result ───────────────────────────────────────────────

export interface FiftyPercentDistributionResult {
  model: "fifty_percent_revenue";
  grossRevenue: number;
  operationalCost: number;
  splitPctLandowner: number;
  splitPctDeveloper: number;
  landownerGross: number;
  developerGross: number;
  landownerNet: number;
  developerNet: number;
  participantPoolGross: number;
  participantPoolNet: number;
  note: string;
  warnings: string[];
}

export type DistributionResult =
  | ContributionDistributionResult
  | FiftyPercentDistributionResult;

// ── Table ──────────────────────────────────────────────────────────────────

/**
 * distribution_previews — settlement guidance records.
 *
 * Each row is a model-aware distribution calculation for a specific period,
 * linked to a project and optionally an agreement. These are NEVER actual
 * payments — they are advisory calculations that guide how distributions
 * should be structured when payments are eventually processed.
 *
 * Records start as "draft", can be confirmed (locked as guidance), or
 * archived (soft-deleted).
 *
 * The `distributionResult` JSONB column holds the full typed breakdown
 * (see ContributionDistributionResult | FiftyPercentDistributionResult).
 */
export const distributionPreviewsTable = pgTable("distribution_previews", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  agreementId: uuid("agreement_id")
    .references(() => agreementsTable.id, { onDelete: "set null" }),

  // Mirrors the agreement accounting model at time of calculation
  accountingModel: text("accounting_model").notNull(),

  // ── Period ──────────────────────────────────────────────────────────────

  periodLabel: text("period_label").notNull(),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  periodYear: integer("period_year"),

  // ── Inputs ──────────────────────────────────────────────────────────────

  grossRevenue: numericFlex("gross_revenue", { precision: 15, scale: 2 }).notNull(),
  operationalCost: numericFlex("operational_cost", { precision: 15, scale: 2 })
    .notNull()
    .default(0),

  // LCA amount for this period (manual entry or fetched from lca_ledger)
  lcaAmount: numericFlex("lca_amount", { precision: 15, scale: 2 })
    .notNull()
    .default(0),

  // Whether LCA was fetched from the ledger or entered manually
  lcaSource: text("lca_source").notNull().default("manual"),

  // ── Sales linkage ───────────────────────────────────────────────────────

  // UUIDs of confirmed sales_transactions rows included in this preview
  linkedSaleIds: jsonb("linked_sale_ids")
    .$type<string[]>()
    .notNull()
    .default([]),

  // "sales_records" | "manual"
  revenueSource: text("revenue_source").notNull().default("manual"),

  // ── Ownership snapshot linkage ──────────────────────────────────────────

  // FK to the specific snapshot used for per-partner breakdown
  ownershipSnapshotId: uuid("ownership_snapshot_id")
    .references(() => ownershipSnapshotsTable.id, { onDelete: "set null" }),

  // Inline copy of snapshot entries at calculation time (immutable record)
  ownershipSnapshotEntries: jsonb("ownership_snapshot_entries")
    .$type<OwnershipSnapshotEntry[]>()
    .notNull()
    .default([]),

  notes: text("notes"),

  // ── Computed result ──────────────────────────────────────────────────────

  // Full typed breakdown (see DistributionResult types above)
  distributionResult: jsonb("distribution_result")
    .$type<DistributionResult>()
    .notNull(),

  // ── Lifecycle ────────────────────────────────────────────────────────────

  // draft → confirmed (locked guidance) → archived (soft-deleted)
  status: text("status").notNull().default("draft"),

  isActive: boolean("is_active").notNull().default(true),

  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedById: uuid("confirmed_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  confirmedByName: text("confirmed_by_name"),

  // ── Audit ────────────────────────────────────────────────────────────────

  calculatedById: uuid("calculated_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  calculatedByName: text("calculated_by_name"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DistributionPreview =
  typeof distributionPreviewsTable.$inferSelect;
export type InsertDistributionPreview =
  typeof distributionPreviewsTable.$inferInsert;

import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  timestamp,
  decimal,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  projectStatusEnum,
  projectLifecycleStatusEnum,
  projectCommercialModelEnum,
  projectActivationStatusEnum,
  projectConfigurationStatusEnum,
  projectLandownerValidationStatusEnum,
  projectTypeEnum,
} from "./enums";
import { usersTable } from "./users";
import { agreementTemplatesTable } from "./templates";

export const projectsTable = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── Identity ────────────────────────────────────────────────────────
  name: text("name").notNull(),
  /**
   * Short unique code (e.g. "HP-001"). Immutable once assigned.
   * Uniqueness is enforced by a partial unique index further down so that
   * NULL / unassigned codes do not collide.
   */
  projectCode: text("project_code"),
  description: text("description"),

  /**
   * Classification — drives deed template selection, governance expectations,
   * and dashboard filtering. Captured during the creation wizard.
   */
  projectType: projectTypeEnum("project_type")
    .notNull()
    .default("joint_venture"),

  /**
   * FK to the Document Template Registry row that will be used to generate
   * the project's agreement. Must point to a template with category =
   * 'agreement' and status = 'active' at the time of assignment.
   */
  agreementTemplateId: uuid("agreement_template_id").references(
    () => agreementTemplatesTable.id,
    { onDelete: "set null" },
  ),

  // ── Location ────────────────────────────────────────────────────────
  location: text("location").notNull(),
  village: text("village"),
  district: text("district").notNull(),
  state: text("state").notNull().default("Tripura"),

  // ── Land ────────────────────────────────────────────────────────────
  landArea: real("land_area").notNull(),
  landAreaUnit: text("land_area_unit").notNull().default("kani"),
  /**
   * Monetised land value used as equity contribution.
   * Captured during onboarding for ALL commercial models.
   * Under fifty_percent_revenue: stored and audited only — never activates.
   */
  landNotionalValue: real("land_notional_value"),
  landValuePerUnit: real("land_value_per_unit"),
  /**
   * How the land notional value was computed during onboarding.
   * "by_tree_capacity" | "by_land_area_kani" | "manual"
   */
  valuationMethod: text("valuation_method"),
  /** Value per tree (INR) — used when valuationMethod = "by_tree_capacity". */
  perTreeValue: real("per_tree_value"),
  /** Free-text remarks recorded during LNV onboarding entry. */
  landNotionalValueRemarks: text("land_notional_value_remarks"),

  // ── Governance model ─────────────────────────────────────────────────
  /**
   * Master behavioral controller.  All downstream modules (LCA, ownership
   * engine, revenue distribution, land value accounting) derive permitted
   * operations from this field.  Immutable after activation.
   */
  commercialModel: projectCommercialModelEnum("commercial_model")
    .notNull()
    .default("ownership_contribution"),

  // ── Status / lifecycle ───────────────────────────────────────────────
  status: projectStatusEnum("status").notNull().default("planning"),
  lifecycleStatus: projectLifecycleStatusEnum("lifecycle_status")
    .notNull()
    .default("prematurity"),
  /**
   * Activation workflow status.  Only 'active' projects may process
   * production, sales, or accounting entries.
   * Existing projects default to 'active' to preserve current behaviour.
   */
  activationStatus: projectActivationStatusEnum("activation_status")
    .notNull()
    .default("active"),

  // ── Timeline ────────────────────────────────────────────────────────
  startDate: text("start_date").notNull(),
  expectedMaturityDate: text("expected_maturity_date"),
  termYears: integer("term_years").notNull().default(35),

  // ── Land type & survey details ───────────────────────────────────────
  /** recorded | non_recorded */
  landType: text("land_type"),

  // Recorded land fields
  khatianNumber: text("khatian_number"),
  plotNumber: text("plot_number"),
  mouja: text("mouja"),
  tahsil: text("tahsil"),
  revenueCircle: text("revenue_circle"),
  subDivision: text("sub_division"),

  // Non-recorded land fields
  landAreaName: text("land_area_name"),
  postOffice: text("post_office"),
  policeStation: text("police_station"),

  // Common land fields
  landBoundaryDescription: text("land_boundary_description"),
  gpsCoordinates: text("gps_coordinates"),

  // ── Capacity ──────────────────────────────────────────────────────────
  rubberCapacity: integer("rubber_capacity"),
  /** trees | hectares | acres */
  rubberCapacityUnit: text("rubber_capacity_unit").default("trees"),

  // ── LCA onboarding record ─────────────────────────────────────────────
  /**
   * Always recorded during onboarding regardless of commercial model.
   * Under fifty_percent_revenue: stored only, never activates.
   * If model migrates to ownership_contribution later, these become the
   * seed values for the LCA config.
   */
  lcaBaseAmount: decimal("lca_base_amount", { precision: 15, scale: 2 }),
  lcaEscalationPct: decimal("lca_escalation_pct", { precision: 5, scale: 2 }),

  // ── Agreement onboarding record ───────────────────────────────────────
  agreementType: text("agreement_type"),
  agreementEffectiveDate: text("agreement_effective_date"),
  agreementDurationYears: integer("agreement_duration_years"),
  agreementSpecialTerms: text("agreement_special_terms"),

  // ── Onboarding wizard progress ───────────────────────────────────────
  /** Current wizard step (1–10). Null means wizard not yet started. */
  onboardingStep: integer("onboarding_step").default(1),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),

  // ── Landowner Governance ─────────────────────────────────────────────────
  /**
   * Top-level configuration validity — computed automatically whenever
   * landowner participants change.  INVALID_PROJECT_CONFIGURATION projects
   * have governanceLocked=true and all write operations are blocked.
   */
  configurationStatus: projectConfigurationStatusEnum("configuration_status")
    .notNull()
    .default("VALID"),
  /** Short machine-readable reason code, e.g. "MISSING_LANDOWNER". */
  invalidReason: text("invalid_reason"),
  /**
   * When TRUE every operational write route (production, sales, LCA, etc.)
   * rejects with HTTP 423 until an admin resolves the invalidity.
   */
  governanceLocked: boolean("governance_locked").notNull().default(false),
  /** Set TRUE whenever an admin-initiated repair workflow is needed. */
  remediationRequired: boolean("remediation_required").notNull().default(false),
  /** Detailed landowner linkage state. */
  landownerValidationStatus: projectLandownerValidationStatusEnum(
    "landowner_validation_status",
  )
    .notNull()
    .default("PENDING"),

  // ── Misc ─────────────────────────────────────────────────────────────
  notes: text("notes"),
  ownershipFrozenAt: timestamp("ownership_frozen_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => [
  // Partial unique on project_code so multiple drafts with no code can coexist
  // while still preventing duplicate assigned codes.
  uniqueIndex("projects_project_code_uq")
    .on(t.projectCode)
    .where(sql`${t.projectCode} IS NOT NULL`),
]);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

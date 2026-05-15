import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  projectStatusEnum,
  projectLifecycleStatusEnum,
  projectCommercialModelEnum,
  projectActivationStatusEnum,
} from "./enums";
import { usersTable } from "./users";

export const projectsTable = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── Identity ────────────────────────────────────────────────────────
  name: text("name").notNull(),
  /** Short unique code (e.g. "HP-001"). Immutable after project activation. */
  projectCode: text("project_code").unique(),
  description: text("description"),

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
   * Only applicable for ownership_contribution model.
   */
  landNotionalValue: real("land_notional_value"),
  landValuePerUnit: real("land_value_per_unit"),

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

  // ── Misc ─────────────────────────────────────────────────────────────
  notes: text("notes"),
  ownershipFrozenAt: timestamp("ownership_frozen_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

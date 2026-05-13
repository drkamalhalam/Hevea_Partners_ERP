import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { agreementsTable } from "./agreements";

/**
 * lcaConfigsTable — Land Contribution Adjustment configuration per project.
 *
 * Business rules enforced here and in the API layer:
 *   1. LCA applies ONLY to projects in `mature_production` lifecycle phase.
 *   2. LCA applies ONLY to agreements with revenueModel = 'contribution'.
 *      It is NOT applicable to the 50% revenue-sharing model.
 *   3. Only one active config is allowed per project at a time.
 *   4. LCA is a recurring annual project cost, separate from ownership
 *      contributions and separate from profit distribution.
 *   5. `startYear` is derived from `effectiveStartDate` at INSERT time and
 *      stored explicitly to avoid repeated date-parsing in escalation math.
 *   6. Soft-disable only: `isActive = false`. Records are never deleted.
 */
export const lcaConfigsTable = pgTable("lca_configs", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  agreementId: uuid("agreement_id").references(() => agreementsTable.id, {
    onDelete: "set null",
  }),

  baseAmount: real("base_amount").notNull(),

  escalationPct: real("escalation_pct").notNull().default(0),

  effectiveStartDate: text("effective_start_date").notNull(),

  startYear: integer("start_year").notNull(),

  notes: text("notes"),

  isActive: boolean("is_active").notNull().default(true),

  createdById: uuid("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  createdByName: text("created_by_name").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
import { lcaConfigsTable } from "./lca_configs";
import { lcaLedgerStatusEnum } from "./enums";

/**
 * lcaLedgerTable — yearly LCA payment records.
 *
 * Escalation logic (enforced in the API layer):
 *   year 0 (startYear)  → grossDue = baseAmount * 1.0
 *   year 1              → grossDue = baseAmount * (1 + esc/100)^1
 *   year N              → grossDue = baseAmount * (1 + esc/100)^N
 *
 * Carry-forward rule:
 *   carryForward = previous year's balance (totalDue − amountPaid)
 *   Carried-forward amounts do NOT attract additional escalation.
 *   totalDue = grossDue + carryForward
 *
 * balance is stored (= totalDue − amountPaid) and updated on every PATCH.
 * Records are WRITE-ONCE except for payment status updates (PATCH only).
 */
export const lcaLedgerTable = pgTable("lca_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),

  configId: uuid("config_id")
    .notNull()
    .references(() => lcaConfigsTable.id, { onDelete: "restrict" }),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  year: integer("year").notNull(),

  baseAmount: real("base_amount").notNull(),

  escalationFactor: real("escalation_factor").notNull().default(1.0),

  grossDue: real("gross_due").notNull(),

  carryForward: real("carry_forward").notNull().default(0),

  totalDue: real("total_due").notNull(),

  amountPaid: real("amount_paid").notNull().default(0),

  balance: real("balance").notNull(),

  status: lcaLedgerStatusEnum("status").notNull().default("pending"),

  paidAt: text("paid_at"),

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

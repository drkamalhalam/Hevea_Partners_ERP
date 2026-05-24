import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { numericFlex } from "../numericFlex";
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

  baseAmount: numericFlex("base_amount", { precision: 15, scale: 2 }).notNull(),

  escalationFactor: numericFlex("escalation_factor", { precision: 12, scale: 6 })
    .notNull()
    .default(1.0),

  grossDue: numericFlex("gross_due", { precision: 15, scale: 2 }).notNull(),

  carryForward: numericFlex("carry_forward", { precision: 15, scale: 2 })
    .notNull()
    .default(0),

  totalDue: numericFlex("total_due", { precision: 15, scale: 2 }).notNull(),

  amountPaid: numericFlex("amount_paid", { precision: 15, scale: 2 })
    .notNull()
    .default(0),

  balance: numericFlex("balance", { precision: 15, scale: 2 }).notNull(),

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

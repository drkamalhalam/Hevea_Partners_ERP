import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { salesOrdersTable } from "./sales_orders";

/**
 * money_custody_ledger — tracks who physically holds project sale proceeds.
 *
 * A new record is created whenever a confirmed sale proceeds are received
 * (online transfer or cash). The holder is the payment receiver.
 *
 * depositedAmount + remaining should equal the original amount.
 * Cash aging warnings are computed from receivedDate.
 *
 * sourceType: sales_order | adjustment | deposit | withdrawal
 */
export const moneyCustodyLedgerTable = pgTable("money_custody_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),
  projectName: text("project_name").notNull().default(""),

  holderUserId: uuid("holder_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  holderName: text("holder_name").notNull().default(""),
  holderRole: text("holder_role").notNull().default(""),

  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  paymentMode: text("payment_mode").notNull().default("online"),
  // online | cash

  sourceType: text("source_type").notNull().default("sales_order"),
  // sales_order | adjustment | deposit | withdrawal

  sourceReference: uuid("source_reference").references(
    () => salesOrdersTable.id,
    { onDelete: "set null" },
  ),
  sourceCode: text("source_code"),

  receivedDate: date("received_date").notNull(),

  depositedAmount: numeric("deposited_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  remainingBalance: numeric("remaining_balance", { precision: 15, scale: 2 }).notNull(),

  depositedAt: timestamp("deposited_at", { withTimezone: true }),
  depositedById: uuid("deposited_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  depositedByName: text("deposited_by_name"),

  depositReference: text("deposit_reference"),
  // Bank reference / challan number when depositing to project account

  isClosed: boolean("is_closed").notNull().default(false),
  notes: text("notes"),

  createdById: uuid("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

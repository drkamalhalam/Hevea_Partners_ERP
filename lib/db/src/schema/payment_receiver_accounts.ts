import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * payment_receiver_accounts — approved accounts that can receive sale payments.
 *
 * Sellers may ONLY select an account from this list — no free-text entry.
 * Each account is scoped to a project and linked to an owner user.
 *
 * Payment types:
 *   upi       — UPI ID or QR-linked VPA
 *   bank      — bank account (IFSC + account number)
 *   cash      — physical cash (no identifier needed)
 *   other     — catch-all
 */
export const paymentReceiverAccountsTable = pgTable(
  "payment_receiver_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull().default(""),

    ownerUserId: uuid("owner_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    ownerName: text("owner_name").notNull().default(""),
    ownerRole: text("owner_role").notNull().default(""),

    accountName: text("account_name").notNull(),
    paymentType: text("payment_type").notNull().default("upi"),
    // upi | bank | cash | other

    accountIdentifier: text("account_identifier"),
    // UPI ID, bank account number, etc. Null for cash.

    bankIfsc: text("bank_ifsc"),
    bankName: text("bank_name"),

    allowedPaymentModes: text("allowed_payment_modes").notNull().default("both"),
    // online_only | cash_only | both

    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),

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
  },
);

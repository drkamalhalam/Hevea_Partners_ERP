import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * central_payment_accounts — system-wide payment receiving account configuration.
 *
 * Only one account can be active at a time (isActive = true).
 * Razorpay secret is stored AES-256-GCM encrypted and never returned in API responses.
 * Changes create write-once audit entries in central_payment_account_audit.
 */
export const centralPaymentAccountsTable = pgTable("central_payment_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),

  displayName: text("display_name").notNull().default("Main Payment Account"),

  businessName: text("business_name"),
  accountHolderName: text("account_holder_name"),

  bankName: text("bank_name"),
  branchName: text("branch_name"),
  accountNumber: text("account_number"),
  ifscCode: text("ifsc_code"),

  upiId: text("upi_id"),
  merchantName: text("merchant_name"),

  razorpayKeyId: text("razorpay_key_id"),
  razorpaySecretEncrypted: text("razorpay_secret_encrypted"),
  // Stored as iv_hex:authTag_hex:data_hex — never exposed via API

  paymentCallbackUrl: text("payment_callback_url"),
  supportPhone: text("support_phone"),
  supportEmail: text("support_email"),

  isActive: boolean("is_active").notNull().default(false),

  notes: text("notes"),

  createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  updatedById: uuid("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name").notNull().default(""),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * central_payment_account_audit — immutable audit log for all changes.
 * No UPDATE or DELETE routes exist for this table.
 */
export const centralPaymentAccountAuditTable = pgTable("central_payment_account_audit", {
  id: uuid("id").primaryKey().defaultRandom(),

  accountId: uuid("account_id"),
  // FK kept soft (no constraint) so audit survives account deletion

  action: text("action").notNull(),
  // created | updated | activated | deactivated

  changedById: uuid("changed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  changedByName: text("changed_by_name").notNull().default(""),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),

  ipAddress: text("ip_address"),

  // JSON blob: { fieldName: { old: masked_value, new: masked_value } }
  changes: jsonb("changes"),
});

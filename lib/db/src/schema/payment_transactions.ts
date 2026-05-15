import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { salesOrdersTable } from "./sales_orders";

/**
 * payment_transactions — one record per payment event detected against a sales order.
 *
 * A detected payment does NOT equal a confirmed payment.
 * Confirmation requires a manual action by an authorized user.
 *
 * verificationStatus:
 *   detected  — callback received, amount may or may not match
 *   matched   — amount matches order total
 *   mismatched — amount does not match (under/over payment)
 *   confirmed — manually verified and approved
 *   rejected  — manually rejected (wrong payment, fraud, etc.)
 */
export const paymentTransactionsTable = pgTable("payment_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),

  salesOrderId: uuid("sales_order_id")
    .notNull()
    .references(() => salesOrdersTable.id, { onDelete: "cascade" }),

  transactionReference: text("transaction_reference"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentProvider: text("payment_provider").notNull().default("manual"),
  // manual | upi | razorpay | paytm | neft | rtgs | cash

  callbackPayload: jsonb("callback_payload"),
  detectedAt: timestamp("detected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  verificationStatus: text("verification_status").notNull().default("detected"),
  // detected | matched | mismatched | confirmed | rejected

  manuallyConfirmedById: uuid("manually_confirmed_by_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  manuallyConfirmedByName: text("manually_confirmed_by_name"),
  manuallyConfirmedAt: timestamp("manually_confirmed_at", {
    withTimezone: true,
  }),

  rejectionReason: text("rejection_reason"),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

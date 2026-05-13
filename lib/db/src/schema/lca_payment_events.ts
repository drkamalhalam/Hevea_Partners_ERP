import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { lcaConfigsTable } from "./lca_configs";
import { lcaLedgerTable } from "./lca_ledger";

/**
 * lcaPaymentEventsTable — individual payment transactions against a yearly
 * LCA ledger entry. Append-only: payments are never deleted or reversed.
 *
 * Multiple payments may exist per ledger entry (partial-then-final pattern).
 * The ledger entry's `amountPaid` and `balance` are updated atomically when
 * a payment event is recorded, so both tables stay in sync.
 *
 * To reverse a payment, record a corrective negative-amount event and update
 * the ledger entry accordingly (admin workflow, not automated here).
 */
export const lcaPaymentEventsTable = pgTable("lca_payment_events", {
  id: uuid("id").defaultRandom().primaryKey(),

  ledgerEntryId: uuid("ledger_entry_id")
    .notNull()
    .references(() => lcaLedgerTable.id, { onDelete: "restrict" }),

  configId: uuid("config_id")
    .notNull()
    .references(() => lcaConfigsTable.id, { onDelete: "restrict" }),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "restrict" }),

  year: integer("year").notNull(),

  amountPaid: real("amount_paid").notNull(),

  paymentDate: text("payment_date").notNull(),

  paymentRef: text("payment_ref"),

  notes: text("notes"),

  recordedById: uuid("recorded_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  recordedByName: text("recorded_by_name").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

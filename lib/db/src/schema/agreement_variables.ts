import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { agreementsTable } from "./agreements";

export const agreementVariableValuesTable = pgTable(
  "agreement_variable_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreementsTable.id, { onDelete: "cascade" }),
    variableName: text("variable_name").notNull(),
    resolvedValue: text("resolved_value"),
    overrideValue: text("override_value"),
    dataSourceType: text("data_source_type"),
    isAutoResolved: boolean("is_auto_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("uq_agreement_variable").on(t.agreementId, t.variableName)],
);

export type AgreementVariableValue =
  typeof agreementVariableValuesTable.$inferSelect;

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { documentVariableSourceTypeEnum } from "./enums";

/**
 * document_variable_registry — central definition of every {{TOKEN}} that
 * any document template may use. The registry is the single source of truth
 * for placeholder names, their data source, and their resolution path.
 *
 * Every placeholder used in any template MUST have a registry entry.
 * Template activation is gated on all detected placeholders being mapped.
 *
 * No business logic is implemented here; this layer only declares what
 * variables exist and where their values originate. Future resolvers consume
 * these rows to populate values at generation time.
 */
export const documentVariableRegistryTable = pgTable(
  "document_variable_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variableKey: text("variable_key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    sourceType: documentVariableSourceTypeEnum("source_type").notNull(),
    sourceField: text("source_field"),
    dataType: text("data_type").notNull().default("string"),
    isRequired: boolean("is_required").notNull().default(false),
    exampleValue: text("example_value"),
    groupName: text("group_name"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("uq_document_variable_key").on(t.variableKey)],
);

export type DocumentVariableRegistryEntry =
  typeof documentVariableRegistryTable.$inferSelect;

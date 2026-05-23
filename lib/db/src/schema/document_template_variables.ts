import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { agreementTemplatesTable } from "./templates";
import { documentTemplateVariableStatusEnum } from "./enums";

/**
 * document_template_variables — per-template placeholder mapping table.
 *
 * Populated when a template is parsed: one row per unique {{TOKEN}} detected
 * inside the DOCX. The `status` column reflects how the placeholder relates
 * to the central Document Variable Registry at the time of last parse:
 *
 *   mapped  — placeholder is in template AND in registry
 *   missing — registry marks this token as required for the category, but the
 *             token is NOT present in the template
 *   invalid — placeholder is syntactically malformed (rare; reserved)
 *   unused  — placeholder is in template but not in registry (no resolver)
 *
 * Activation requires zero rows with status = unused or invalid AND zero
 * required-missing entries for the template's category.
 */
export const documentTemplateVariablesTable = pgTable(
  "document_template_variables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => agreementTemplatesTable.id, { onDelete: "cascade" }),
    variableKey: text("variable_key").notNull(),
    status: documentTemplateVariableStatusEnum("status").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("uq_template_variable").on(t.templateId, t.variableKey)],
);

export type DocumentTemplateVariable =
  typeof documentTemplateVariablesTable.$inferSelect;

import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { agreementsTable } from "./agreements";
import { agreementTemplatesTable } from "./templates";

/**
 * Immutable snapshot of every generated agreement document.
 *
 * Each row is a permanent historical record capturing:
 *  - Which agreement and template were used
 *  - The complete set of variable values at the moment of generation
 *    (stored as JSONB so future template changes cannot alter old records)
 *  - A reference to the permanently stored DOCX file in GCS
 *
 * Rows in this table MUST NEVER be modified or deleted through the application
 * once created.  The only permitted operation is INSERT.
 */
export const agreementGenerationsTable = pgTable("agreement_generations", {
  id: uuid("id").defaultRandom().primaryKey(),

  agreementId: uuid("agreement_id")
    .notNull()
    .references(() => agreementsTable.id, { onDelete: "restrict" }),

  // Template FK is nullable so historical records survive template deletion.
  templateId: uuid("template_id").references(
    () => agreementTemplatesTable.id,
    { onDelete: "set null" },
  ),

  // Denormalised template info — snapshot of the template at generation time.
  templateName: text("template_name").notNull(),
  templateVersion: text("template_version"),

  // Complete key→value map of ALL variable effective values at generation time.
  // effectiveValue = overrideValue ?? resolvedValue for each variable.
  variableSnapshot: jsonb("variable_snapshot")
    .notNull()
    .$type<Record<string, string>>(),

  // Path in object storage to the permanently stored generated DOCX.
  // Null if generation succeeded but file storage failed (rare).
  fileObjectPath: text("file_object_path"),

  // Audit fields — denormalised name survives user deletion.
  generatedBy: uuid("generated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  generatedByName: text("generated_by_name"),

  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  notes: text("notes"),
});

export type AgreementGeneration =
  typeof agreementGenerationsTable.$inferSelect;

/**
 * Seed the Document Variable Registry from the legacy in-memory
 * VARIABLE_REGISTRY constant on API server boot. Idempotent: existing rows
 * are preserved, only missing keys are inserted. This preserves backward
 * compatibility with the existing agreement workflow while bringing every
 * known variable into the central registry table.
 */

import { db, documentVariableRegistryTable } from "@workspace/db";
import { VARIABLE_REGISTRY, type VariableDefinition } from "./variableRegistry";
import { logger } from "./logger";

type SourceType =
  | "project_field"
  | "person_field"
  | "schedule_a_field"
  | "agreement_field"
  | "calculated"
  | "system_generated";

function mapSource(def: VariableDefinition): SourceType {
  switch (def.dataSource) {
    case "project":
      return "project_field";
    case "partner":
      return "person_field";
    case "agreement":
      return "agreement_field";
    case "ownership":
      return "agreement_field";
    case "manual":
    default:
      return "system_generated";
  }
}

export async function seedDocumentVariableRegistry(): Promise<void> {
  const entries = Object.values(VARIABLE_REGISTRY);
  if (entries.length === 0) return;
  const values = entries.map((def) => ({
    variableKey: def.name,
    label: def.label,
    description: def.description,
    sourceType: mapSource(def),
    sourceField: def.fieldPath ?? null,
    dataType: "string",
    isRequired: true,
    exampleValue: def.example,
    groupName: def.group,
  }));
  const result = await db
    .insert(documentVariableRegistryTable)
    .values(values)
    .onConflictDoNothing({ target: documentVariableRegistryTable.variableKey })
    .returning({ id: documentVariableRegistryTable.id });
  if (result.length > 0) {
    logger.info(
      { inserted: result.length },
      "[seedDocumentVariableRegistry] seeded legacy variables",
    );
  }
}

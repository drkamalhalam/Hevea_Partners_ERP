/**
 * Variable Resolver
 *
 * Resolves agreement template variables by pulling values from the
 * linked project, partner, and agreement records.
 *
 * This module is intentionally free of business calculations.
 * It performs direct field reads and formats them for legal documents
 * using the shared formatters utility.
 *
 * To add resolution logic for a new variable:
 *   1. Add its definition to variableRegistry.ts
 *   2. Add a case to resolveVariable() below
 */

import type { InferSelectModel } from "drizzle-orm";
import type { agreementsTable } from "@workspace/db";
import { db, projectsTable, partnersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { VARIABLE_REGISTRY, type VariableDataSource } from "./variableRegistry";
import {
  legalDate,
  formatINR,
  formatRupeesLegal,
  landAreaLegal,
  ownershipShareLegal,
  escalationLegal,
} from "./formatters";

type Agreement = InferSelectModel<typeof agreementsTable>;

export interface ResolvedVariable {
  name: string;
  value: string | null;
  dataSourceType: VariableDataSource;
  isAutoResolved: boolean;
}

/**
 * Auto-resolve all variables for a given agreement.
 * Fetches project and partner data from the DB.
 * Returns one ResolvedVariable per known registry entry.
 */
export async function resolveAgreementVariables(
  agreement: Agreement,
): Promise<ResolvedVariable[]> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, agreement.projectId));

  const [landOwner] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, agreement.landOwnerId));

  const [developer] = await db
    .select()
    .from(partnersTable)
    .where(eq(partnersTable.id, agreement.projectDeveloperId));

  const results: ResolvedVariable[] = [];

  for (const def of Object.values(VARIABLE_REGISTRY)) {
    const value = resolveVariable(
      def.name,
      agreement,
      project,
      landOwner,
      developer,
    );
    results.push({
      name: def.name,
      value,
      dataSourceType: def.dataSource,
      isAutoResolved: value !== null,
    });
  }

  return results;
}

function resolveVariable(
  name: string,
  agreement: Agreement,
  project: InferSelectModel<typeof projectsTable> | undefined,
  landOwner: InferSelectModel<typeof partnersTable> | undefined,
  developer: InferSelectModel<typeof partnersTable> | undefined,
): string | null {
  switch (name) {
    // ── Project fields ──────────────────────────────────────────────────────
    case "PROJECT_NAME":
      return project?.name ?? null;
    case "PROJECT_LOCATION":
      return (project as { location?: string } | undefined)?.location ?? null;

    // ── Partner fields ──────────────────────────────────────────────────────
    case "LANDOWNER_NAME":
      return landOwner?.name ?? null;
    case "DEVELOPER_NAME":
      return developer?.name ?? null;
    case "LANDOWNER_ADDRESS":
      return landOwner?.address ?? null;
    case "DEVELOPER_ADDRESS":
      return developer?.address ?? null;

    // ── Agreement date/place fields ─────────────────────────────────────────
    case "DATE":
      return agreement.executionDate
        ? legalDate(agreement.executionDate)
        : null;
    case "EXECUTION_PLACE":
      return agreement.executionPlace ?? null;

    // ── Agreement numeric fields ────────────────────────────────────────────
    case "TERM_YEARS":
      return agreement.termYears != null ? String(agreement.termYears) : null;

    case "LAND_AREA":
      return landAreaLegal(agreement.landArea, agreement.landAreaUnit);

    case "OWNERSHIP_SHARE":
      return ownershipShareLegal(agreement.ownershipShareLandowner);

    case "DEVELOPER_OWNERSHIP_SHARE":
      return ownershipShareLegal(agreement.ownershipShareDeveloper);

    case "LAND_VALUE_PER_UNIT":
      return formatINR(agreement.landValuePerUnit);

    case "NOTIONAL_LAND_VALUE":
      return formatINR(agreement.landNotionalValue);

    // Auto-computed from NOTIONAL_LAND_VALUE — full legal rupee expression.
    case "AMOUNT_IN_WORDS":
      return agreement.landNotionalValue != null
        ? formatRupeesLegal(agreement.landNotionalValue)
        : null;

    case "YEARLY_ESCALATION":
      return escalationLegal(agreement.yearlyEscalation);

    case "REVENUE_MODEL":
      return agreement.revenueModel
        ? agreement.revenueModel.charAt(0).toUpperCase() +
            agreement.revenueModel.slice(1)
        : null;

    default:
      return null;
  }
}

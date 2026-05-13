/**
 * Agreement Variable Registry
 *
 * Defines every placeholder supported in agreement templates.
 * Each entry maps a {{VARIABLE_NAME}} token to its human-readable label,
 * the data source it is derived from, and an example value for preview.
 *
 * To add a new variable:
 *   1. Add an entry to VARIABLE_REGISTRY
 *   2. Add resolution logic to variableResolver.ts
 *   3. Use {{VARIABLE_NAME}} in the DOCX template
 */

export type VariableDataSource =
  | "project" // resolved from the linked projectsTable row
  | "partner" // resolved from a linked partnersTable row
  | "agreement" // resolved from the agreementsTable row itself
  | "ownership" // resolved from ownership / assignment data
  | "manual"; // must be entered manually (no automatic source)

export interface VariableDefinition {
  name: string;
  label: string;
  description: string;
  dataSource: VariableDataSource;
  fieldPath?: string;
  example: string;
  group: "project" | "parties" | "financial" | "dates" | "other";
}

export const VARIABLE_REGISTRY: Record<string, VariableDefinition> = {
  PROJECT_NAME: {
    name: "PROJECT_NAME",
    label: "Project Name",
    description: "Full name of the rubber plantation project",
    dataSource: "project",
    fieldPath: "name",
    example: "Manu Valley Plantation",
    group: "project",
  },
  PROJECT_LOCATION: {
    name: "PROJECT_LOCATION",
    label: "Project Location",
    description: "Location / village of the plantation site",
    dataSource: "project",
    fieldPath: "location",
    example: "Manu, West Tripura",
    group: "project",
  },
  LANDOWNER_NAME: {
    name: "LANDOWNER_NAME",
    label: "Landowner Name",
    description: "Full name of the landowner (Second Party)",
    dataSource: "partner",
    fieldPath: "landOwner.name",
    example: "Sukumar Tripura",
    group: "parties",
  },
  DEVELOPER_NAME: {
    name: "DEVELOPER_NAME",
    label: "Developer Name",
    description: "Full name of the project developer (First Party)",
    dataSource: "partner",
    fieldPath: "developer.name",
    example: "Hevea Partners Pvt. Ltd.",
    group: "parties",
  },
  LANDOWNER_ADDRESS: {
    name: "LANDOWNER_ADDRESS",
    label: "Landowner Address",
    description: "Registered address of the landowner",
    dataSource: "partner",
    fieldPath: "landOwner.address",
    example: "Village Manu, P.O. Manu, West Tripura – 799 290",
    group: "parties",
  },
  DEVELOPER_ADDRESS: {
    name: "DEVELOPER_ADDRESS",
    label: "Developer Address",
    description: "Registered address of the project developer",
    dataSource: "partner",
    fieldPath: "developer.address",
    example: "Agartala, Tripura – 799 001",
    group: "parties",
  },
  DATE: {
    name: "DATE",
    label: "Execution Date",
    description:
      'Date on which the agreement is executed — formatted as "13th day of May, 2026"',
    dataSource: "agreement",
    fieldPath: "executionDate",
    example: "13th day of May, 2026",
    group: "dates",
  },
  EXECUTION_PLACE: {
    name: "EXECUTION_PLACE",
    label: "Execution Place",
    description: "Place where the agreement is signed",
    dataSource: "agreement",
    fieldPath: "executionPlace",
    example: "Agartala, Tripura",
    group: "dates",
  },
  TERM_YEARS: {
    name: "TERM_YEARS",
    label: "Agreement Term (Years)",
    description: "Duration of the agreement in years",
    dataSource: "agreement",
    fieldPath: "termYears",
    example: "35",
    group: "financial",
  },
  LAND_AREA: {
    name: "LAND_AREA",
    label: "Land Area",
    description: 'Area of land covered by this agreement — e.g. "2.50 Kani"',
    dataSource: "agreement",
    fieldPath: "landArea",
    example: "2.50 Kani",
    group: "financial",
  },
  OWNERSHIP_SHARE: {
    name: "OWNERSHIP_SHARE",
    label: "Landowner Ownership Share",
    description:
      'Post-maturity ownership percentage for the landowner — e.g. "15.00% (Fifteen Percent)"',
    dataSource: "agreement",
    fieldPath: "ownershipShareLandowner",
    example: "15.00% (Fifteen Percent)",
    group: "financial",
  },
  DEVELOPER_OWNERSHIP_SHARE: {
    name: "DEVELOPER_OWNERSHIP_SHARE",
    label: "Developer Ownership Share",
    description:
      'Post-maturity ownership percentage for the developer — e.g. "85.00% (Eighty-Five Percent)"',
    dataSource: "agreement",
    fieldPath: "ownershipShareDeveloper",
    example: "85.00% (Eighty-Five Percent)",
    group: "financial",
  },
  LAND_VALUE_PER_UNIT: {
    name: "LAND_VALUE_PER_UNIT",
    label: "Land Value Per Unit",
    description: 'Agreed value per unit (kani) of land — e.g. "Rs. 50,000/-"',
    dataSource: "agreement",
    fieldPath: "landValuePerUnit",
    example: "Rs. 50,000/-",
    group: "financial",
  },
  NOTIONAL_LAND_VALUE: {
    name: "NOTIONAL_LAND_VALUE",
    label: "Notional Land Value",
    description: 'Total notional value of the land parcel — e.g. "Rs. 1,25,000/-"',
    dataSource: "agreement",
    fieldPath: "landNotionalValue",
    example: "Rs. 1,25,000/-",
    group: "financial",
  },
  AMOUNT_IN_WORDS: {
    name: "AMOUNT_IN_WORDS",
    label: "Amount in Words",
    description:
      'Notional land value written in full legal form — auto-computed from Notional Land Value; e.g. "Rs. 1,25,000/- (Rupees One Lakh Twenty-Five Thousand Only)"',
    dataSource: "agreement",
    fieldPath: "landNotionalValue",
    example: "Rs. 1,25,000/- (Rupees One Lakh Twenty-Five Thousand Only)",
    group: "financial",
  },
  YEARLY_ESCALATION: {
    name: "YEARLY_ESCALATION",
    label: "Yearly Escalation",
    description:
      'Annual escalation percentage on land contribution — e.g. "5% per annum"',
    dataSource: "agreement",
    fieldPath: "yearlyEscalation",
    example: "5% per annum",
    group: "financial",
  },
  REVENUE_MODEL: {
    name: "REVENUE_MODEL",
    label: "Revenue Model",
    description: "Revenue sharing model type",
    dataSource: "agreement",
    fieldPath: "revenueModel",
    example: "Contribution",
    group: "other",
  },
};

/** Returns all variable names found in a template text string. */
export function getKnownVariableNames(): string[] {
  return Object.keys(VARIABLE_REGISTRY);
}

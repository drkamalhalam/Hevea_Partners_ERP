/**
 * Legal Document Generator
 *
 * Generates a filled DOCX document by substituting {{VARIABLE_NAME}} placeholders
 * in a stored template with the agreement's resolved variable values.
 *
 * Rules:
 *   - Only DOCX templates are supported (PDF templates cannot be modified in-place).
 *   - effectiveValue = overrideValue ?? resolvedValue  (override takes precedence)
 *   - Unresolved variables render as [PENDING: VARIABLE_NAME] so the operator knows
 *     which fields still need values before sending the document.
 *   - All other formatting (numbering, tables, signatures, page layout) is preserved
 *     exactly — docxtemplater modifies only the tagged tokens inside the ZIP XML.
 */

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { db } from "@workspace/db";
import {
  agreementsTable,
  agreementTemplatesTable,
  agreementVariableValuesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

const objectStorageService = new ObjectStorageService();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateDocumentOptions {
  agreementId: string;
  templateId: string;
}

export interface GenerateDocumentResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export class DocumentGenerationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "DocumentGenerationError";
    Object.setPrototypeOf(this, DocumentGenerationError.prototype);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Stream a GCS file to a Buffer so docxtemplater can load it as a ZIP.
 */
async function fetchTemplateBuffer(fileObjectPath: string): Promise<Buffer> {
  const objectFile =
    await objectStorageService.getObjectEntityFile(fileObjectPath);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = objectFile.createReadStream();
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Build the variable substitution map from DB-stored variable values.
 * Resolution order: overrideValue > resolvedValue > empty string fallback.
 * An empty-string fallback keeps the document structurally intact while making
 * the gap obvious (the caller's nullGetter will render [PENDING: …] instead).
 */
async function buildVariableData(
  agreementId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(agreementVariableValuesTable)
    .where(eq(agreementVariableValuesTable.agreementId, agreementId));

  const data: Record<string, string> = {};
  for (const row of rows) {
    const effective = row.overrideValue ?? row.resolvedValue;
    // Use undefined for genuinely missing values so nullGetter fires.
    if (effective !== null && effective !== undefined) {
      data[row.variableName] = effective;
    }
  }
  return data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a filled DOCX by substituting all {{VARIABLE}} tokens in the
 * chosen template with the agreement's effective variable values.
 *
 * Throws DocumentGenerationError with an appropriate HTTP status code on any
 * business-rule failure so the caller can map it directly to a response.
 */
export async function generateDocument({
  agreementId,
  templateId,
}: GenerateDocumentOptions): Promise<GenerateDocumentResult> {
  // 1. Verify the agreement exists.
  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(eq(agreementsTable.id, agreementId));

  if (!agreement) {
    throw new DocumentGenerationError("Agreement not found", 404);
  }

  // 2. Load template record.
  const [template] = await db
    .select()
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.id, templateId));

  if (!template) {
    throw new DocumentGenerationError("Template not found", 404);
  }
  if (!template.isActive) {
    throw new DocumentGenerationError(
      "Template is archived and cannot be used for generation. Restore it first.",
      422,
    );
  }
  if (template.fileFormat !== "docx") {
    throw new DocumentGenerationError(
      "PDF templates do not support variable substitution. " +
        "Please re-upload the template in DOCX format.",
      422,
    );
  }

  // 3. Fetch template binary from object storage.
  let templateBuffer: Buffer;
  try {
    templateBuffer = await fetchTemplateBuffer(template.fileObjectPath);
  } catch {
    throw new DocumentGenerationError(
      "Could not load template file from storage.",
      502,
    );
  }

  // 4. Build variable substitution data.
  const variableData = await buildVariableData(agreementId);

  // 5. Open DOCX as a ZIP and configure docxtemplater.
  //    - Delimiters: {{ }} to match the established {{VARIABLE_NAME}} convention.
  //    - paragraphLoop: keeps whitespace-only paragraphs intact (important for
  //      legal line spacing / indentation).
  //    - linebreaks: converts \n in values to <w:br/> (e.g. multi-line addresses).
  //    - nullGetter: renders missing variables as [PENDING: NAME] so the operator
  //      can see exactly which fields still need manual input.
  let doc: Docxtemplater;
  try {
    const zip = new PizZip(templateBuffer);
    doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter(part) {
        if (!part.value) return "";
        return `[PENDING: ${part.value}]`;
      },
    });
  } catch (err) {
    throw new DocumentGenerationError(
      "Template file is corrupt or not a valid DOCX.",
      422,
    );
  }

  // 6. Render (substitute all tokens).
  try {
    doc.render(variableData);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown substitution error";
    throw new DocumentGenerationError(
      `Document rendering failed: ${message}`,
      422,
    );
  }

  // 7. Produce the output buffer.
  const outputBuffer = doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  }) as Buffer;

  const timestamp = new Date()
    .toISOString()
    .replace(/T/, "_")
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const safeAgreementId = agreementId.slice(0, 8);
  const filename = `agreement_${safeAgreementId}_${timestamp}.docx`;

  return {
    buffer: outputBuffer,
    filename,
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

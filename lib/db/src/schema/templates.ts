import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import {
  templateFileFormatEnum,
  templateStatusEnum,
  documentTemplateCategoryEnum,
} from "./enums";

/**
 * agreement_templates — central Document Template Registry.
 *
 * Despite the legacy table name, this is the generic, multi-category template
 * registry that powers ALL document types (agreements, ownership records,
 * transfer docs, succession, inheritance, governance, notices, declarations,
 * certificates, and other). The `category` column drives single-active-per-
 * category enforcement on activation. Existing rows default to `agreement`.
 *
 * Lifecycle: draft → active → superseded | archived
 *   - draft      — uploaded, awaiting variable mapping validation
 *   - active     — validated; available for generation (only one per category)
 *   - superseded — replaced by a newer active version (preserved for audit)
 *   - archived   — withdrawn entirely
 */
export const agreementTemplatesTable = pgTable("agreement_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  documentDescription: text("document_description"),
  notes: text("notes"),
  version: text("version").notNull().default("1.0"),
  category: documentTemplateCategoryEnum("category")
    .notNull()
    .default("agreement"),
  fileObjectPath: text("file_object_path").notNull(),
  fileFormat: templateFileFormatEnum("file_format").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  status: templateStatusEnum("status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  uploadedBy: uuid("uploaded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  uploadedByName: text("uploaded_by_name"),
  activatedAt: timestamp("activated_at"),
  activatedBy: uuid("activated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  supersededAt: timestamp("superseded_at"),
  supersededBy: uuid("superseded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  supersededTemplateId: uuid("superseded_template_id").references(
    (): AnyPgColumn => agreementTemplatesTable.id,
    { onDelete: "set null" },
  ),
  archivedAt: timestamp("archived_at"),
  archivedBy: uuid("archived_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
}, (t) => [
  // At most one active template per category — enforced at DB level so two
  // concurrent activation requests cannot both end as `active`.
  uniqueIndex("agreement_templates_one_active_per_category")
    .on(t.category)
    .where(sql`${t.status} = 'active'`),
]);

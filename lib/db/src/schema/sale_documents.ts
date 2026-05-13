import {
  pgTable, uuid, text, integer, boolean, timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { salesTransactionsTable } from "./sales";

/**
 * sale_documents — attachments scoped to a sales transaction.
 *
 * Supported document types:
 *   invoice           — sale invoice / challan
 *   buyer_document    — buyer KYC, GST certificate, authorisation letter
 *   sales_proof       — weighment slip, delivery note, weigh bridge ticket
 *   operational_record — loading register, transport receipt, batch sheet
 *   other             — catch-all
 *
 * Files are stored in PRIVATE_OBJECT_DIR (GCS). The fileObjectPath
 * follows the same convention as templates and agreement documents:
 * presigned upload → client uploads → POST /sales/:id/documents with path.
 *
 * status: active | archived (soft-delete; records never physically deleted)
 */
export const saleDocumentsTable = pgTable("sale_documents", {
  id: uuid("id").primaryKey().defaultRandom(),

  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => salesTransactionsTable.id, { onDelete: "cascade" }),
  saleNumber: text("sale_number").notNull().default(""),

  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  documentType: text("document_type").notNull().default("other"),
  // invoice | buyer_document | sales_proof | operational_record | other

  title: text("title").notNull(),
  description: text("description"),

  fileObjectPath: text("file_object_path").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  originalFileName: text("original_file_name").notNull(),

  status: text("status").notNull().default("active"),
  // active | archived

  isActive: boolean("is_active").notNull().default(true),

  uploadedById: uuid("uploaded_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  uploadedByName: text("uploaded_by_name").notNull().default(""),

  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedById: uuid("archived_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  archivedByName: text("archived_by_name"),

  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

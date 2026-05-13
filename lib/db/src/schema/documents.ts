import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { agreementsTable } from "./agreements";
import {
  documentCategoryEnum,
  documentStatusEnum,
} from "./enums";

/**
 * documents — central repository for all stored files in the system.
 *
 * Access rules (enforced at API layer):
 *   admin, developer        → all documents regardless of project or category
 *   landowner, investor     → documents WHERE projectId IN userProjectIds
 *   employee, operational_staff → documents WHERE (
 *       projectId IN userProjectIds AND category IN ('operational', 'supporting')
 *     )
 *
 * Documents with projectId = NULL are global (e.g. governance templates,
 * system-level docs) and are visible only to admin/developer.
 */
export const documentsTable = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),

  title: text("title").notNull(),
  description: text("description"),

  category: documentCategoryEnum("category").notNull(),

  // Scope — both nullable; null projectId = global/system document
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  agreementId: uuid("agreement_id").references(() => agreementsTable.id, {
    onDelete: "set null",
  }),

  // Storage
  fileObjectPath: text("file_object_path").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  originalFileName: text("original_file_name").notNull(),

  // Lifecycle
  status: documentStatusEnum("status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),

  // Provenance
  uploadedBy: uuid("uploaded_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  uploadedByName: text("uploaded_by_name"),

  notes: text("notes"),

  // Archival
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: uuid("archived_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  // Soft delete
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Document = typeof documentsTable.$inferSelect;
export type InsertDocument = typeof documentsTable.$inferInsert;

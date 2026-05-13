import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { templateFileFormatEnum, templateStatusEnum } from "./enums";

export const agreementTemplatesTable = pgTable("agreement_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull().default("1.0"),
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
  archivedAt: timestamp("archived_at"),
  archivedBy: uuid("archived_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
});

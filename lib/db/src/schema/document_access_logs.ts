import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { documentsTable } from "./documents";
import { documentAccessActionEnum } from "./enums";

/**
 * document_access_logs — immutable audit trail for every document interaction.
 *
 * Written fire-and-forget (non-blocking) by the server on every:
 *   upload, view, download, archive, restore, delete, metadata_update
 *
 * This table is append-only. No updates or deletes should ever occur.
 */
export const documentAccessLogsTable = pgTable("document_access_logs", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Document reference — set null on delete so log is retained after deletion
  documentId: uuid("document_id").references(() => documentsTable.id, {
    onDelete: "set null",
  }),
  // Denormalized snapshot so log survives document deletion
  documentTitle: text("document_title").notNull(),
  documentCategory: text("document_category").notNull(),

  // Who did it
  userId: uuid("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  userDisplayName: text("user_display_name"),
  userRole: text("user_role"),

  // What they did
  action: documentAccessActionEnum("action").notNull(),

  // Project context (for quick filtering of project-scoped access logs)
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  // Extra payload (e.g. changed fields for metadata_update)
  metadata: jsonb("metadata"),

  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DocumentAccessLog = typeof documentAccessLogsTable.$inferSelect;

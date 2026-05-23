import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { agreementTemplatesTable } from "./templates";
import { usersTable } from "./users";
import { documentTemplateAuditEventEnum } from "./enums";

/**
 * document_template_audit — write-once lifecycle audit trail for every
 * template. Events include uploaded, parsed, mapping_updated,
 * metadata_updated, activated, superseded, archived, restored, downloaded,
 * and generated. The optional `payload` carries event-specific JSON
 * (e.g. number of detected placeholders, supersedes-template-id).
 *
 * No UPDATE or DELETE routes are exposed on this table.
 */
export const documentTemplateAuditTable = pgTable(
  "document_template_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => agreementTemplatesTable.id, { onDelete: "cascade" }),
    eventType: documentTemplateAuditEventEnum("event_type").notNull(),
    performedById: uuid("performed_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    performedByName: text("performed_by_name"),
    reason: text("reason"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type DocumentTemplateAuditEvent =
  typeof documentTemplateAuditTable.$inferSelect;

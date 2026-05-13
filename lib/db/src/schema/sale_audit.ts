import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { salesTransactionsTable } from "./sales";

/**
 * sale_audit_events — append-only compliance log for every create, update,
 * confirm, cancel, or sub-entity change on a sales transaction.
 *
 * Written synchronously at the application layer (not via DB triggers).
 * This table must never be updated or deleted.
 *
 * riskLevel:
 *   normal  — routine operation, no anomaly
 *   watch   — moderate anomaly; rate or quantity change > threshold
 *   flag    — high-risk anomaly; edit on confirmed sale, extreme rate change, etc.
 */
export const saleAuditEventsTable = pgTable("sale_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  transactionId: uuid("transaction_id").references(
    () => salesTransactionsTable.id,
    { onDelete: "set null" },
  ),
  saleNumber: text("sale_number").notNull().default(""),
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),

  eventType: text("event_type").notNull(),
  // created | updated | confirmed | cancelled
  // line_item_added | line_item_updated | line_item_removed
  // deduction_added | deduction_removed
  // document_uploaded | document_archived

  entityType: text("entity_type").notNull(),
  // transaction | line_item | deduction | document

  entityId: uuid("entity_id"),
  // ID of the specific line item / deduction / document that changed (null for transaction-level events)

  description: text("description").notNull(),
  // Human-readable summary: "Rate changed from ₹42.00 to ₹56.00 for rubber_sheet (33.3% increase)"

  fieldChanges: jsonb("field_changes"),
  // Array of { field: string, oldValue: string|number|null, newValue: string|number|null }

  riskLevel: text("risk_level").notNull().default("normal"),
  // normal | watch | flag

  riskReason: text("risk_reason"),
  // Why flagged, e.g. "Rate increased by 33.3% exceeds 15% threshold"

  actorId: uuid("actor_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  actorName: text("actor_name").notNull().default(""),
  actorRole: text("actor_role").notNull().default(""),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

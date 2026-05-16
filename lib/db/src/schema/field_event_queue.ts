import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

/**
 * field_event_queue — offline-safe buffer for field-submitted operational events.
 *
 * Field workers (operational_staff, employee) submit events from the field —
 * even when connectivity is poor. Events are stored here in their raw form
 * and processed by admins/developers into canonical ERP records once connectivity
 * is restored and the payload is validated.
 *
 * Event lifecycle:
 *   pending → processed  (admin accepts and creates the canonical record)
 *           → conflict   (duplicate or inconsistency detected)
 *           → rejected   (admin explicitly rejects with reason)
 *
 * Event types:
 *   quick_production   — daily production / latex collection entry
 *   quick_stock_intake — store intake (sheets, scrap, latex)
 *   quick_expense      — field expense / petty cash
 *   attendance_check   — worker attendance verification
 *   stock_audit        — physical stock count discrepancy report
 *   field_note         — general observation / governance note
 */
export const fieldEventQueueTable = pgTable("field_event_queue", {
  id: uuid("id").primaryKey().defaultRandom(),

  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  /** Denormalised for audit stability */
  projectName: text("project_name"),

  // ── Classification ────────────────────────────────────────────────────────
  eventType: text("event_type").notNull(),
  // quick_production | quick_stock_intake | quick_expense |
  // attendance_check | stock_audit | field_note

  /** Raw JSON payload as submitted from the field device */
  payload: jsonb("payload").notNull(),

  // ── Source tracking ───────────────────────────────────────────────────────
  submittedByUserId: uuid("submitted_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  /** Denormalised — captures submitter name even if user is later deactivated */
  submittedByName: text("submitted_by_name"),

  /**
   * When the event occurred on the device.
   * May differ from createdAt when the device was offline and synced later.
   */
  eventedAt: timestamp("evented_at", { withTimezone: true }).notNull(),

  /**
   * Client-generated deduplication key.
   * Recommended format: <deviceId>_<localSequenceNumber>
   * The API enforces uniqueness on this key to prevent double-posting on retry.
   */
  idempotencyKey: text("idempotency_key").unique(),

  // ── Processing ────────────────────────────────────────────────────────────
  status: text("status").notNull().default("pending"),
  // pending | processed | conflict | rejected

  /** Populated when status = conflict or rejected */
  conflictReason: text("conflict_reason"),

  processedAt: timestamp("processed_at", { withTimezone: true }),
  processedByUserId: uuid("processed_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  processedByName: text("processed_by_name"),

  /** UUID of the canonical ERP record created by processing this event */
  resultEntityId: uuid("result_entity_id"),
  /** e.g. "production_batch" | "inventory_stock_movement" | "contribution" */
  resultEntityType: text("result_entity_type"),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type FieldEventQueue = typeof fieldEventQueueTable.$inferSelect;
export type InsertFieldEventQueue = typeof fieldEventQueueTable.$inferInsert;

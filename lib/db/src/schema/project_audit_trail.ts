import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { projectAuditTrailEventEnum } from "./enums";

/**
 * project_audit_trail — UNIFIED, write-once audit log for everything that
 * happens to a project's *structure* and *governance* (not its day-to-day
 * operational data).
 *
 * Inserted by:
 *   - PATCH /projects/:id                       (project field changes)
 *   - POST/PUT/DELETE /projects/:id/parcels     (Schedule A mutations)
 *   - PUT /projects/:id/agreement-template      (template linkage)
 *   - Activation gate transitions               (draft → ready → active)
 *
 * Append-only. No UPDATE or DELETE routes are exposed.
 */
export const projectAuditTrailTable = pgTable(
  "project_audit_trail",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),

    eventType: projectAuditTrailEventEnum("event_type").notNull(),
    /** Free-text module hint, e.g. "project", "parcel", "agreement_template". */
    entityType: text("entity_type").notNull(),
    /** FK is informational only — record_id may belong to any child table. */
    entityId: uuid("entity_id"),

    title: text("title").notNull(),
    description: text("description"),

    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    reason: text("reason"),

    /** Optional FK to a governance_overrides row that authorised the change. */
    governanceOverrideId: uuid("governance_override_id"),

    actorId: uuid("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),

    metadata: jsonb("metadata"),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("project_audit_trail_project_idx").on(t.projectId, t.occurredAt),
    index("project_audit_trail_event_idx").on(t.eventType),
  ],
);

export const insertProjectAuditTrailSchema = createInsertSchema(
  projectAuditTrailTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertProjectAuditTrail = z.infer<
  typeof insertProjectAuditTrailSchema
>;
export type ProjectAuditTrail = typeof projectAuditTrailTable.$inferSelect;

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * activity — structured audit trail of user-initiated actions.
 * `entityId` is stored as text (not uuid) so it can reference any table's PK
 * regardless of type.
 */
export const activityTable = pgTable("activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  entityId: text("entity_id").notNull(),
  entityType: text("entity_type").notNull(),
  // Optional context links
  userId: uuid("user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  // Flexible extra data (before/after values, request metadata, etc.)
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activityTable).omit({
  id: true,
  createdAt: true,
});

export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityTable.$inferSelect;

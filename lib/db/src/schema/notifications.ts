import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { notificationTypeEnum } from "./enums";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

/**
 * notifications — per-user notification inbox.
 * System-generated notifications have `createdBy = null`.
 * `metadata` carries flexible extra data (e.g. entity IDs, deep-link paths).
 */
export const notificationsTable = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull().default("general"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  // Optional project context
  projectId: uuid("project_id").references(() => projectsTable.id, {
    onDelete: "set null",
  }),
  // Flexible payload for deep links, entity IDs, etc.
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // null = system-generated
  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
});

export const insertNotificationSchema = createInsertSchema(
  notificationsTable,
).omit({ id: true, createdAt: true, readAt: true });

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

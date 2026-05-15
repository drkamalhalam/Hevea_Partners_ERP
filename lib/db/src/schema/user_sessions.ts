/**
 * user_sessions.ts
 *
 * Login / session tracking table.
 * One row is recorded per user per hour (de-duplicated at the application layer).
 * This table is append-only — no UPDATE or DELETE routes exist.
 *
 * Supports legal accountability by preserving a time-stamped record of every
 * distinct login session along with IP address and user-agent for forensic use.
 */

import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userSessionsTable = pgTable("user_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),

  userId: uuid("user_id").references(() => usersTable.id, {
    onDelete: "cascade",
  }),

  clerkUserId: text("clerk_user_id"),

  displayName: text("display_name"),
  userRole: text("user_role"),

  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserSession = typeof userSessionsTable.$inferSelect;

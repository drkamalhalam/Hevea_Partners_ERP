import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { userRoleEnum, loginStatusEnum } from "./enums";

/**
 * users — our internal user record, linked 1-to-1 with a Clerk account.
 *
 * Clerk manages authentication; we store role, profile data, and soft-delete
 * state here. `createdBy` is intentionally stored without a FK constraint to
 * avoid a bootstrap circular-reference on the very first user.
 */
export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  role: userRoleEnum("role").notNull().default("employee"),
  displayName: text("display_name"),
  email: text("email"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  address: text("address"),
  idDocumentUrl: text("id_document_url"),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // ── Login Access Lifecycle ─────────────────────────────────────────────
  // loginStatus is the authoritative access gate checked on every request.
  // isActive and deletedAt are kept for backwards compat but loginStatus
  // takes precedence in the auth middleware.
  loginStatus: loginStatusEnum("login_status").notNull().default("active"),
  loginStatusChangedAt: timestamp("login_status_changed_at", { withTimezone: true }),
  loginStatusReason: text("login_status_reason"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // ── Person Registry Link ───────────────────────────────────────────────
  // Direct FK from login account → person_master (no FK constraint to avoid
  // circular module imports; integrity is enforced at application layer).
  personMasterId: uuid("person_master_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  // Self-referential — no FK constraint to allow bootstrap insert
  createdBy: uuid("created_by"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// Backwards-compat alias so existing imports still compile until route files are updated
export const userRolesTable = usersTable;
export type UserRole = User;
export type UserRoleEnum = typeof userRoleEnum.enumValues[number];

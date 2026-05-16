import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";

/**
 * partners — external parties who are party to plantation agreements.
 * A partner may or may not have a system user account.
 * `clerkUserId` provides a direct lookup shortcut used in several routes.
 */
export const partnersTable = pgTable("partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default("landowner"), // landowner | developer | investor
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  aadhaarLast4: text("aadhaar_last4"),
  // Link to Clerk account — used for portfolio lookups in dashboard routes
  clerkUserId: text("clerk_user_id"),
  // Normalised FK to users table when the partner has an app account
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * FK to person_master — canonical identity for this partner.
   * Nullable for legacy records; must be set for all new partner registrations.
   */
  personMasterId: uuid("person_master_id").references(() => personMasterTable.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
});

export const insertPartnerSchema = createInsertSchema(partnersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type Partner = typeof partnersTable.$inferSelect;

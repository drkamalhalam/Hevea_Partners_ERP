import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";

export const buyersTable = pgTable("buyers", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Person Registry linkage (nullable — individual buyers may link to person_master)
  personMasterId: uuid("person_master_id")
    .references(() => personMasterTable.id, { onDelete: "set null" }),

  name: text("name").notNull(),
  buyerType: text("buyer_type").notNull().default("trader"),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  gstin: text("gstin"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

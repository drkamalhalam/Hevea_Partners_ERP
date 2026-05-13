import {
  pgTable,
  uuid,
  text,
  real,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectStatusEnum } from "./enums";
import { usersTable } from "./users";

export const projectsTable = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location").notNull(),
  village: text("village"),
  district: text("district").notNull(),
  state: text("state").notNull().default("Tripura"),
  landArea: real("land_area").notNull(),
  landAreaUnit: text("land_area_unit").notNull().default("kani"),
  landNotionalValue: real("land_notional_value"),
  landValuePerUnit: real("land_value_per_unit"),
  status: projectStatusEnum("status").notNull().default("planning"),
  startDate: text("start_date").notNull(),
  expectedMaturityDate: text("expected_maturity_date"),
  termYears: integer("term_years").notNull().default(35),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

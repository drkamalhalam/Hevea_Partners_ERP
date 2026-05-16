import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";

/**
 * project_witnesses — witness details captured during project onboarding.
 * Minimum 2 witnesses required before deed generation.
 * `position` is 1-based ordering.
 */
export const projectWitnessesTable = pgTable("project_witnesses", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  /** 1-based position for display/document ordering */
  position: integer("position").notNull(),

  fullName: text("full_name").notNull(),
  /** "S/O" | "C/O" | "W/O" | "D/O" */
  sOnCOn: text("s_on_c_on"),
  /** Father / guardian name (goes with sOnCOn) */
  fatherGuardianName: text("father_guardian_name"),
  mobile: text("mobile"),
  address: text("address"),
  /** Optional per-project configuration */
  aadhaarNumber: text("aadhaar_number"),

  /** FK to person_master — canonical identity for this witness */
  personMasterId: uuid("person_master_id").references(() => personMasterTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
});

export const insertProjectWitnessSchema = createInsertSchema(projectWitnessesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProjectWitness = z.infer<typeof insertProjectWitnessSchema>;
export type ProjectWitness = typeof projectWitnessesTable.$inferSelect;

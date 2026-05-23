import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { personMasterTable } from "./person_master";

/**
 * project_participants — KYC data for developer and landowner captured
 * during the project onboarding wizard.  One row per role per project.
 * Stored separately from `partners` to allow full legal identity capture
 * (full Aadhaar, father/guardian name, S/O C/O) without modifying the
 * partner registry.
 */
export const projectParticipantsTable = pgTable("project_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  /** landowner | developer | investor | partner | nominee | claimant | witness | other */
  role: text("role").notNull(),

  fullName: text("full_name").notNull(),
  /** "S/O" | "C/O" | "W/O" | "D/O" */
  sOnCOn: text("s_on_c_on"),
  fatherGuardianName: text("father_guardian_name"),
  aadhaarNumber: text("aadhaar_number"),
  mobile: text("mobile"),
  address: text("address"),
  email: text("email"),

  /** GCS object path for Aadhaar copy */
  aadhaarObjectPath: text("aadhaar_object_path"),
  /** GCS object path for any supporting ID */
  supportingIdObjectPath: text("supporting_id_object_path"),

  /**
   * FK to person_master — the canonical identity this participant resolves to.
   * Nullable during migration; new wizard submissions must set this.
   * When set, this is the authoritative identity source for KYC, OTP, and audit.
   */
  personMasterId: uuid("person_master_id").references(() => personMasterTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => [
  unique("project_participants_project_role_person_uq").on(t.projectId, t.role, t.personMasterId),
]);

export const insertProjectParticipantSchema = createInsertSchema(projectParticipantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProjectParticipant = z.infer<typeof insertProjectParticipantSchema>;
export type ProjectParticipant = typeof projectParticipantsTable.$inferSelect;

/**
 * project_nominees — operational governance continuity nominees.
 *
 * Each project may have one active nominee (isActive = true).
 * When a nominee is replaced, the old record is kept with isActive = false
 * and replacedAt / replacedBy set — enabling a full audit trail.
 *
 * activationStatus tracks the future governance workflow:
 *   pending   → activated → revoked
 *
 * IMPORTANT: A nominee record confers NO ownership or equity rights.
 * It exists solely for operational continuity in governance workflows.
 */
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { personMasterTable } from "./person_master";
import { nomineeActivationStatusEnum } from "./enums";

export const projectNomineesTable = pgTable("project_nominees", {
  id: uuid("id").defaultRandom().primaryKey(),

  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  /** The project developer / admin who registered this nominee */
  nominatedBy: uuid("nominated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  // Person Registry linkage (nullable — legacy records pre-date this field)
  personMasterId: uuid("person_master_id")
    .references(() => personMasterTable.id, { onDelete: "set null" }),

  // ── Nominee personal details (kept for legacy records and document snapshots) ──
  nomineeName: text("nominee_name").notNull(),
  relationship: text("relationship").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  /** Placeholder URL for uploaded identity document */
  idDocumentUrl: text("id_document_url"),

  // ── Activation status (governance continuity workflow) ─────────────────
  activationStatus: nomineeActivationStatusEnum("activation_status")
    .notNull()
    .default("pending"),
  activationNotes: text("activation_notes"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  activatedBy: uuid("activated_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  // ── Current / history tracking ─────────────────────────────────────────
  /** false = historical record (replaced or removed) */
  isActive: boolean("is_active").notNull().default(true),
  /** Timestamp when this nominee was replaced by a new one */
  replacedAt: timestamp("replaced_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  // ── Audit ──────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProjectNominee = typeof projectNomineesTable.$inferSelect;

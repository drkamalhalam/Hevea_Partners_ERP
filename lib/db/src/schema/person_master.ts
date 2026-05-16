import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { personKycStatusEnum } from "./enums";

/**
 * person_master — single authoritative identity registry for every human/legal
 * entity in the ERP system.
 *
 * Architecture principle: Identity is permanent. Roles are dynamic.
 * One physical person = one person_master record, regardless of how many
 * projects they participate in or how many roles they hold.
 *
 * Deduplication is enforced at the DB level via:
 *   - aadhaar_number (unique, nullable — unique only when set)
 *   - mobile (unique, nullable — unique only when set)
 *
 * All project linkages, role assignments, KYC verifications, OTP records,
 * and governance actions must resolve identity through this table.
 *
 * User accounts (login/auth) are separate — see usersTable.
 * A person may optionally be linked to a user account (userId FK).
 * If a manually-created person later registers, link the account here;
 * do NOT create a new person_master record.
 */
export const personMasterTable = pgTable("person_master", {
  id: uuid("id").defaultRandom().primaryKey(),

  // ── Legal identity ──────────────────────────────────────────────────────
  fullName: text("full_name").notNull(),
  /** "S/O" | "C/O" | "W/O" | "D/O" */
  sOnCOn: text("s_on_c_on"),
  fatherGuardianName: text("father_guardian_name"),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"), // "male" | "female" | "other"

  // ── Deduplication keys (unique when non-null) ───────────────────────────
  /** Full 12-digit Aadhaar number — primary cross-system dedup key */
  aadhaarNumber: text("aadhaar_number"),
  /** Stored separately for display without exposing full number */
  aadhaarLast4: text("aadhaar_last4"),
  /** Primary mobile — secondary dedup key */
  mobile: text("mobile"),
  /** Alternate / secondary mobile (not dedup-constrained) */
  alternateMobile: text("alternate_mobile"),

  // ── Contact ─────────────────────────────────────────────────────────────
  email: text("email"),

  // ── Address ─────────────────────────────────────────────────────────────
  permanentAddress: text("permanent_address"),
  currentAddress: text("current_address"),
  village: text("village"),
  district: text("district"),
  state: text("state"),
  country: text("country").default("India"),

  // ── KYC status & verification flags ────────────────────────────────────
  kycStatus: personKycStatusEnum("kyc_status").notNull().default("pending"),
  /** True once Aadhaar has been admin-verified against the uploaded document */
  aadhaarVerified: text("aadhaar_verified").default("no"), // "yes" | "no" | "pending"
  /** True once mobile OTP has been verified for this person */
  otpVerified: text("otp_verified").default("no"), // "yes" | "no"

  // ── KYC document paths (GCS object storage) ─────────────────────────────
  aadhaarObjectPath: text("aadhaar_object_path"),
  supportingIdObjectPath: text("supporting_id_object_path"),
  profilePhotoObjectPath: text("profile_photo_object_path"),

  // ── Optional system account linkage ────────────────────────────────────
  /**
   * FK to users table. Populated only if this person has a login account.
   * When a manually-created person later registers, set this field —
   * do NOT create a duplicate person_master record.
   */
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),

  // ── Notes & admin ───────────────────────────────────────────────────────
  remarks: text("remarks"),

  // ── Timestamps ─────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => [
  unique("person_master_aadhaar_uq").on(t.aadhaarNumber),
  unique("person_master_mobile_uq").on(t.mobile),
]);

export const insertPersonMasterSchema = createInsertSchema(personMasterTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPersonMaster = z.infer<typeof insertPersonMasterSchema>;
export type PersonMaster = typeof personMasterTable.$inferSelect;

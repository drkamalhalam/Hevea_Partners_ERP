import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

/**
 * project_creation_otps — dual-OTP approval tracking for project activation.
 * Both developer and landowner must verify their OTP before a project can
 * be activated.  One record per (project, role) per send attempt.
 * Expired/replaced records are retained for audit.
 */
export const projectCreationOtpsTable = pgTable("project_creation_otps", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  /** developer | landowner */
  role: text("role").notNull(),

  phone: text("phone").notNull(),
  /** Stored in plaintext for dev; hashed in production */
  otpCode: text("otp_code").notNull(),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectCreationOtp = typeof projectCreationOtpsTable.$inferSelect;

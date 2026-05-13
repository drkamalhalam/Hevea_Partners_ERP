import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { partnersTable } from "./partners";
import { projectsTable } from "./projects";
import { claimantStatusEnum } from "./enums";

/**
 * partner_claimants — inheritance/succession claimants for a partner's
 * project-specific stake.
 *
 * IMPORTANT: This table stores claimant data only. No inheritance settlement
 * logic is implemented here. "isActive" tracks whether the record is current
 * (soft-archive via isActive=false on remove). Multiple claimants per
 * (partner, project) pair are supported.
 */
export const partnerClaimantsTable = pgTable("partner_claimants", {
  id: uuid("id").defaultRandom().primaryKey(),

  // The partner whose stake this claimant relates to
  partnerId: uuid("partner_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "cascade" }),

  // Project-wise scoping: each claimant is tied to a specific project stake
  projectId: uuid("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),

  // Claimant details
  claimantName: text("claimant_name").notNull(),
  relationship: text("relationship").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),

  // Placeholder for future document management integration
  claimDocumentsUrl: text("claim_documents_url"),

  // Status tracking
  status: claimantStatusEnum("status").notNull().default("registered"),
  notes: text("notes"),

  // Soft-archive support
  isActive: boolean("is_active").notNull().default(true),

  // Audit
  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PartnerClaimant =
  typeof partnerClaimantsTable.$inferSelect;
